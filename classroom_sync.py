#!/usr/bin/env python3
"""classroom_sync.py — sync Google Classroom data into the TheeDeck hub.

Two stores (mirrors the trading pipeline):
  1. PRIMARY: Supabase (classroom_tasks, classroom_announcements) via service_role
     key from ~/AppData/Local/hermes/.env  (same creds as supabase_trading_sync).
  2. FALLBACK: public/data/classroom.json + git commit/push, so the static
     GitHub Pages / local build still renders if Supabase is unreachable.

Silent-ish (one line) when nothing changed, so the no_agent cron watchdog stays
quiet. Run:  python classroom_sync.py
"""
import datetime, hashlib, json, os, subprocess, sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
OUT  = BASE / "public" / "data" / "classroom.json"
HOME = os.path.expanduser("~")
HERMESS = os.environ.get("HERMES_HOME") or (HOME + "/AppData/Local/hermes")
TOK  = Path(HERMESS) / "google_token.json"
ENV  = Path(HERMESS) / ".env"
SERVICE = "classroom_sync"


def _load_env():
    d = {}
    if ENV.exists():
        for line in ENV.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            d[k.strip()] = v.strip().strip("'\"")
    return d


_ENV = _load_env()
SUPA_URL = _ENV.get("SUPABASE_URL", "").rstrip("/")
SUPA_KEY = _ENV.get("SUPABASE_SERVICE_ROLE_KEY", "")


def _iso(dt_str):
    if not dt_str:
        return None
    try:
        return datetime.datetime.fromisoformat(dt_str.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d %H:%M")
    except Exception:
        return dt_str


def fetch_classroom():
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    creds = Credentials.from_authorized_user_file(str(TOK))
    svc = build("classroom", "v1", credentials=creds, cache_discovery=False)
    courses = svc.courses().list(pageSize=50, courseStates=["ACTIVE"]).execute().get("courses", [])
    tasks, anns = [], []
    for c in courses:
        cname, cid = c.get("name"), c.get("id")
        try:
            cw = svc.courses().courseWork().list(courseId=cid, pageSize=100).execute().get("courseWork", [])
            for it in cw:
                d = it.get("dueDate") or {}
                due = None
                if d.get("year") and d.get("month") and d.get("day"):
                    due = f"{d['year']:04d}-{d['month']:02d}-{d['day']:02d}"
                t = it.get("dueTime") or {}
                # Per-student submission state -> does the owner already have a
                # turn-in for this work? Used to hide "done" work from the page's
                # pending buckets and to tag it "ส่งแล้ว ✅". Mirrors what
                # school_sync.py does for assignments.json.
                submitted = False
                try:
                    subs = svc.courses().courseWork().studentSubmissions().list(
                        courseId=cid, courseWorkId=it["id"]).execute().get("studentSubmissions", [])
                    s = subs[0].get("state") if subs else None
                    submitted = s in ("TURNED_IN", "RETURNED")
                except Exception as se:
                    print(f"  [warn] submissions skip {cid}/{it.get('id')}: {str(se)[:80]}")
                tasks.append({
                    "task_key": str(it.get("id")),
                    "course_name": cname,
                    "course_id": str(cid),
                    "title": it.get("title"),
                    "due": due,
                    "due_time": f"{t.get('hours',0):02d}:{t.get('minutes',0):02d}" if t else None,
                    "state": it.get("state"),
                    "submitted": submitted,
                })
        except Exception as e:
            print(f"  [warn] coursework skip {cid}: {str(e)[:80]}")
        try:
            aa = svc.courses().announcements().list(courseId=cid, pageSize=10).execute().get("announcements", [])
            for a in aa:
                anns.append({
                    "ann_key": str(a.get("id")),
                    "course_name": cname,
                    "course_id": str(cid),
                    "text": (a.get("text") or "").strip(),
                    "time": a.get("creationTime"),
                })
        except Exception as e:
            print(f"  [warn] announcements skip {cid}: {str(e)[:80]}")
    return tasks, anns


# ── Supabase (primary) ─────────────────────────────────────────────────────
def _supa_url(path, on_conflict=None):
    url = f"{SUPA_URL}/rest/v1/{path}"
    if on_conflict:
        url += f"?on_conflict={on_conflict}"
    return url


def _supa_headers():
    return {
        "apikey": SUPA_KEY,
        "Authorization": f"Bearer {SUPA_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def _supa(method, path, payload=None, on_conflict=None):
    import requests
    r = requests.request(method, _supa_url(path, on_conflict), headers=_supa_headers(), json=payload, timeout=30)
    if r.status_code < 200 or r.status_code >= 300:
        raise RuntimeError(f"{path} HTTP {r.status_code}: {r.text[:200]}")
    return r


# Does classroom_tasks have the `submitted` column yet? (migration 0011).
# Cached per process run so we only probe once.
_HAS_SUBMITTED = None


def _has_submitted_col():
    global _HAS_SUBMITTED
    if _HAS_SUBMITTED is not None:
        return _HAS_SUBMITTED
    try:
        _supa("GET", "classroom_tasks?select=submitted&limit=1")
        _HAS_SUBMITTED = True
    except RuntimeError as e:
        # PGRST204 = unknown column -> not migrated yet
        _HAS_SUBMITTED = "PGRST204" in str(e) or "Could not find" in str(e)
    return bool(_HAS_SUBMITTED)


def _supa_upsert(tasks, anns):
    if not (SUPA_URL and SUPA_KEY):
        print("  (Supabase creds missing — skip Supabase, json fallback only)")
        return 0
    n = 0
    if tasks:
        clean_tasks = tasks
        if not _has_submitted_col():
            # Migration 0011 not applied yet — drop the new column so the upsert
            # doesn't 400 (the field still flows into the static JSON fallback).
            clean_tasks = [{k: v for k, v in t.items() if k != "submitted"} for t in tasks]
        _supa("POST", "classroom_tasks", clean_tasks, on_conflict="task_key")
        n += len(tasks)
    if anns:
        _supa("POST", "classroom_announcements", anns, on_conflict="ann_key")
        n += len(anns)
    # heartbeat / status stamp (operational, never exposed to browser)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    try:
        _supa("POST", "sync_state", [{
            "service": SERVICE, "last_started": now, "last_success": now,
            "last_error": None, "status": "healthy", "records_synced": n, "updated_at": now,
        }])
        _supa("POST", "heartbeat", [{
            "service": SERVICE, "last_seen": now, "last_success": now,
            "status": "healthy", "message": f"{len(tasks)} tasks, {len(anns)} announcements", "updated_at": now,
        }])
    except Exception as e:
        print("  (state write skipped:", e, ")")
    return n


# ── JSON fallback ──────────────────────────────────────────────────────────
def _sha(p: Path) -> str:
    if not p.exists():
        return ""
    raw = p.read_bytes()
    try:
        d = json.loads(raw)
        d.pop("generated_at", None)
        raw = json.dumps(d, sort_keys=True, ensure_ascii=False).encode("utf-8")
    except Exception:
        pass
    return hashlib.sha256(raw).hexdigest()


def _run(*args):
    return subprocess.run(list(args), cwd=str(BASE), capture_output=True, text=True)


def main():
    if not TOK.exists():
        print("missing google_token.json; cannot sync classroom")
        return 1
    if not (SUPA_URL and SUPA_KEY):
        print("WARNING: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env")

    if "DOCTYPE" in os.environ.get("HOME", ""):
        os.environ["HOME"] = HOME

    tasks, anns = fetch_classroom()

    # 1) Supabase primary
    try:
        _supa_upsert(tasks, anns)
    except Exception as e:
        print(f"supabase upsert FAILED: {e} (falling back to json)")
        return 1

    # 2) JSON fallback + git push (only when content changed)
    before = _sha(OUT)
    data = {
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "courses": _courses_json_from_tasks(tasks, anns),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    after = _sha(OUT)

    if before == after:
        return 0  # nothing changed -> silent

    status = _run("git", "status", "--porcelain")
    if status.returncode != 0 or "public/data/classroom.json" not in status.stdout:
        print("not pushing (classroom.json not dirty or git err):", status.stdout[:160])
        return 0
    _run("git", "add", "public/data/classroom.json")
    c = _run("git", "commit", "-m", "[auto] sync classroom data")
    if c.returncode != 0 and "nothing to commit" not in c.stdout + c.stderr:
        print("git commit failed:", c.stderr[-300:]); return 1
    p = _run("git", "push", "origin", "main")
    if p.returncode != 0:
        print("git push failed:", p.stderr[-300:]); return 1
    print("synced + pushed classroom.json")
    return 0


def _courses_json_from_tasks(tasks, anns):
    names = {}
    for t in tasks:
        names.setdefault(t["course_id"], {"name": t["course_name"], "coursework": [], "announcements": []})
    for a in anns:
        names.setdefault(a["course_id"], {"name": a["course_name"], "coursework": [], "announcements": []})
        names[a["course_id"]]["announcements"].append({"text": a["text"], "time": _iso(a["time"]), "id": a["ann_key"]})
    for t in tasks:
        names[t["course_id"]]["coursework"].append({
            "title": t["title"], "due": t["due"], "dueTime": t["due_time"],
            "state": t["state"], "id": t["task_key"],
            "submitted": t.get("submitted", False),
        })
    return list(names.values())


if __name__ == "__main__":
    sys.exit(main())
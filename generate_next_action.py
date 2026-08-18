#!/usr/bin/env python3
"""generate_next_action.py — AI "NEXT ACTION" briefing for the TheeDeck hub.

Every morning (cron, ~06:00), calls the 9arm LLM once to decide "what should I
do right now" and writes a compact JSON the Home page renders as the next-action
card.  A single cheap call/day (~deepseek-v4-flash) keeps it budget-friendly.

Two stores (mirrors classroom_sync.py):
  1. PRIMARY   : public/data/next_action.json  (git commit + push when changed)
No Supabase table yet — the fallback IS the file (page reads it directly, with a
client-side heuristic fallback if the file is stale/absent).  Keep KISS.

Silent (empty stdout) when nothing meaningfully changed, so the no_agent cron
watchdog stays quiet.

Output next_action.json shape (AI-produced):
  {
    "generated_at": "2026-08-19T06:05:00",
    "brief": "สายสรุป WHY — บรรทัดเดียว",
    "items": [
      {"title","course","courseName","due","dueLabel","effort_hr","why"},
      ...
    ]
  }
Where items[0] is THE next action the user should do now.
"""
import datetime, hashlib, json, os, subprocess, sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
OUT  = BASE / "public" / "data" / "next_action.json"
HOME = os.path.expanduser("~")
HERMESS = os.environ.get("HERMES_HOME") or (HOME + "/AppData/Local/hermes")

# 9arm creds from hermes .env (never read theedeck/.env*)
def _dotenv():
    d = {}
    p = Path(HERMESS) / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            d[k.strip()] = v.strip().strip("'\"")
    return d

_ENV = _dotenv()
API_KEY = _ENV.get("9ARM_API_KEY")
BASE_URL = _ENV.get("9ARM_BASE_URL") or "https://gateway.9arm.co/v1"
MODEL = _ENV.get("9ARM_MODEL") or "qwen3.8-27b-fp8"
# Cheap, short single-task call — flash is plenty for "pick the top task".
MODEL_FLASH = "deepseek-v4-flash-0731"


def _load_assignments():
    p = BASE / "public" / "data" / "assignments.json"
    if not p.exists():
        return [], {}
    import json as j
    data = j.loads(p.read_text(encoding="utf-8"))
    return data.get("todo", []) or [], data.get("courseNames", {}) or {}


def _load_quiz_events():
    p = BASE / "public" / "data" / "schedule.json"
    if not p.exists():
        return []
    import json as j
    data = j.loads(p.read_text(encoding="utf-8"))
    return data.get("quizzes", []) or []


def _relevant(assignments, quiz_events):
    """Keep only tasks worth asking the model about (limit token size):
    any overdue, due today, due within 7 days, or a quiz/exam <=7 days out.
    Sorted by urgency (due ascending, overdue already sorted by school_sync)."""
    from datetime import date
    today = date.today()
    def days_out(due):
        try:
            return (date.fromisoformat(due) - today).days
        except Exception:
            return None
    keep = []
    for a in assignments:
        d = days_out(a.get("due"))
        if d is None:
            continue
        if d <= 7:  # overdue (neg), today (0), within a week
            keep.append(a)
    # give the model exam pressure context too
    rows = []
    for a in sorted(keep, key=lambda x: x.get("due") or ""):
        d = days_out(a.get("due"))
        rows.append({
            "title": a.get("title", ""),
            "course": a.get("courseName", "") or a.get("course", ""),
            "due": a.get("due"),
            "days": d,
            "points": a.get("points"),
            "workType": a.get("workType", ""),
        })
    q = []
    today_iso = today.isoformat()
    for ev in quiz_events:
        dt = ev.get("date")
        if not dt:
            continue
        try:
            diff = (date.fromisoformat(dt) - today).days
        except Exception:
            continue
        if 0 <= diff <= 10:
            q.append(f"{ev.get('summary','')} (ใน {diff} วัน)")
    return rows, q


def _call_llm(rows, q):
    """One cheap flash call -> JSON {brief, items:[...]}."""
    payload = {
        "today": datetime.date.today().isoformat(),
        "todo": rows,
        "soon_exams": q,
    }
    sys_ = (
        "คุณเป็นผู้ช่วยวางแผนเรียนของนักศึกษาไทย ป.ตรี สาขา CS. "
        "รับข้อมูลงาน/สอบ แล้วเลือก 'สิ่งที่ควรทำตอนนี้' 1-3 อันดับ พร้อมเหตุผลไทยสั้นๆ ในแง่ deadline+ความยาก/เวลาที่ต้องใช้. "
        "ตอบเป็น JSON เท่านั้น ห้ามมีข้อความนอก JSON. โครงสร้าง: "
        '{"brief":"บรรทัดเดียวสรุปประเด็นหลัก","items":[{"title":...,"course":...,"dueLabel":"เช่น ส่งพรุ่งนี้ 23:59","effort_hr":"เช่น ~2 ชม.","why":"ทำไมต้องทำตอนนี้ สั้น 1-2 วลี"}]}'
        "items[0] = งานที่ควรทำก่อนที่สุด. effort_hr ใช้ตัวเลขอัตนัยสมเหตุสมผลตามชื่องาน/จำนวนคะแนน. why อธิบายว่า deadline ใกล้ หรือใช้เวลานาน หรือยาก."
    )
    body = {
        "model": MODEL_FLASH,
        "messages": [
            {"role": "system", "content": sys_},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        "temperature": 0.4,
        "max_tokens": 700,
        "extra_body": {"enable_thinking": False},
    }
    bf = os.environ.get("TEMP", "/tmp") + "/next_action_body.json"
    Path(bf).write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    url = BASE_URL.rstrip("/") + "/chat/completions"
    cmd = ["curl", "-s", "-m", "120", url,
           "-H", f"Authorization: Bearer {API_KEY}",
           "-H", "Content-Type: application/json",
           "--data-binary", f"@{bf}"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        print("next_action: API non-JSON:", (proc.stdout or proc.stderr)[:200])
        return None
    if data.get("error"):
        print("next_action: API ERROR:", data["error"][:200])
        return None
    ch = data.get("choices", [{}])[0].get("message", {})
    content = (ch.get("content") or "").strip()
    # model sometimes wraps JSON in fences — strip them
    content = content.strip("`")
    if content.startswith("json"):
        content = content[4:].strip()
    # accumulate usage so the Home usage card reflects this call
    u = data.get("usage", {})
    _accumulate_usage(MODEL_FLASH, u)
    try:
        parsed = json.loads(content)
    except Exception:
        print("next_action: model returned non-JSON:", content[:200])
        return None
    if not isinstance(parsed, dict) or not isinstance(parsed.get("items"), list):
        print("next_action: bad shape:", content[:200])
        return None
    return parsed


_USAGE = None
def _accumulate_usage(model, u):
    """Mirror 9arm_qwen — accumulate into 9arm_usage.json for the usage card."""
    try:
        pin = int(u.get("prompt_tokens") or 0)
        pout = int(u.get("completion_tokens") or 0)
        global _USAGE
        if _USAGE is None:
            p = Path(HERMESS) / "scripts" / "9arm_usage.json"
            _USAGE = (json.loads(p.read_text(encoding="utf-8"))
                      if p.exists() else {})
        _USAGE["tokens_in"] = int(_USAGE.get("tokens_in", 0)) + pin
        _USAGE["tokens_out"] = int(_USAGE.get("tokens_out", 0)) + pout
        _USAGE["tokens_total"] = int(_USAGE.get("tokens_total", 0)) + (pin + pout)
        _USAGE["calls"] = int(_USAGE.get("calls", 0)) + 1
        _USAGE["last_model"] = model
        _USAGE["updated_at"] = datetime.datetime.now().isoformat(timespec="seconds")
        bym = _USAGE.get("by_model", {})
        if not isinstance(bym, dict):
            bym = {}
        slot = bym.get(model) or {}
        slot["tokens_in"] = int(slot.get("tokens_in", 0)) + pin
        slot["tokens_out"] = int(slot.get("tokens_out", 0)) + pout
        slot["tokens_total"] = int(slot.get("tokens_total", 0)) + (pin + pout)
        slot["calls"] = int(slot.get("calls", 0)) + 1
        slot["last_used"] = datetime.datetime.now().isoformat(timespec="seconds")
        bym[model] = slot
        _USAGE["by_model"] = bym
        p = Path(HERMESS) / "scripts" / "9arm_usage.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(_USAGE, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


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
    if not API_KEY:
        print("next_action: missing 9ARM_API_KEY; skip (heuristic fallback on page)")
        return 1
    todo, _cn = _load_assignments()
    rows, q = _relevant(todo, _load_quiz_events())
    if not rows:
        print("next_action: no urgent task — nothing to brief (page shows 'ชิล ๆ')")
        return 0

    parsed = _call_llm(rows, q)
    if not parsed:
        print("next_action: LLM failed — keep old brief, page falls back to heuristic")
        return 1

    # normalize: keep only fields the page needs; guard length
    def clean(it):
        return {
            "title": str(it.get("title", ""))[:120],
            "course": str(it.get("course", ""))[:80],
            "dueLabel": str(it.get("dueLabel", ""))[:60],
            "effort_hr": str(it.get("effort_hr", ""))[:30],
            "why": str(it.get("why", ""))[:160],
        }
    items = [clean(it) for it in parsed.get("items", [])][:3]
    data = {
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "brief": str(parsed.get("brief", ""))[:160],
        "items": items,
    }

    before = _sha(OUT)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    after = _sha(OUT)
    if before == after:
        return 0  # same content -> silent

    status = _run("git", "status", "--porcelain")
    if status.returncode != 0 or "public/data/next_action.json" not in status.stdout:
        print("next_action: not pushing (file not dirty / git err):", status.stdout[:120])
        return 0
    _run("git", "add", "public/data/next_action.json")
    c = _run("git", "commit", "-m", "[auto] sync next-action brief")
    if c.returncode != 0 and "nothing to commit" not in c.stdout + c.stderr:
        print("next_action: git commit failed:", c.stderr[-200:]); return 1
    p = _run("git", "push", "origin", "main")
    if p.returncode != 0:
        print("next_action: git push failed:", p.stderr[-200:]); return 1
    print("next_action: brief updated + pushed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
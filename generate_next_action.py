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

Output next_action.json shape (AI-produced, see lib/brief.ts for the shared type):
  {
    "generated_at": "2026-08-19T06:05:00",
    "date": "2026-08-19",
    "day_label": "ประจำวัน 19 ส.ค.",
    "model": "deepseek-v4-flash-0731",
    "source_version": "3194f9af7788",
    "brief": "สรุปภาพรวม+สำคัญสุด 1-2 บรรทัด",
    "warnings": [ {"text": "…", "level": "danger|warn|info"} ],
    "items": [
      {"title","course","dueLabel","effort_hr","why"},
      ...
    ]
  }
Where items[0] is THE next action the user should do now, warnings is never
invented (empty [] when no data supports it), and source_version is a stable
hash of the assignments/schedule inputs so the page can flag stale briefs.
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
# Single model chain — qwen3.8-27b-fp8 is the default everywhere (deepseek
# removed per house rule). Keep 1-model chain to avoid redundant calls.
MODEL_CHAIN = [MODEL]


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


def _source_version():
    """Stable hash of the exact source inputs this brief was built from, so the
    client (and the user) can see when it was generated on stale data. Combines
    assignments.json todo + schedule.json quizzes; ignores volatile fields
    (generated_at/updated) so an unchanged source yields the same version."""
    import json as j
    blob = {}
    p = BASE / "public" / "data" / "assignments.json"
    if p.exists():
        d = j.loads(p.read_text(encoding="utf-8"))
        blob["todo"] = d.get("todo", [])
    q = BASE / "public" / "data" / "schedule.json"
    if q.exists():
        d = j.loads(q.read_text(encoding="utf-8"))
        blob["quizzes"] = d.get("quizzes", [])
    raw = j.dumps(blob, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


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


def _call_llm(rows, q, model):
    """One call to a specific model -> (JSON dict, model) or (None, model) on failure."""
    today_d = datetime.date.today()
    # Thai-ish weekday label so the model can say "พรุ่งนี้/สัปดาห์หน้า" correctly.
    wd = ["จันทร์","อังคาร","พุธ","พฤหัส","ศุกร์","เสาร์","อาทิตย์"][today_d.weekday()]
    payload = {
        "today": today_d.isoformat(),
        "today_is_weekday": wd,
        "todo": rows,
        "soon_exams": q,
    }
    sys_ = (
        "คุณเป็นผู้ช่วยวางแผนเรียนของนักศึกษาไทย ป.ตรี สาขา CS. "
        "รับข้อมูลงาน/สอบ แล้วเขียน 'Morning Brief' สรุปสั้นๆ เป็นภาษาไทยธรรมชาติ ที่ตอบ 4 โจทย์: "
        "1) วันนี้ภาพรวมเป็นยังไง 2) อะไรสำคัญที่สุด 3) ควรทำอะไรก่อน 4) มีคำเตือน (warning) ไหม. "
        "ข้อมูลทั้งหมดถูกกรองมาแล้ว (เฉพาะ overdue/ครบวันนี้/ภายในระยะ) — ใช้เท่าที่ให้เท่านั้น. "
        "ห้ามเดา/สร้าง deadline, วันสอบ, วิชา, หรือสถานะงานที่ไม่อยู่ในข้อมูล; ถ้าข้อมูลอะไรไม่มี ให้บอกว่า 'ไม่มีข้อมูล' แทนการมโน. "
        "ตอบเป็น JSON เท่านั้น ห้ามมีข้อความนอก JSON. โครงสร้าง: "
        '{\"brief\":\"1-2 บรรทัดสรุปภาพรวม+สิ่งที่สำคัญที่สุด (กระชับ ภาษาไทยธรรมชาติ ไม่เว่อร์)\",'
        '\"warnings\":[{\"text\":\"คำเตือนสั้นๆ เช่น มีงานเลยกำหนด 2 รายการ อาจใช้เวลารีบเคลียร์\",\"level\":\"danger|warn|info\"}],'
        '\"items\":[{\"title\":...,\"course\":...,\"dueLabel\":\"เช่น ส่งพรุ่งนี้ 23:59\",\"effort_hr\":\"เช่น ~2 ชม.\",\"why\":\"ทำไมต้องทำตอนนี้ สั้น 1-2 วลี\"}]}'
        "warnings ห้ามมโน — ใส่เฉพาะเมื่อข้อมูลจริงรองรับ (มีงาน overdue เยอะ, สอบใกล้, กำหนดส่งซ้อนกัน); ถ้าไม่มีคำเตือน ให้ [] ว่าง. "
        "items = งานสำคัญ 1-3 รายการ เรียงตามความเร่งด่วนจริงที่เห็นในข้อมูล. items[0] = งานที่ควรทำก่อนที่สุด. "
        "dueLabel ใช้ภาษาไทยบอกกำหนดส่ง เช่น 'ส่งวันนี้'/'ส่งพรุ่งนี้'/'ส่งใน 3 วัน' (เทียบกับวันที่ today + weekday ที่ให้) และใส่เวลาใกล้เคียงจริงถ้ารู้. "
        "effort_hr ใช้ตัวเลขอัตนัยสมเหตุสมผลตามชื่องาน/จำนวนคะแนน. why อธิบายว่า deadline ใกล้ หรือใช้เวลานาน หรือยาก."
    )
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": sys_},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        "temperature": 0.4,
        "max_tokens": 1200,
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
        print(f"next_action: [{model}] API non-JSON:", (proc.stdout or proc.stderr)[:200])
        return None
    if data.get("error"):
        err = data["error"]
        print(f"next_action: [{model}] API ERROR:", str(err)[:400])
        return None
    ch = data.get("choices", [{}])[0].get("message", {})
    # Qwen3.8 may return reasoning_content + null content when thinking is on
    content = (ch.get("content") or ch.get("reasoning_content") or "").strip()
    # model sometimes wraps JSON in fences — strip them
    content = content.strip("`")
    if content.startswith("json"):
        content = content[4:].strip()
    # model may emit <think>...</think> prefix even with enable_thinking False
    if "<think>" in content:
        content = content.split("</think>")[-1].strip()
    # accumulate usage so the Home usage card reflects this call
    u = data.get("usage", {})
    _accumulate_usage(model, u)
    try:
        parsed = json.loads(content)
    except Exception:
        print(f"next_action: [{model}] model returned non-JSON:", content[:500])
        return None
    if not isinstance(parsed, dict) or not isinstance(parsed.get("items"), list):
        print(f"next_action: [{model}] bad shape:", content[:200])
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

    parsed = None
    used_model = None
    for m in MODEL_CHAIN:
        parsed = _call_llm(rows, q, m)
        if parsed:
            used_model = m
            break
        print(f"next_action: [{m}] failed, trying fallback" if m != MODEL_CHAIN[-1]
              else f"next_action: all {len(MODEL_CHAIN)} models failed")
    if not parsed:
        print("next_action: LLM failed — generating heuristic fallback brief")
        # Heuristic fallback: deterministic, no LLM needed — picks nearest-due
        # tasks and builds Thai labels from actual due dates (relative to today).
        today_d = datetime.date.today()
        th_months = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]
        day_label = f"ประจำวัน {today_d.day} {th_months[today_d.month-1]}"
        wd = ["จันทร์","อังคาร","พุธ","พฤหัส","ศุกร์","เสาร์","อาทิตย์"][today_d.weekday()]
        # Build Thai dueLabel relative to today
        def due_label(due_str):
            try:
                d = datetime.date.fromisoformat(due_str)
                diff = (d - today_d).days
                if diff < 0:
                    return f"เลยกำหนด {abs(diff)} วัน"
                if diff == 0:
                    return "ส่งวันนี้"
                if diff == 1:
                    return "ส่งพรุ่งนี้"
                return f"ส่งใน {diff} วัน"
            except Exception:
                return ""
        # Sort rows by urgency: soonest due first (overdue already sorted, but re-sort)
        sorted_rows = sorted(rows, key=lambda x: x.get("due") or "")
        # Pick 3 most urgent for items (nearest due + high points bias)
        # Heuristic: due-soon (0-2 days) first, then overdue high-points — so
        # actionable tasks (พรุ่งนี้) appear before very old overdue that may no
        # longer be submittable.
        def urgency_score(r):
            due = r.get("due") or "9999-12-31"
            pts = r.get("points") or 0
            try:
                diff = (datetime.date.fromisoformat(due) - today_d).days
            except Exception:
                diff = 999
            is_overdue = 1 if diff < 0 else 0
            # soon: sort by diff ascending then high points first
            # overdue: sort by high points first then least overdue first
            if is_overdue:
                return (1, -pts, diff)
            return (0, diff, -pts)
        sorted_rows = sorted(rows, key=urgency_score)
        items = []
        for r in sorted_rows[:3]:
            due = r.get("due") or ""
            title = r.get("title") or ""
            course = r.get("course") or ""
            pts = r.get("points")
            dl = due_label(due)
            # effort estimate
            if pts and pts >= 100:
                eff = "~2 ชม."
            elif pts and pts >= 10:
                eff = "~1 ชม."
            else:
                eff = "~30 นาที"
            # why
            try:
                diff = (datetime.date.fromisoformat(due) - today_d).days
            except Exception:
                diff = 0
            if diff < 0:
                why = "เลยกำหนดมานาน ควรเคลียร์ไม่ให้สะสม"
            elif diff <= 1:
                why = "กำหนดส่งใกล้สุดและคะแนนสูง" if pts and pts >= 50 else "กำหนดส่งใกล้ที่สุด"
            else:
                why = "กำหนดส่งใกล้และควรเริ่มก่อน"
            items.append({"title": title, "course": course, "dueLabel": dl, "effort_hr": eff, "why": why})
        # Warnings
        overdue_cnt = sum(1 for r in rows if (datetime.date.fromisoformat(r.get("due")) - today_d).days < 0) if rows else 0
        soon_cnt = sum(1 for r in rows if 0 <= (datetime.date.fromisoformat(r.get("due")) - today_d).days <= 2) if rows else 0
        warnings = []
        if overdue_cnt >= 2:
            warnings.append({"text": f"มีงานเลยกำหนด {overdue_cnt} รายการ ควรเคลียร์ก่อน", "level": "danger"})
        if soon_cnt >= 2:
            warnings.append({"text": f"มีงานต้องส่งพรุ่งนี้ {soon_cnt} รายการ กำหนดซ้อนกัน", "level": "warn"})
        brief = f"วันนี้{wd} มีงานเลยกำหนด {overdue_cnt} รายการและงานต้องส่งพรุ่งนี้ {soon_cnt} รายการ ควรเริ่มจากงานพรุ่งนี้ก่อนแล้วเคลียร์งานค้าง"
        parsed = {"brief": brief, "warnings": warnings, "items": items}
        used_model = "heuristic"

    # Daily morning-brief feel: which day this brief is "for".
    today_d = datetime.date.today()
    th_months = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]
    day_label = f"ประจำวัน {today_d.day} {th_months[today_d.month-1]}"

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

    # warnings — only keep well-formed, non-empty entries (never invent).
    def clean_warn(w):
        if not isinstance(w, dict):
            return None
        text = str(w.get("text", "")).strip()[:140]
        if not text:
            return None
        lvl = str(w.get("level", "")).strip().lower()
        if lvl not in ("danger", "warn", "info"):
            lvl = "warn"
        return {"text": text, "level": lvl}
    warnings = [cw for cw in (clean_warn(w) for w in (parsed.get("warnings") or [])) if cw][:3]

    data = {
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "date": today_d.isoformat(),
        "day_label": day_label,
        "model": used_model,
        "source_version": _source_version(),
        "brief": str(parsed.get("brief", ""))[:240],
        "warnings": warnings,
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
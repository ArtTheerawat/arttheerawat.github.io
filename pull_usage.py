#!/usr/bin/env python3
"""pull_usage.py — sync 9arm usage counter into public/data.json (web hub).
Called from auto_sync.py before the git hash/commit.

- 9arm: reads the accumulated counter state file written by 9arm_qwen.py
  (~/AppData/Local/hermes/scripts/9arm_usage.json).
  OpenRouter usage is served live via /api/usage (serverless proxy) instead,
  so it is intentionally NOT pushed here.

Writes {"usage": {"9arm": ...}} into public/data.json under key "usage".
Exit 0 always (even if the state file is missing) so auto_sync keeps working.
"""
import json, os, sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = BASE / "public" / "data.json"
HERMES = Path(os.path.expanduser("~/AppData/Local/hermes"))

NINE_STATE = HERMES / "scripts" / "9arm_usage.json"


def fetch_9arm():
    if not NINE_STATE.exists():
        return {"status": "empty", "tokens_total": 0, "calls": 0}
    try:
        st = json.load(open(NINE_STATE, encoding="utf-8"))
    except Exception:
        return {"status": "error", "error": "state unreadable"}
    return {
        "status": "ok",
        "tokens_in": int(st.get("tokens_in", 0)),
        "tokens_out": int(st.get("tokens_out", 0)),
        "tokens_total": int(st.get("tokens_total", 0)),
        "calls": int(st.get("calls", 0)),
        "last_model": st.get("last_model"),
        "by_model": st.get("by_model", {}),
        "updated_at": st.get("updated_at"),
    }


def datetime_now_iso():
    from datetime import datetime
    return datetime.now().isoformat(timespec="seconds")


def main():
    # OpenRouter usage is now served live via /api/usage (serverless proxy), so we
    # only push 9arm (state-file counter) into data.json here. Dropping OpenRouter
    # from the synced file avoids a push every time its live usage drifts.
    n9 = fetch_9arm()
    usage = {
        "9arm": n9,
        "updated_at": datetime_now_iso(),
    }
    if not DATA.exists():
        print("missing data.json; nothing to inject")
        return 0
    try:
        data = json.load(open(DATA, encoding="utf-8"))
    except Exception as e:
        print("cannot read data.json:", e)
        return 0
    data["usage"] = usage
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("usage injected: 9arm=" + json.dumps(n9, ensure_ascii=False)[:120])
    return 0


if __name__ == "__main__":
    sys.exit(main())
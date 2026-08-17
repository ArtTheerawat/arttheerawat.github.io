#!/usr/bin/env python3
"""pull_usage.py — fetch live AI usage for OpenRouter + 9arm and inject into
public/data.json (web hub). Called from auto_sync.py before the git hash/commit,
so the dashboard home page can show token/credit usage.

- OpenRouter: pulls real-time from GET /api/v1/auth/key + /api/v1/credits
  (credit-based prepaid account -> usage, total credits, remaining, monthly/weekly/daily)
- 9arm: reads the accumulated counter state file written by 9arm_qwen.py
  (~/AppData/Local/hermes/scripts/9arm_usage.json)

Writes {"usage": {...}} into public/data.json under key "usage".
Exit 0 always (even if a provider is unreachable) so auto_sync keeps working.
"""
import json, os, subprocess, sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = BASE / "public" / "data.json"
HERMES = Path(os.path.expanduser("~/AppData/Local/hermes"))

NINE_STATE = HERMES / "scripts" / "9arm_usage.json"


def read_env(key: str):
    v = os.environ.get(key)
    if v:
        return v
    envf = HERMES / ".env"
    try:
        for line in open(envf, encoding="utf-8"):
            line = line.strip()
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return None


def _get(url, token, timeout=20):
    r = subprocess.run(
        [
            "curl", "-s", "-m", str(timeout), url,
            "-H", f"Authorization: Bearer {token}",
        ],
        capture_output=True, text=True,
    )
    try:
        return json.loads(r.stdout)
    except Exception:
        return None


def fetch_openrouter():
    """OpenRouter is prepaid credit-based: credits endpoint gives total + usage,
    usage endpoint gives breakdown. No limit_reset because no hard limit."""
    key = read_env("OPENROUTER_API_KEY")
    if not key:
        return {"status": "unknown", "error": "no OPENROUTER_API_KEY"}
    credits = _get("https://openrouter.ai/api/v1/credits", key)
    keyinfo = _get("https://openrouter.ai/api/v1/auth/key", key)
    if not credits and not keyinfo:
        return {"status": "error", "error": "API unreachable"}
    total = None
    if credits and isinstance(credits.get("data"), dict):
        total = credits["data"].get("total_credits")
    d = keyinfo.get("data") if keyinfo and isinstance(keyinfo.get("data"), dict) else {}
    usage = d.get("usage")
    out = {
        "status": "ok",
        "usage": round(usage, 4) if usage is not None else None,
        "usage_monthly": round(d["usage_monthly"], 4) if d.get("usage_monthly") is not None else None,
        "usage_weekly": round(d["usage_weekly"], 4) if d.get("usage_weekly") is not None else None,
        "usage_daily": round(d["usage_daily"], 4) if d.get("usage_daily") is not None else None,
        "total_credits": total,
        "is_free_tier": bool(d.get("is_free_tier")),
        "updated_at": datetime_now_iso(),
    }
    # remaining = total_credits - total_usage if available
    if credits and isinstance(credits.get("data"), dict):
        tu = credits["data"].get("total_usage")
        if tu is not None and total is not None:
            out["remaining"] = round(total - tu, 4)
    return out


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
        "updated_at": st.get("updated_at"),
    }


def datetime_now_iso():
    from datetime import datetime
    return datetime.now().isoformat(timespec="seconds")


def main():
    or_ = fetch_openrouter()
    n9 = fetch_9arm()
    usage = {
        "openrouter": or_,
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
    print("usage injected: openrouter=" + json.dumps(or_, ensure_ascii=False)[:120])
    print("                9arm=" + json.dumps(n9, ensure_ascii=False)[:120])
    return 0


if __name__ == "__main__":
    sys.exit(main())
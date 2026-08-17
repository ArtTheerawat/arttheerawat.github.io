#!/usr/bin/env python3
"""auto_sync.py — regenerate data.json from the Trading Bot Log Google Sheet and,
if the data actually changed, commit + push to GitHub so the dashboard stays live.

Designed to run on a frequent cron (e.g. every 15 min). Silent (no output) when
nothing changed, which keeps the cron watchdog quiet.

Usage: python auto_sync.py
Requires: generate_data.py + pull_usage.py + git repo (origin=GitHub Pages root site)

NOTE (Next.js): writes to public/data.json so the static export can serve it at
/api-less /data.json. Pushes to branch 'main' explicitly.
"""
import hashlib, os, subprocess, sys
from pathlib import Path

# LIVE repo = the directory this script lives in (trading-dashboard-tmp,
# origin = ArtTheerawat/arttheerawat.github.io, served at arttheerawat.github.io/)
BASE = Path(__file__).resolve().parent
GEN  = BASE / "generate_data.py"
DATA = BASE / "public" / "data.json"   # Next.js static export serves /data.json from public/


def sha(p: Path) -> str:
    """Hash data.json ignoring volatile timestamps (generated_at + usage.updated_at)
    and micro-drifting $ amounts (rounded to cents) so we only commit+push when
    actual content changed, not on every regen/poll."""
    if not p.exists():
        return ""
    raw = p.read_bytes()
    try:
        import json
        d = json.loads(raw)
        d.pop("generated_at", None)
        # strip volatile usage timestamps + round $ to cents so a pure refresh
        # (or the usage API's self-reflection drift) doesn't trigger a push
        u = d.get("usage")
        if isinstance(u, dict):
            u.pop("updated_at", None)
            for prov in ("openrouter", "9arm"):
                pu = u.get(prov)
                if isinstance(pu, dict):
                    pu.pop("updated_at", None)
                    if prov == "openrouter":
                        for k in ("usage", "remaining", "total_credits",
                                  "usage_daily", "usage_weekly", "usage_monthly"):
                            if isinstance(pu.get(k), (int, float)):
                                pu[k] = round(pu[k], 2)
        raw = json.dumps(d, sort_keys=True, ensure_ascii=False).encode("utf-8")
    except Exception:
        pass  # not JSON -> use raw bytes
    return hashlib.sha256(raw).hexdigest()


def run(*args, **kw):
    return subprocess.run(
        list(args), cwd=str(BASE), capture_output=True, text=True, **kw
    )


def main():
    if not GEN.exists():
        print("missing generate_data.py; cannot sync")
        return 1

    before = sha(DATA)

    # 1) regenerate data.json from the sheet
    r = run(sys.executable, str(GEN))
    if r.returncode != 0:
        print("generate_data.py failed:", r.stderr[-500:])
        return 1

    # 1b) inject live AI usage (OpenRouter + 9arm) into data.json before hashing
    p = BASE / "pull_usage.py"
    if p.exists():
        ru = run(sys.executable, str(p))
        if ru.returncode != 0:
            print("pull_usage.py failed:", ru.stderr[-300:])

    after = sha(DATA)

    # 2) if content changed, commit + push
    if before == after:
        return 0  # nothing changed -> silent

    # verify git repo + origin exist
    status = run("git", "status", "--porcelain")
    if status.returncode != 0 or "public/data.json" not in status.stdout:
        return 0

    commit = run("git", "add", "public/data.json")
    if commit.returncode != 0:
        print("git add failed:", commit.stderr[-300:]); return 1
    c = run("git", "commit", "-m", "[auto] sync dashboard data from Google Sheets")
    if c.returncode != 0 and "nothing to commit" not in c.stdout + c.stderr:
        print("git commit failed:", c.stderr[-300:]); return 1
    p = run("git", "push", "origin", "main")
    if p.returncode != 0:
        print("git push failed:", p.stderr[-300:]); return 1
    print("synced + pushed dashboard public/data.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
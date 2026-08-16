#!/usr/bin/env python3
"""auto_sync.py — regenerate data.json from the Trading Bot Log Google Sheet and,
if the data actually changed, commit + push to GitHub so the dashboard stays live.

Designed to run on a frequent cron (e.g. every 15 min). Silent (no output) when
nothing changed, which keeps the cron watchdog quiet.

Usage: python auto_sync.py
Requires: generate_data.py + git repo at ~/Documents/trading-dashboard (origin=GitHub Pages)
"""
import hashlib, os, subprocess, sys
from pathlib import Path

BASE = Path(os.path.expanduser("~/Documents/trading-dashboard"))
GEN  = BASE / "generate_data.py"
DATA = BASE / "data.json"

def sha(p: Path) -> str:
    """Hash data.json ignoring the volatile generated_at timestamp so we only
    commit+push when actual trade/signal/perf data changed, not on every regen."""
    if not p.exists():
        return ""
    raw = p.read_bytes()
    try:
        import json
        d = json.loads(raw)
        d.pop("generated_at", None)
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

    after = sha(DATA)

    # 2) if content changed, commit + push
    if before == after:
        return 0  # nothing changed -> silent

    # verify git repo + origin exist
    status = run("git", "status", "--porcelain")
    if status.returncode != 0 or " data.json" not in status.stdout:
        return 0

    commit = run("git", "add", "data.json")
    if commit.returncode != 0:
        print("git add failed:", commit.stderr[-300:]); return 1
    c = run("git", "commit", "-m", "[auto] sync dashboard data from Google Sheets")
    if c.returncode != 0 and "nothing to commit" not in c.stdout + c.stderr:
        print("git commit failed:", c.stderr[-300:]); return 1
    p = run("git", "push")
    if p.returncode != 0:
        print("git push failed:", p.stderr[-300:]); return 1
    print("synced + pushed dashboard data.json")
    return 0

if __name__ == "__main__":
    sys.exit(main())
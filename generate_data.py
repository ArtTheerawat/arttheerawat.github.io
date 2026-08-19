#!/usr/bin/env python3
"""generate_data.py — pull real trade/signal/perf data from the Trading Bot Log
Google Sheet and emit data.json for the GitHub Pages dashboard.

Uses the existing buu google_token.json (has spreadsheets+drive scopes).
Run:  python generate_data.py  ->  writes data.json next to dashboard.js
"""
import os, sys, json, datetime
from pathlib import Path

HERMES = Path(os.path.expanduser("~/AppData/Local/hermes"))
TOK = HERMES / "google_token.json"
if not TOK.exists():
    TOK = HERMES / "private" / "google_token.json"
SHEET_ID = "1ijYK8wJ2XEn2e0_nelVG1qyGSKZtJz499KhWZihmDpY"
OUT = Path(__file__).resolve().parent / "public" / "data.json"  # Next.js static export serves /data.json from public/

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build


def get_sheet():
    creds = Credentials.from_authorized_user_file(str(TOK))
    return build("sheets", "v4", credentials=creds)


def rows(svc, rng):
    vals = svc.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range=rng, valueRenderOption="UNFORMATTED_VALUE"
    ).execute().get("values", [])
    return vals


def build_lookup(hdr):
    return {str(h).strip(): i for i, h in enumerate(hdr)}


def num(v):
    try:
        return float(v)
    except Exception:
        return 0


def main():
    svc = get_sheet()

    # ---- Trades ----
    trades = []
    tv = rows(svc, "Trades!A2:S1000")
    if tv:
        # header
        hdr = svc.spreadsheets().values().get(
            spreadsheetId=SHEET_ID, range="Trades!A1:S1"
        ).execute().get("values", [[]])[0]
        L = build_lookup(hdr)
        def rc(r, key):
            # column-safe read: '' if row shorter than header col (Google trims trailing empties)
            i = L.get(key)
            return r[i] if i is not None and i < len(r) else ""
        for r in tv:
            if not any(str(c).strip() for c in r):
                continue
            trades.append({
                "timestamp": rc(r, "Timestamp"),
                "type": rc(r, "Type"),
                "symbol": rc(r, "Symbol"),
                "direction": rc(r, "Direction"),
                "volume": rc(r, "Volume"),
                "entry": rc(r, "Entry"),
                "sl": rc(r, "SL"),
                "tp": rc(r, "TP"),
                "exit": rc(r, "Exit"),
                "profit": rc(r, "Profit"),
                "swap": rc(r, "Swap"),
                "commission": rc(r, "Commission"),
                "netPnl": rc(r, "Net P&L"),
                "status": rc(r, "Status"),
                "signalReason": rc(r, "Signal Reason"),
                "strategy": rc(r, "Strategy"),
                "risk": rc(r, "Risk %"),
                "balance": rc(r, "Account Balance"),
                "notes": rc(r, "Notes"),
            })

    # ---- Signals ----
    signals = []
    sv2 = rows(svc, "Signals!A2:N1006")
    if sv2:
        hdr = svc.spreadsheets().values().get(
            spreadsheetId=SHEET_ID, range="Signals!A1:N1"
        ).execute().get("values", [[]])[0]
        L = build_lookup(hdr)
        for r in sv2:
            if not any(str(c).strip() for c in r):
                continue
            def rc(r, key):
                i = L.get(key)
                return r[i] if i is not None and i < len(r) else ""
            signals.append({
                "timestamp": rc(r, "Timestamp"),
                "symbol": rc(r, "Symbol"),
                "signal": rc(r, "Signal"),
                "direction": rc(r, "Direction"),
                "confidence": rc(r, "Confidence"),
                "d1Trend": rc(r, "D1 Trend"),
                "h1Trend": rc(r, "H1 Trend"),
                "rsi": rc(r, "RSI"),
                "atr": rc(r, "ATR"),
                "entryZone": rc(r, "Entry Zone"),
                "sl": rc(r, "SL"),
                "tp": rc(r, "TP"),
                "status": rc(r, "Status"),
                "notes": rc(r, "Notes"),
            })

    # ---- Performance ----
    perf = []
    pv = rows(svc, "Performance!A2:K1000")
    if pv:
        hdr = svc.spreadsheets().values().get(
            spreadsheetId=SHEET_ID, range="Performance!A1:K1"
        ).execute().get("values", [[]])[0]
        L = build_lookup(hdr)
        for r in pv:
            if not any(str(c).strip() for c in r):
                continue
            def rc(r, key):
                i = L.get(key)
                return r[i] if i is not None and i < len(r) else ""
            perf.append({
                "date": rc(r, "Date"),
                "totalTrades": rc(r, "Total Trades"),
                "wins": rc(r, "Wins"),
                "losses": rc(r, "Losses"),
                "winrate": rc(r, "Winrate %"),
                "netPnl": rc(r, "Net P&L"),
                "maxDrawdown": rc(r, "Max Drawdown"),
                "avgRr": rc(r, "Avg RR"),
                "balance": rc(r, "Balance"),
                "equityPeak": rc(r, "Equity Peak"),
                "equityLow": rc(r, "Equity Low"),
            })

    data = {
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "trades": trades,
        "signals": signals,
        "perf": perf,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"WROTE {OUT}")
    print(f"  trades={len(trades)}  signals={len(signals)}  perf={len(perf)}")


if __name__ == "__main__":
    main()
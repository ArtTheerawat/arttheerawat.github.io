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
        for r in tv:
            if not any(str(c).strip() for c in r):
                continue
            trades.append({
                "timestamp": r[L["Timestamp"]],
                "type": r[L["Type"]],
                "symbol": r[L["Symbol"]],
                "direction": r[L["Direction"]],
                "volume": r[L["Volume"]],
                "entry": r[L["Entry"]],
                "sl": r[L["SL"]],
                "tp": r[L["TP"]],
                "exit": r[L["Exit"]],
                "profit": r[L["Profit"]],
                "swap": r[L["Swap"]],
                "commission": r[L["Commission"]],
                "netPnl": r[L["Net P&L"]],
                "status": r[L["Status"]],
                "signalReason": r[L["Signal Reason"]],
                "strategy": r[L["Strategy"]],
                "risk": r[L["Risk %"]],
                "balance": r[L["Account Balance"]],
                "notes": r[L["Notes"]],
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
            signals.append({
                "timestamp": r[L["Timestamp"]],
                "symbol": r[L["Symbol"]],
                "signal": r[L["Signal"]],
                "direction": r[L["Direction"]],
                "confidence": r[L["Confidence"]],
                "d1Trend": r[L["D1 Trend"]],
                "h1Trend": r[L["H1 Trend"]],
                "rsi": r[L["RSI"]],
                "atr": r[L["ATR"]],
                "entryZone": r[L["Entry Zone"]],
                "sl": r[L["SL"]],
                "tp": r[L["TP"]],
                "status": r[L["Status"]],
                "notes": r[L["Notes"]],
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
            perf.append({
                "date": r[L["Date"]],
                "totalTrades": r[L["Total Trades"]],
                "wins": r[L["Wins"]],
                "losses": r[L["Losses"]],
                "winrate": r[L["Winrate %"]],
                "netPnl": r[L["Net P&L"]],
                "maxDrawdown": r[L["Max Drawdown"]],
                "avgRr": r[L["Avg RR"]],
                "balance": r[L["Balance"]],
                "equityPeak": r[L["Equity Peak"]],
                "equityLow": r[L["Equity Low"]],
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
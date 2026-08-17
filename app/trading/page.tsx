"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { dataUrl, fmtMoney, fmtTimestamp, num } from "@/lib/data";

interface Trade {
  timestamp?: unknown;
  symbol?: string;
  type?: string;
  direction?: string;
  volume?: unknown;
  entry?: string;
  tp?: string;
  sl?: string;
  netPnl?: unknown;
  status?: string;
}

interface Signal {
  timestamp?: unknown;
  symbol?: string;
  signal?: string;
  direction?: string;
  confidence?: string;
  d1Trend?: string;
  h1Trend?: string;
  entryZone?: string;
  status?: string;
}

interface PerfDay {
  date?: string;
  totalTrades?: unknown;
  wins?: unknown;
  losses?: unknown;
  winrate?: unknown;
  netPnl?: unknown;
  balance?: unknown;
}

interface TradeData {
  trades: Trade[];
  signals: Signal[];
  perf: PerfDay[];
}

const EMPTY: TradeData = { trades: [], signals: [], perf: [] };
const EMPTY_MSG = "ยังไม่มีข้อมูล — รอ data.json ซิงก์เข้ามา";

function dataSynced(ok: boolean, extra: string) {
  return { ok, extra };
}

function statusBadge(status?: string): { cls: string; txt: string } {
  const st = (status || "OPEN").toUpperCase();
  if (st === "WON" || st === "WIN") return { cls: "b-won", txt: "WIN" };
  if (st === "LOST" || st === "LOSS") return { cls: "b-lost", txt: "LOSS" };
  if (st === "CLOSED") return { cls: "b-lost", txt: "CLOSED" };
  return { cls: "b-open", txt: "OPEN" };
}

export default function TradingPage() {
  const [data, setData] = useState<TradeData>(EMPTY);
  const [source, setSource] = useState<{ ok: boolean; label: string }>({
    ok: false,
    label: "กำลังโหลด…",
  });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(dataUrl("/data.json"), { cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        if (j && Array.isArray(j.trades)) {
          setData({
            trades: j.trades || [],
            signals: j.signals || [],
            perf: j.perf || [],
          });
          setSource({ ok: true, label: "Google Sheets (auto)" });
        }
      } else {
        // offline fallback
        setData(EMPTY);
        setSource({ ok: false, label: "offline · sample data" });
      }
    } catch (e) {
      setErr("โหลดข้อมูลล้มเหลว: " + (e instanceof Error ? e.message : String(e)));
      setSource({ ok: false, label: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // refresh every min
    return () => clearInterval(t);
  }, [load]);

  const kpis = useMemo(() => {
    const trades = data.trades;
    const perf = data.perf;
    const signals = data.signals;
    const total = trades.length;
    const wins = trades.filter((t) => num(t.netPnl) > 0).length;
    const losses = trades.filter((t) => num(t.netPnl) < 0).length;
    const winRate = total ? ((wins / total) * 100).toFixed(1) : "0.0";
    const netPnL = trades.reduce((s, t) => s + num(t.netPnl), 0);
    const bal = perf.length ? num(perf[perf.length - 1].balance) : 0;
    const openSignals = signals.filter((s) => String(s.status).toUpperCase() === "OPEN").length;
    return [
      { lbl: "Total Trades", val: String(total), note: "ปิดแล้วทั้งหมด" },
      { lbl: "Win Rate", val: winRate + "%", note: `${wins}W / ${losses}L`, pct: true },
      { lbl: "Net P&L", val: (netPnL >= 0 ? "+" : "") + fmtMoney(netPnL), note: "กำไร-ขาดทุนสะสม", up: netPnL >= 0 },
      { lbl: "Balance", val: bal ? fmtMoney(bal) : "—", note: "ล่าสุด" },
      {
        lbl: "Open Positions",
        val: String(trades.filter((t) => String(t.status).toUpperCase() === "OPEN").length + openSignals),
        note: "open positions",
      },
    ];
  }, [data]);

  const perfRows = useMemo(() => data.perf.slice().reverse().slice(0, 20), [data.perf]);
  const pnlBars = useMemo(() => {
    const d = data.perf.slice(-14);
    const max = Math.max(...d.map((x) => Math.abs(num(x.netPnl))), 1);
    return d.map((x) => {
      const v = num(x.netPnl);
      const h = Math.max(2, (Math.abs(v) / max) * 100);
      return { v, h, up: v >= 0, date: String(x.date || "").slice(0, 10), label: (x.date || "").slice(5, 10) };
    });
  }, [data.perf]);

  const tradeRows = useMemo(() => data.trades.slice().reverse().slice(0, 30), [data.trades]);
  const signalRows = useMemo(() => data.signals.slice().reverse().slice(0, 25), [data.signals]);

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>
            Trading Bot <span className="dot">Dashboard</span>
          </h1>
          <div className="sub">XAUUSD (Gold) · BTCUSD · Multi-Timeframe Trend Following</div>
        </div>
        <div className={"live" + (source.ok ? " ok" : "")}>
          <span className="pd" />
          <span>{source.ok ? "● live · " + source.label : "● " + source.label}</span>
        </div>
      </header>

      <div className="src">
        แหล่งข้อมูล: Google Sheets (Trading Bot Log) · auto-sync (data.json){" "}
        {loading ? "· กำลังโหลด…" : ""}
      </div>

      {err && <div className="err">⚠ {err}</div>}

      <section className="kpis">
        {kpis.map((k) => (
          <div className="kpi" key={k.lbl}>
            <div className="lbl">{k.lbl}</div>
            <div className={"val" + (k.up === undefined ? "" : k.up ? " up" : " down")}>
              {k.val}
            </div>
            <div className="note">{k.note}</div>
          </div>
        ))}
      </section>

      <div className="grid2">
        <div className="cards-sec">
          <h2>
            📊 Performance <span className="tag">รายวัน</span>
          </h2>
          {perfRows.length === 0 ? (
            <div className="empty">
              <div className="big">📊</div>
              {EMPTY_MSG}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Trades</th>
                  <th>Wins</th>
                  <th>Losses</th>
                  <th>Winrate</th>
                  <th>Net P&L</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {perfRows.map((p, i) => (
                  <tr key={i}>
                    <td>{String(p.date || "").slice(0, 10)}</td>
                    <td>{num(p.totalTrades)}</td>
                    <td className="up">{num(p.wins)}</td>
                    <td className="down">{num(p.losses)}</td>
                    <td>{num(p.winrate)}%</td>
                    <td className={num(p.netPnl) >= 0 ? "up" : "down"}>
                      {num(p.netPnl) >= 0 ? "+" : ""}
                      {fmtMoney(num(p.netPnl))}
                    </td>
                    <td>{num(p.balance) ? fmtMoney(num(p.balance)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="cards-sec">
          <h2>
            💹 P&L <span className="tag">Net / วัน</span>
          </h2>
          {pnlBars.length === 0 ? (
            <div className="empty" style={{ padding: "0 0 28px" }}>
              <div className="big">📈</div>
              P&L ยังว่าง
            </div>
          ) : (
            <div className="bars" style={{ paddingTop: "18px" }}>
              {pnlBars.map((b, i) => (
                <div
                  key={i}
                  className="bar"
                  style={{
                    height: b.h + "%",
                    background: b.up
                      ? "var(--accent)"
                      : "linear-gradient(180deg,var(--down),var(--down))",
                  }}
                  title={`${b.date}: ${fmtMoney(b.v)}`}
                >
                  <span>{fmtMoney(b.v)}</span>
                  <div className="lbl">{b.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="cards-sec">
        <h2>
          🛒 Trades <span className="tag">{tradeRows.length} rows</span>
        </h2>
        {tradeRows.length === 0 ? (
          <div className="empty">
            <div className="big">🛒</div>
            {EMPTY_MSG}
          </div>
        ) : (
          <table style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Direction</th>
                <th>Entry</th>
                <th>TP</th>
                <th>Net P&L</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tradeRows.map((t, i) => {
                const st = statusBadge(t.status);
                const dir = (t.direction || "").toUpperCase();
                return (
                  <tr key={i}>
                    <td>{fmtTimestamp(t.timestamp) || "—"}</td>
                    <td>{t.symbol || ""}</td>
                    <td className={"sig " + dir}>
                      {t.direction || ""} {t.volume !== undefined && t.volume !== "" ? "· " + t.volume : ""}
                    </td>
                    <td>{t.entry ?? ""}</td>
                    <td>{t.tp ?? ""}</td>
                    <td className={num(t.netPnl) >= 0 ? "up" : "down"}>
                      {num(t.netPnl) ? (num(t.netPnl) >= 0 ? "+" : "") + fmtMoney(num(t.netPnl)) : "—"}
                    </td>
                    <td>
                      <span className={"b-toggle " + st.cls}>{st.txt}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="cards-sec">
        <h2>
          📡 Signals <span className="tag">live จาก sheet</span>
        </h2>
        {signalRows.length === 0 ? (
          <div className="empty">
            <div className="big">📡</div>
            {EMPTY_MSG}
          </div>
        ) : (
          <table style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Signal</th>
                <th>Conf</th>
                <th>D1/H1</th>
                <th>Entry Zone</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {signalRows.map((s, i) => {
                const sigStr = (s.signal || s.direction || "").toUpperCase();
                return (
                  <tr key={i}>
                    <td>{fmtTimestamp(s.timestamp) || "—"}</td>
                    <td>{s.symbol || ""}</td>
                    <td className={"sig " + sigStr}>{s.signal || s.direction || ""}</td>
                    <td>{s.confidence || "—"}</td>
                    <td>
                      {s.d1Trend || ""}
                      {s.h1Trend ? " · " + s.h1Trend : ""}
                    </td>
                    <td>{s.entryZone || ""}</td>
                    <td>{s.status || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <footer>Auto-generated by Hermes · data read live from Google Sheets (auto-sync)</footer>
    </div>
  );
}
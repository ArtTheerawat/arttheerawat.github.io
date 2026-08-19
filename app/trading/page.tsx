"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Activity, ShoppingCart, Radio } from "lucide-react";
import { fmtMoney, fmtTimestamp, num, dataStatusBadge, fmtUpdatedAt, type DataStatus } from "@/lib/data";
import { loadTrading, EMPTY_TRADING, EMPTY_TRADING_MSG } from "@/lib/services/trading-service";
import type { Trade, Signal, PerfDay } from "@/lib/db/types";

interface TradeData {
  trades: Trade[];
  signals: Signal[];
  perf: PerfDay[];
}

const EMPTY: TradeData = EMPTY_TRADING;
const EMPTY_MSG = EMPTY_TRADING_MSG;

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
  const [status, setStatus] = useState<DataStatus>("error");
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return; // no overlap / duplicate while a request is pending
    inFlight.current = true;
    setLoading(true);
    setErr(null);
    try {
      const result = await loadTrading();
      setData(result.data);
      setSource(result.source);
      setStatus(result.status);
      setUpdatedAt(result.updatedAt);
      setErr(result.error);
    } catch (e) {
          // loadTrading already catches its own errors and returns fallback/error
          // data, so this is defensive only. Keep whatever data is already shown
          // rather than wiping to a blank screen on a transient failure.
          setErr("โหลดข้อมูลล้มเหลว: " + (e instanceof Error ? e.message : String(e)));
          setSource({ ok: false, label: "error" });
          setStatus("error");
          setUpdatedAt("");
        } finally {
          inFlight.current = false;
          setLoading(false);
        }
      }, []);

  const pollRef = useRef<number | null>(null);
  const schedulePoll = useCallback(() => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    pollRef.current = window.setTimeout(async () => {
      await load();
      schedulePoll();
    }, 60000);
  }, [load]);
  useEffect(() => {
    void load();
    schedulePoll();
    const onVisible = () => {
      // Tab became visible again → one immediate refresh to combat stale data.
      void load();
      schedulePoll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
      pollRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, schedulePoll]);

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
    <div className="wrap" id="main">
      <header>
        <div>
          <h1>
            Trading Bot <span className="dot">Dashboard</span>
          </h1>
          <div className="sub">XAUUSD (Gold) · BTCUSD · Multi-Timeframe Trend Following</div>
        </div>
        <div className="header-status">
                  <span className={"badge " + dataStatusBadge(status).cls}>{dataStatusBadge(status).txt}</span>
                  <span className="src-label">{source.label}</span>
                  {updatedAt && (
                    <span className="updated">อัปเดตล่าสุด {fmtUpdatedAt(updatedAt)}</span>
                  )}
                </div>
              </header>

              <div className="src">
                      แหล่งข้อมูล: Google Sheets (Trading Bot Log) · auto-sync (data.json){" "}
                      {loading ? "· กำลังโหลด…" : ""}
                    </div>

                    {err && (
                      <div role="alert" className="err">
                        ⚠ {err}{" "}
                        <button
                          type="button"
                          className="retry-btn"
                          onClick={() => void load()}
                          disabled={loading}
                        >
                          {loading ? "กำลังลองใหม่…" : "ลองใหม่"}
                        </button>
                      </div>
                    )}

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
                      <BarChart3 aria-hidden="true" /> Performance <span className="tag">รายวัน</span>
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
                      <Activity aria-hidden="true" /> P&L <span className="tag">Net / วัน</span>
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
                  <ShoppingCart aria-hidden="true" /> Trades <span className="tag">{tradeRows.length} rows</span>
                </h2>
        {tradeRows.length === 0 ? (
          <div className="empty">
            <div className="big">🛒</div>
            {EMPTY_MSG}
          </div>
        ) : (
          <table className="tbl desk-only" style={{ fontSize: 13 }}>
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
                            {/* ── Mobile: cards instead of wide horizontal-scroll table ── */}
                            {tradeRows.length > 0 && (
                              <div className="mob-trades">
                                <div className="mob-list">
                                  {tradeRows.map((t, i) => {
                                    const st = statusBadge(t.status);
                                    const dir = (t.direction || "").toUpperCase();
                                    const pnl = num(t.netPnl);
                                    return (
                                      <div className="mob-card" key={i}>
                                        <div className="mob-time">
                                          {fmtTimestamp(t.timestamp) || "—"}
                                          <span className="mob-chip">
                                            <span className={"b-toggle " + st.cls}>{st.txt}</span>
                                          </span>
                                        </div>
                                        <div className="mob-nm">
                                          {t.symbol || ""}
                                          <span className={"sig " + dir} style={{ marginLeft: 6 }}>
                                            {t.direction || ""} {t.volume !== undefined && t.volume !== "" ? "· " + t.volume : ""}
                                          </span>
                                        </div>
                                        <div className="t-card-grid">
                                          <span className="t-card-lbl">Entry</span>
                                          <span>{t.entry ?? "—"}</span>
                                          <span className="t-card-lbl">TP</span>
                                          <span>{t.tp ?? "—"}</span>
                                          <span className="t-card-lbl">Net P&L</span>
                                          <span className={pnl >= 0 ? "up" : "down"}>
                                            {pnl ? (pnl >= 0 ? "+" : "") + fmtMoney(pnl) : "—"}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
      </div>

      <div className="cards-sec">
        <h2>
                  <Radio aria-hidden="true" /> Signals <span className="tag">live จาก sheet</span>
                </h2>
        {signalRows.length === 0 ? (
          <div className="empty">
            <div className="big">📡</div>
            {EMPTY_MSG}
          </div>
        ) : (
                  <table className="tbl desk-only" style={{ fontSize: 13 }}>
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
                    {/* ── Mobile: cards instead of wide horizontal-scroll table ── */}
                    {signalRows.length > 0 && (
                      <div className="mob-trades">
                        <div className="mob-list">
                          {signalRows.map((s, i) => {
                            const sigStr = (s.signal || s.direction || "").toUpperCase();
                            return (
                              <div className="mob-card" key={i}>
                                <div className="mob-time">
                                  {fmtTimestamp(s.timestamp) || "—"}
                                  <span className="mob-chip">
                                    <span className={"b-toggle b-open"}>{s.status || "—"}</span>
                                  </span>
                                </div>
                                <div className="mob-nm">
                                  {s.symbol || ""}
                                  <span className={"sig " + sigStr} style={{ marginLeft: 6 }}>
                                    {s.signal || s.direction || ""}
                                  </span>
                                </div>
                                <div className="t-card-grid">
                                  <span className="t-card-lbl">Conf</span>
                                  <span>{s.confidence || "—"}</span>
                                  <span className="t-card-lbl">D1/H1</span>
                                  <span>
                                    {s.d1Trend || ""}
                                    {s.h1Trend ? " · " + s.h1Trend : ""}
                                  </span>
                                  <span className="t-card-lbl">Entry</span>
                                  <span>{s.entryZone || "—"}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <footer>Auto-generated by Hermes · data read live from Google Sheets (auto-sync)</footer>
    </div>
  );
}
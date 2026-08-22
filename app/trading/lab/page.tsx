"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FlaskConical, TrendingUp, Shuffle, Grid3X3 } from "lucide-react";

type Metrics = { hypo:string; name:string; trades:number; winrate:number; profit_factor:number; max_dd:number; expectancy:number; total_return:number; final_equity:number };
type MC = { n_sims:number; final_p05:number; final_median:number; final_p95:number; ruin_prob:number; prob_loss:number };
type Corr = { strategies:string[]; corr:Record<string,Record<string,number>> };

const FALLBACK_IDS=["breakout_d40","macd_rsi","trend_ema","rsi_bb","long_trend"] as const;

function fmt(n:number,d=2){ return isFinite(n)?n.toFixed(d):"—"; }

function corrColor(v:number){
  const a=Math.abs(v);
  if(v>=0.95) return "rgba(239,68,68,.85)";
  if(a>=0.5) return v>0?"rgba(245,158,11,.75)":"rgba(59,130,246,.7)";
  if(a>=0.2) return v>0?"rgba(245,158,11,.35)":"rgba(59,130,246,.35)";
  return "rgba(255,255,255,.06)";
}

export default function LabPage(){
  const [metrics,setMetrics]=useState<Record<string,Metrics>>({});
  const [mcs,setMcs]=useState<Record<string,MC>>({});
  const [corr,setCorr]=useState<Corr|null>(null);
  const [hypo,setHypo]=useState<Record<string,{name:string}>>({});
  const [ids,setIds]=useState<string[]>([...FALLBACK_IDS]);
  const [err,setErr]=useState("");

  useEffect(()=>{
    let alive=true;
    (async()=>{
      try{
        const fetchJson=async(url:string)=>{
          const r=await fetch(url,{cache:"no-store"});
          if(!r.ok) throw new Error(url+": "+r.status);
          return r.json();
        };
        const h=await fetchJson("/lab/hypotheses.json").catch(()=>null);
        const curIds = h ? Object.keys(h) : [...FALLBACK_IDS];
        if(alive){
          if(h) setHypo(h);
          setIds(curIds);
        }
        // fetch all metrics/mc in parallel
        const results=await Promise.all(curIds.map(async id=>{
          const [m,mc]=await Promise.all([fetchJson(`/lab/${id}_metrics.json`), fetchJson(`/lab/${id}_mc.json`)]);
          return {id,m,mc};
        }));
        if(!alive) return;
        const mm:Record<string,Metrics>={}; const cc:Record<string,MC>={};
        for(const {id,m,mc} of results){ mm[id]=m; cc[id]=mc; }
        setMetrics(mm); setMcs(cc);
        const c:Corr=await fetchJson("/lab/correlation.json");
        if(alive) setCorr(c);
      }catch(e){ if(alive) setErr(String(e)); }
    })();
    return ()=>{ alive=false; };
  },[]);

  return (
    <div className="wrap" id="main">
      <header>
        <div>
          <h1><FlaskConical size={20} style={{display:"inline",verticalAlign:"-3px",marginRight:6}}/>Backtest Lab <span className="dot">XAUUSD D1 · Tuned</span></h1>
          <div className="sub">GC=F 503 วัน · {ids.length} กลยุทธ์จูน 1,095 combos · Monte Carlo 2000 · Correlation 5×5 · อัปเดต {new Date().toLocaleDateString("th-TH")}</div>
        </div>
        <Link href="/trading" className="retry-btn" style={{textDecoration:"none",display:"inline-flex",alignItems:"center",gap:6}}><ArrowLeft size={13}/>กลับ Trading</Link>
      </header>

      {err && <div className="err">{err}</div>}

      <div className="cards-sec">
        <h2><TrendingUp/> Metrics <span className="tag">{ids.length} strategies · tuned</span></h2>
        <div style={{overflowX:"auto"}}>
        <table>
          <thead><tr><th>Strategy</th><th>Trades</th><th>Winrate</th><th>PF</th><th>MaxDD</th><th>Expectancy</th><th>Total Ret</th><th>Final Eq</th></tr></thead>
          <tbody>
            {ids.map(id=>{
              const m=metrics[id];
              if(!m) return <tr key={id}><td>{hypo[id]?.name||id}</td><td colSpan={7} style={{color:"var(--muted)"}}>loading…</td></tr>;
              return (
                <tr key={id}>
                  <td style={{fontWeight:600}}>{m.name||hypo[id]?.name||id}</td>
                  <td>{m.trades}</td>
                  <td>{fmt(m.winrate*100,1)}%</td>
                  <td className={m.profit_factor>=1?"up":"down"}>{fmt(m.profit_factor,2)}</td>
                  <td className="down">{fmt(m.max_dd*100,1)}%</td>
                  <td className={m.expectancy>=0?"up":"down"}>{fmt(m.expectancy,2)}</td>
                  <td className={m.total_return>=0?"up":"down"}>{fmt(m.total_return*100,1)}%</td>
                  <td>${fmt(m.final_equity,2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      <div className="cards-sec">
        <h2><Shuffle/> Monte Carlo <span className="tag">p05 / median / p95 · ruin · 2000 sims</span></h2>
        <div style={{overflowX:"auto"}}>
        <table>
          <thead><tr><th>Strategy</th><th>p05</th><th>Median</th><th>p95</th><th>Ruin prob</th><th>Prob loss</th></tr></thead>
          <tbody>
            {ids.map(id=>{
              const mc=mcs[id];
              if(!mc) return <tr key={id}><td>{hypo[id]?.name||id}</td><td colSpan={5} style={{color:"var(--muted)"}}>loading…</td></tr>;
              return (
                <tr key={id}>
                  <td style={{fontWeight:600}}>{hypo[id]?.name||id}</td>
                  <td>${fmt(mc.final_p05,2)}</td>
                  <td>${fmt(mc.final_median,2)}</td>
                  <td>${fmt(mc.final_p95,2)}</td>
                  <td className={mc.ruin_prob>0?"down":"up"}>{fmt(mc.ruin_prob*100,1)}%</td>
                  <td>{fmt(mc.prob_loss*100,1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      <div className="cards-sec">
        <h2><Grid3X3/> Correlation <span className="tag">daily PnL · {ids.length}×{ids.length} · tuned</span></h2>
        {!corr ? <div className="src">loading…</div> : (
          <div style={{overflowX:"auto"}}>
          <table>
            <thead><tr><th></th>{corr.strategies.map(s=><th key={s}>{hypo[s]?.name||s}</th>)}</tr></thead>
            <tbody>
              {corr.strategies.map(row=>(
                <tr key={row}>
                  <th style={{color:"var(--txt)",textTransform:"none",letterSpacing:0}}>{hypo[row]?.name||row}</th>
                  {corr.strategies.map(col=>{
                    const v=corr.corr[row]?.[col]??0;
                    return <td key={col} style={{background:corrColor(v),fontWeight:row===col?700:400,textAlign:"center",borderRadius:6}}>{fmt(v,2)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <div className="src" style={{marginTop:8}}>corr &gt; 0.5 = กลยุทธ์ซ้ำซ้อน · สีเข้ม = สหสัมพันธ์สูง</div>
      </div>

      <div className="cards-sec">
        <h2>Equity Curves</h2>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/lab/equity_curves.png" alt="equity curves" style={{width:"100%",borderRadius:10,border:"1px solid var(--border)"}}/>
      </div>

      <footer>Backtest Lab · GC=F 503 bars · Tuned 1,095 combos · <Link href="/trading">→ Trading Dashboard</Link> · <a href="/lab/TUNED_REPORT.md" target="_blank" style={{color:"var(--accent)"}}>Tuned Report</a></footer>
    </div>
  );
}

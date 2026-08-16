/* Trading Bot Dashboard — reads live CSV from Google Sheets (publish-to-web)
 * EDIT THESE with your real published-CSV URLs (see header comment in index.html)
 * Each CSV = Google Sheet tab published as CSV.
 *   Google Sheets -> File -> Share -> Publish to web -> pick tab -> CSV -> copy link
 * Empty string = fall back to embedded sample data / data.json below. */
const TRADES_CSV_URL  = "";  // Trades tab  (Timestamp,Type,Symbol,Direction,...)
const SIGNALS_CSV_URL = "";  // Signals tab (Timestamp,Symbol,Signal,Direction,...)
const PERF_CSV_URL    = "";  // Performance tab (Date,Total Trades,Wins,Losses,...)

/* ── Auto-generated data source (real Google Sheet data, pushed by generate_data.py).
   When data.json exists, the dashboard reads live data from it (preferred). 
   If any *_CSV_URL above is set, those override data.json for that section. */
const DATA_JSON_URL = "data.json";

/* ── Embeded fallback data (until real public CSV links are pasted in).
   Mirrors the actual schema of the Trading Bot Log sheet. */
const FALLBACK = {
  trades: [ ],
  signals: [
    ["46249.06","XAUUSDc","NONE","DOWN","","DOWN","","","","","","","OPEN",""],
    ["46249.33","BTCUSDm","SELL","SELL","LOW","DOWN","","","","","","","OPEN",""],
    ["46249.33","BTCUSDm","SELL","SELL","LOW","DOWN","","","","","","","OPEN",""],
    ["46249.34","BTCUSDm","SELL","SELL","LOW","DOWN","","","","","","","OPEN",""],
  ],
  perf: [ ]
};

const $ = id => document.getElementById(id);
const num = v => { const n = parseFloat(String(v).replace(/[,$₹\s]/g,'')); return isNaN(n) ? 0 : n; };
const fmtMoney = v => new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(v);
const fmtDate = t => { if(!t) return null; const n=num(t); if(n>40000) return new Date((n-25569)*86400*1000).toLocaleString('th-TH',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); return String(t); };

async function fetchCSV(url){
  if(!url) return null;
  const res = await fetch(url, {cache:'no-store', mode:'cors'});
  if(!res.ok) throw new Error('HTTP '+res.status+' on '+url);
  return parseCSV(await res.text());
}
function parseCSV(text){
  const rows=[]; let row=[], cur='', q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else if(c==='"' && cur===''){ q=true; }
    else if(c===','){ row.push(cur); cur=''; }
    else if(c==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; }
    else if(c==='\r'){}
    else cur+=c;
  }
  if(cur!==''||row.length){ row.push(cur); rows.push(row); }
  return rows.filter(r=>r.some(c=>String(c).trim()!==''));
}

function buildLookup(rows){ const o={}; if(rows.length) rows[0].forEach((h,i)=>o[String(h).trim()]=i); return o; }

function liveBadge(ok, extra){
  const b=$('livebadge'); b.classList.toggle('ok', ok);
  $('livetxt').textContent = ok ? ('● live · '+extra) : '● offline · sample data';
}
function showErr(m){
  const e=$('errbox'); e.style.display='block'; e.textContent='⚠ '+m;
}

function renderKpis(trades, perf, signals){
  const total=trades.length;
  const wins=trades.filter(t=>num(t.netPnl)>0).length;
  const losses=trades.filter(t=>num(t.netPnl)<0).length;
  const winRate=total? (wins/total*100).toFixed(1): '0.0';
  const netPnL=trades.reduce((s,t)=>s+num(t.netPnl),0);
  const bal=(perf.length && num(perf[perf.length-1].balance)) || 0;
  const openSignals=signals.filter(s=>String(s.status).toUpperCase()==='OPEN').length;

  const html=`
    <div class="kpi"><div class="lbl">Total Trades</div><div class="val">${total}</div><div class="note">ปิดแล้วทั้งหมด</div></div>
    <div class="kpi"><div class="lbl">Win Rate</div><div class="val">${winRate}<span class="pct">%</span></div><div class="note">${wins}W / ${losses}L</div></div>
    <div class="kpi"><div class="lbl">Net P&L</div><div class="val ${netPnL>=0?'up':'down'}">${netPnL>=0?'+':''}${fmtMoney(netPnL)}</div><div class="note">กำไร-ขาดทุนสะสม</div></div>
    <div class="kpi"><div class="lbl">Balance</div><div class="val">${bal?fmtMoney(bal):'—'}</div><div class="note">ล่าสุด</div></div>
    <div class="kpi"><div class="lbl">Open Positions</div><div class="val">${trades.filter(t=>String(t.status).toUpperCase()==='OPEN').length+openSignals}</div><div class="note">son positions</div></div>
  `;
  $('kpis').innerHTML=html;
}

function renderPerfTable(perf){
  const a=$('perfArea');
  if(!perf.length){ a.innerHTML=`<div class="empty"><div class="big">📊</div>ยังไม่มีข้อมูล Performance<br><span style="font-size:12px">เมื่อ bot ปิด trade ครบ รายวันจะโผล่ที่นี่</span></div>`; return; }
  const rows=perf.slice().reverse().slice(0,20).map(p=>`
    <tr>
      <td>${String(p.date||'').slice(0,10)}</td>
      <td>${num(p.totalTrades)}</td>
      <td class="up">${num(p.wins)}</td>
      <td class="down">${num(p.losses)}</td>
      <td>${num(p.winrate)}%</td>
      <td class="${num(p.netPnl)>=0?'up':'down'}">${num(p.netPnl)>=0?'+':''}${fmtMoney(num(p.netPnl))}</td>
      <td>${num(p.balance)?fmtMoney(num(p.balance)):'—'}</td>
    </tr>`).join('');
  a.innerHTML=`<table><tr><th>Date</th><th>Trades</th><th>Wins</th><th>Losses</th><th>Winrate</th><th>Net P&L</th><th>Balance</th></tr>${rows}</table>`;
}

function renderPnlBars(perf){
  const c=$('pnlBars');
  if(!perf.length){ c.innerHTML=`<div class="empty" style="padding:0 0 28px"><div class="big">📈</div>P&L ยังว่าง</div>`; return; }
  const data=perf.slice(-14);
  const max=Math.max(...data.map(d=>Math.abs(num(d.netPnl))),1);
  c.innerHTML=data.map(d=>{
    const v=num(d.netPnl); const h=Math.max(2, Math.abs(v)/max*100);
    const color=v>=0?'var(--accent)':'linear-gradient(180deg,var(--down),var(--down))';
    return `<div class="bar" style="height:${h}%;background:${color}" title="${String(d.date).slice(0,10)}: ${fmtMoney(v)}">
      <span>${fmtMoney(v)}</span><div class="lbl">${String(d.date).slice(5,10)}</div></div>`;
  }).join('');
}

function renderTrades(trades){
  const a=$('tradesArea'); $('tradesCount').textContent=trades.length+' rows';
  if(!trades.length){ a.innerHTML=`<div class="empty"><div class="big">🛒</div>ยังไม่มี Trades<br><span style="font-size:12px">จะ auto-show เมื่อ bot เปิด/ปิด position จริง</span></div>`; return; }
  const rows=trades.slice().reverse().slice(0,30).map(t=>{
    const st=String(t.status||'OPEN').toUpperCase();
    const badgeClass = st==='WON'||st==='WIN'?'b-won': st==='LOST'||st==='LOSS'||st==='CLOSED'?'': 'b-open';
    const badgeTxt = st==='WON'?'WIN': st==='LOST'?'LOSS': st==='CLOSED'?'CLOSED':'OPEN';
    return `<tr>
      <td>${fmtDate(t.timestamp)||'—'}</td>
      <td>${t.symbol||''}</td>
      <td class="sig ${(t.direction||'').toUpperCase()}">${t.direction||''} ${t.volume?('· '+t.volume):''}</td>
      <td>${t.entry||''}</td>
      <td>${t.tp||''}</td>
      <td class="${num(t.netPnl)>=0?'up':'down'}">${num(t.netPnl)?((num(t.netPnl)>=0?'+':'')+fmtMoney(num(t.netPnl))):'—'}</td>
      <td><span class="badge ${badgeClass}">${badgeTxt}</span></td>
    </tr>`;
  }).join('');
  a.innerHTML=`<table style="font-size:13px"><tr><th>Time</th><th>Symbol</th><th>Direction</th><th>Entry</th><th>TP</th><th>Net P&L</th><th>Status</th></tr>${rows}</table>`;
}

function renderSignals(signals){
  const a=$('signalsArea');
  const sigs=signals.slice().reverse().slice(0,25);
  if(!sigs.length){ a.innerHTML=`<div class="empty"><div class="big">📡</div>ยังไม่มี Signals</div>`; return; }
  const rows=sigs.map(s=>`
    <tr>
      <td>${fmtDate(s.timestamp)||'—'}</td>
      <td>${s.symbol||''}</td>
      <td class="sig ${(s.signal||s.direction||'').toUpperCase()}">${(s.signal||s.direction||'')}</td>
      <td>${s.confidence||'—'}</td>
      <td>${s.d1Trend||''} ${s.h1Trend?('· '+s.h1Trend):''}</td>
      <td>${s.entryZone||''}</td>
      <td>${s.status||'—'}</td>
    </tr>`).join('');
  a.innerHTML=`<table style="font-size:13px"><tr><th>Time</th><th>Symbol</th><th>Signal</th><th>Conf</th><th>D1/H1</th><th>Entry Zone</th><th>Status</th></tr>${rows}</table>`;
}

async function main(){
  try{
    let trades=[], signals=[], perf=[];
    const hasCSV = TRADES_CSV_URL || SIGNALS_CSV_URL || PERF_CSV_URL;
    let loadedJson = false;

    // 1) Primary source: auto-generated data.json (real sheet data pushed by cron)
    try{
      const res = await fetch(DATA_JSON_URL + '?t=' + Date.now(), {cache:'no-store'});
      if(res.ok){
        const j = await res.json();
        if(j && Array.isArray(j.trades)){
          trades = j.trades || [];
          signals = j.signals || [];
          perf = j.perf || [];
          loadedJson = true;
        }
      }
    }catch(e){ /* data.json optional */ }

    // 2) CSV URL overrides (per-section)
    if(TRADES_CSV_URL){ try{ const r=await fetchCSV(TRADES_CSV_URL); if(r&&r.length>1){ const L=buildLookup(r); trades=r.slice(1).map(x=>({timestamp:x[L['Timestamp']],type:x[L['Type']],symbol:x[L['Symbol']],direction:x[L['Direction']],volume:x[L['Volume']],entry:x[L['Entry']],sl:x[L['SL']],tp:x[L['TP']],exit:x[L['Exit']],profit:x[L['Profit']],swap:x[L['Swap']],commission:x[L['Commission']],netPnl:x[L['Net P&L']],status:x[L['Status']],signalReason:x[L['Signal Reason']],strategy:x[L['Strategy']],risk:x[L['Risk %']],balance:x[L['Account Balance']],notes:x[L['Notes']]})); } } catch(e){ showErr('Trades: '+e.message); } }
    if(SIGNALS_CSV_URL){ try{ const r=await fetchCSV(SIGNALS_CSV_URL); if(r&&r.length>1){ const L=buildLookup(r); signals=r.slice(1).map(x=>({timestamp:x[L['Timestamp']],symbol:x[L['Symbol']],signal:x[L['Signal']],direction:x[L['Direction']],confidence:x[L['Confidence']],d1Trend:x[L['D1 Trend']],h1Trend:x[L['H1 Trend']],rsi:x[L['RSI']],atr:x[L['ATR']],entryZone:x[L['Entry Zone']],sl:x[L['SL']],tp:x[L['TP']],status:x[L['Status']],notes:x[L['Notes']]})); } } catch(e){ showErr('Signals: '+e.message); } }
    if(PERF_CSV_URL){ try{ const r=await fetchCSV(PERF_CSV_URL); if(r&&r.length>1){ const L=buildLookup(r); perf=r.slice(1).map(x=>({date:x[L['Date']],totalTrades:x[L['Total Trades']],wins:x[L['Wins']],losses:x[L['Losses']],winrate:x[L['Winrate %']],netPnl:x[L['Net P&L']],maxDrawdown:x[L['Max Drawdown']],avgRr:x[L['Avg RR']],balance:x[L['Balance']],equityPeak:x[L['Equity Peak']],equityLow:x[L['Equity Low']]})); } } catch(e){ showErr('Performance: '+e.message); } }

    // 3) Fallback: embedded sample (only if nothing loaded from JSON/CSV)
    if(!loadedJson && !hasCSV){
      trades=(FALLBACK.trades||[]).map(r=>({timestamp:r[0],type:r[1],symbol:r[2],direction:r[3],volume:r[4],entry:r[5],sl:r[6],tp:r[7],exit:r[8],profit:r[9],swap:r[10],commission:r[11],netPnl:r[12],status:r[13],signalReason:r[14],strategy:r[15],risk:r[16],balance:r[17],notes:r[18]}));
      signals=(FALLBACK.signals||[]).map(r=>({timestamp:r[0],symbol:r[1],signal:r[2],direction:r[3],confidence:r[4],d1Trend:r[5],h1Trend:r[6],rsi:r[7],atr:r[8],entryZone:r[9],sl:r[10],tp:r[11],status:r[12],notes:r[13]}));
      perf=(FALLBACK.perf||[]).map(r=>({date:r[0],totalTrades:r[1],wins:r[2],losses:r[3],winrate:r[4],netPnl:r[5],maxDrawdown:r[6],avgRr:r[7],balance:r[8],equityPeak:r[9],equityLow:r[10]}));
    }

    // Status badge / source info
    if(loadedJson){
      liveBadge(true, 'Google Sheets (auto)');
      $('sourceInfo').textContent='แหล่งข้อมูล: Google Sheets (Trading Bot Log) · auto-sync (data.json)';
    } else if(hasCSV){
      liveBadge(true, 'Google Sheets CSV');
      $('sourceInfo').textContent='แหล่งข้อมูล: Google Sheets (Trading Bot Log) · เผยแพร่เป็น CSV';
    } else {
      liveBadge(false, 'sample data');
      $('sourceInfo').innerHTML='<b>โหมด demo</b> · ยังไม่ได้เชื่อม data.json/CSV → โชว์ข้อมูลตัวอย่าง.<br>ขั้นตอน: ใส่ URL ใน <code>dashboard.js</code> หรือวาง <code>data.json</code>';
    }

    renderKpis(trades, perf, signals);
    renderPerfTable(perf);
    renderPnlBars(perf);
    renderTrades(trades);
    renderSignals(signals);
  }catch(e){
    console.error(e);
    liveBadge(false,'error');
    showErr('โหลดข้อมูลล้มเหลว: '+e.message);
  }
}
main();
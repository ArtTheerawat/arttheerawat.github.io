function elapsedOf(s, now){ return s.running ? s.accumulated + (now - s.startedAt) : s.accumulated; }
function fmtHMS(ms){
  const total = Math.max(0, Math.floor(ms/1000));
  const h = Math.floor(total/3600), m = Math.floor((total%3600)/60), s = total%60;
  const mm=String(m).padStart(2,"0"), ss=String(s).padStart(2,"0");
  return h>0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
function taskKey(a){ return [(a.course||"").trim(),(a.title||"").trim(),(a.due||"").trim()].join("|"); }

let pass=0, fail=0;
function eq(name, got, exp){ if(got===exp){pass++; console.log("  ok", name);} else {fail++; console.log("  FAIL", name, "got", JSON.stringify(got), "expected", JSON.stringify(exp));} }

console.log("1) Tab-inactive safety: elapsed from Date.now, not ticks");
const t0=1000000;
let s={running:true, startedAt:t0, accumulated:0};
eq("elapsed after 5min inactivity", elapsedOf(s, t0+300000), 300000);

console.log("2) Pause freezes accumulated");
const acc=elapsedOf(s, t0+300000, ); // 300000
let pState={running:false, startedAt:0, accumulated:acc};
eq("paused stays 300000 even long later", elapsedOf(pState, t0+99999999), 300000);

console.log("3) Resume adds on top of accumulated");
let rState={running:true, startedAt:t0+310000, accumulated:300000};
eq("resumed +10s", elapsedOf(rState, t0+320000), 310000);

console.log("4) Reset zeroes");
eq("reset", elapsedOf({running:false, startedAt:0, accumulated:0}, 99999999), 0);

console.log("5) fmtHMS");
eq("59s", fmtHMS(59000), "00:59");
eq("1m", fmtHMS(60000), "01:00");
eq("1h", fmtHMS(3600000), "1:00:00");
eq("25h50m", fmtHMS(25*3600000+50*60000), "25:50:00");

console.log("6) taskKey + lookup");
const all=[{title:"ยืนยันการเข้าเรียน",course:"88622065",courseName:"Data Structures",due:"2026-08-07",workType:"ASSIGNMENT",points:1}];
const key=taskKey(all[0]);
eq("key built", key, "88622065|ยืนยันการเข้าเรียน|2026-08-07");
eq("lookup found", all.find(a=>taskKey(a)===key)?.title, "ยืนยันการเข้าเรียน");
eq("lookup not found (empty key)", all.find(a=>taskKey(a)==="") || null, null);

console.log("\nRESULT: "+pass+" passed, "+fail+" failed");
if(fail>0) process.exit(1);

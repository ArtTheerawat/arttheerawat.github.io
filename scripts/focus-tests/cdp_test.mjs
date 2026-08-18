// CDP interaction test for /focus — real browser, real localStorage.
// Flow: open /focus for "Week 6: File" -> click Start -> read elapsed ->
// reload -> verify persisted timer continues -> simulate inactivity.
const WS_URL = process.argv[2];
const FOCUS_KEY = process.argv[3] || "88634065%7CWeek%206%3A%20File%7C2026-08-24";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result ? r.result.value : undefined;
  }
  async nav(url) {
    await this.send("Page.navigate", { url });
    await sleep(1200); // let React hydrate + data fetch
    await sleep(1200);
  }
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗ FAIL:", name, extra); }
};

(async () => {
  const cdp = new CDP(WS_URL);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  // Clear any prior focus state for the task so test is deterministic
  await cdp.send("Page.navigate", { url: "http://localhost:3000/today" });
  await sleep(1500);
  await cdp.eval(`localStorage.removeItem("theedeck.focus.88634065|Week 6: File|2026-08-24")`);
  await cdp.eval(`localStorage.clear()`);

  const url = `http://localhost:3000/focus?key=${FOCUS_KEY}`;
  console.log("STEP 1: open /focus for active task");
  await cdp.nav(url);
  // Should show timer card, NOT empty/done
  const timerCard = await cdp.eval(`!!document.querySelector(".focus-timer-card")`);
  const doneMsg = await cdp.eval(`document.body.innerText.includes("ทำเสร็จไปแล้ว")`);
  ok("active task shows timer card", timerCard);
  ok("active task NOT marked done", !doneMsg);

  const elapsed00 = await cdp.eval(`document.querySelector(".focus-elapsed")?.innerText || ""`);
  ok("elapsed starts at 00:00", elapsed00 === "00:00", "(got " + elapsed00 + ")");

  console.log("\nSTEP 2: start");
  const btn0 = await cdp.eval(`(() => { const b=[...document.querySelectorAll(".focus-btn")].find(x=>x.innerText.includes("เริ่มต่อ")||x.innerText.includes("Start Focus")); if(b){b.click(); return true;} return false; })()`);
  ok("start button clicked", btn0);
  await sleep(2500);
  const runningLbl = await cdp.eval(`document.querySelector(".focus-sub")?.innerText || ""`);
  ok("shows running", runningLbl.includes("กำลังโฟกัส"), "(got " + runningLbl + ")");
  const el1 = await cdp.eval(`document.querySelector(".focus-elapsed")?.innerText || ""`);
  ok("elapsed advances >= 00:02", el1 !== "00:00" && el1 >= "00:02", "(got " + el1 + ")");

  console.log("\nSTEP 3: pause, then reload -> timer persists (doesn't reset)");
  await cdp.eval(`(() => { const b=[...document.querySelectorAll(".focus-btn")].find(x=>x.innerText.includes("หยุดชั่วคราว")); if(b){b.click(); return true;} return false; })()`);
  await sleep(600);
  const pausedLbl = await cdp.eval(`document.querySelector(".focus-sub")?.innerText || ""`);
  ok("paused", pausedLbl.includes("หยุดไว้ชั่วคราว"), "(got " + pausedLbl + ")");
  const elPaused = await cdp.eval(`document.querySelector(".focus-elapsed")?.innerText || ""`);
  await sleep(1500);
  const elPausedLater = await cdp.eval(`document.querySelector(".focus-elapsed")?.innerText || ""`);
  ok("paused timer frozen", elPaused === elPausedLater, "(before=" + elPaused + ", after=" + elPausedLater + ")");

  // reload without touching storage
  await cdp.nav(url);
  const elAfterReload = await cdp.eval(`document.querySelector(".focus-elapsed")?.innerText || ""`);
  ok("timer persisted across reload", elAfterReload === elPaused, "(stored=" + elPaused + ", after reload=" + elAfterReload + ")");

  console.log("\nSTEP 4: resume (begin again)");
  await cdp.eval(`(() => { const b=[...document.querySelectorAll(".focus-btn")].find(x=>x.innerText.includes("เริ่มต่อ")); if(b){b.click(); return true;} return false; })()`);
  await sleep(2200);
  const elResumeLater = await cdp.eval(`document.querySelector(".focus-elapsed")?.innerText || ""`);
  ok("resume advanced beyond stored", elResumeLater !== elPaused, "(stored=" + elPaused + ", after resume=" + elResumeLater + ")");

  console.log("\nSTEP 5: clear / reset");
  await cdp.eval(`(() => { const b=[...document.querySelectorAll(".focus-btn")].find(x=>x.innerText.includes("ล้างเวลา")); if(b){b.click(); return true;} return false; })()`);
  await sleep(500);
  const elReset = await cdp.eval(`document.querySelector(".focus-elapsed")?.innerText || ""`);
  ok("reset -> 00:00", elReset === "00:00", "(got " + elReset + ")");

  console.log("\nSTEP 6: invalid key -> empty state, no crash");
  await cdp.nav(`http://localhost:3000/focus?key=no%7Csuch%7Ctask`);
  await sleep(1000);
  const emptyState = await cdp.eval(`document.querySelector(".focus-empty") !== null`);
  const notFoundTxt = await cdp.eval(`document.body.innerText.includes("ไม่พบงานนี้") || document.body.innerText.includes("ยังไม่เลือกงาน")`);
  ok("empty state shown for invalid key", emptyState);
  ok("empty message rendered", notFoundTxt);

  console.log("\nSTEP 7: mobile viewport — timer fits (no horizontal overflow)");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await cdp.nav(url);
  await sleep(1200);
  const overflow = await cdp.eval(`document.documentElement.scrollWidth > document.documentElement.clientWidth + 1`);
  ok("no horizontal scroll on mobile", !overflow, "(scrollW=" + (await cdp.eval(`document.documentElement.scrollWidth`)) + ", clientW=" + (await cdp.eval(`document.documentElement.clientWidth`)) + ")");

  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e.message); process.exit(2); });
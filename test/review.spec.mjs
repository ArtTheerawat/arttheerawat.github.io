// test/review.spec.mjs — deterministic verification of lib/review.computeReview.
// Bundles lib/review.ts (with a localStorage shim) via esbuild, then drives the
// required Evening-Review scenarios: normal, no-completed, remaining, overdue,
// no-plan, plan-present, midnight/date-pinning. Run: node test/review.spec.mjs
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

// localStorage shim — lib/plan.loadPlan reads window.localStorage.
// Set on globalThis BEFORE importing the bundle so the same live Map is shared.
const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
};

// Bundle lib/review.ts to CJS in a temp file (platform=node, no browser shim).
await build({
  entryPoints: ["lib/review.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: ".review-test.cjs",
  alias: { "@": "." },
  logLevel: "silent",
});

const mod = await import("../.review-test.cjs");

const weekLater = "2099-12-31"; // far future — never overdue
const TODAY = process.env.REVIEW_DATE || "2099-12-25";
process.env.TZ = "UTC"; // deterministic epoch math

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? " — " + extra : "")); }
}
function dump(o) { return JSON.stringify(o); }

// Blank slate.
storage.clear();
const baseAssign = [
  { title: "Lab 5", course: "C1", courseName: "C1", due: TODAY, bucket: "today" },
  { title: "ใบงาน 6", course: "C2", courseName: "C2", due: weekLater, bucket: "later" },
];

// ── Scenario: normal — 1 completed today, 1 remaining, overdue present ──
{
  storage.clear();
  storage.set(
    "td_plan_blocks",
    JSON.stringify({
      [TODAY]: [
        { key: "C1|Lab 5|" + TODAY, title: "Lab 5", course: "C1", start: 14, end: 15, dur: 60, color: "#22d3ee" },
      ],
    })
  );
  const hidden = [
    { key: "C2|ใบงาน 6|" + weekLater, title: "ใบงาน 6", course: "C2", due: weekLater, reason: "already-submitted", hiddenAt: TODAY + "T18:00:00+07:00" },
  ];
  const f = mod.computeReview(hidden, baseAssign, [], [], TODAY);
  check("completedToday = 1", f.completedToday === 1, dump(f.completedToday));
  check("completed[0] title", f.completed[0]?.title === "ใบงาน 6", dump(f.completed));
  check("remaining = 1", f.remaining.length === 1, dump(f.remaining.length));
  check("overdueCount = 0 (none overdue today)", f.overdueCount === 0, dump(f.overdueCount));
  check("plan.planned = 1", f.plan.planned === 1);
  check("plan.completed = 0 (block task hidden? no)", f.plan.completed === 0);
  check("plan.hasData true", f.plan.hasData === true);
}

// ── Scenario: completed today counted, yesterday's completion NOT ──
{
  storage.clear();
  const hidden = [
    { key: "C2|ใบงาน 6|" + weekLater, title: "ใบงาน 6", course: "C2", due: weekLater, reason: "already-submitted", hiddenAt: "2099-12-24T18:00:00+07:00" }, // yesterday
  ];
  const f = mod.computeReview(hidden, baseAssign, [], [], TODAY);
  check("completedToday = 0 when hiddenAt was yesterday", f.completedToday === 0, dump(f.completedToday));
  // Already-submitted yesterday → not "current remaining" work either (excluded by hidden set).
  check("task not in remaining (already submitted)", !f.remaining.some((r) => r.title === "ใบงาน 6"), dump(f.remaining.map((r) => r.title)));
}

// ── Scenario: no completed tasks at all ──
{
  storage.clear();
  const f = mod.computeReview([], baseAssign, [], [], TODAY);
  check("completedToday = 0", f.completedToday === 0);
  check("remaining len = 2", f.remaining.length === 2, dump(f.remaining.length));
}

// ── Scenario: overdue task ──
{
  storage.clear();
  const overAssign = [
    { title: "งานเก่า", course: "C3", courseName: "C3", due: "2099-12-20", bucket: "over" },
  ];
  const f = mod.computeReview([], overAssign, [], [], TODAY);
  check("overdueCount = 1", f.overdueCount === 1, dump(f.overdueCount));
  check("remaining[0].overdue true", f.remaining[0]?.overdue === true, dump(f.remaining));
}

// ── Scenario: no planning data ──
{
  storage.clear(); // no td_plan_blocks
  const f = mod.computeReview([], baseAssign, [], [], TODAY);
  check("plan.hasData false", f.plan.hasData === false, dump(f.plan));
  check("plan.planned = 0", f.plan.planned === 0);
}

// ── Scenario: plan block whose task is completed (counts as done) ──
{
  storage.clear();
  storage.set(
    "td_plan_blocks",
    JSON.stringify({
      [TODAY]: [
        { key: "C1|Lab 5|" + TODAY, title: "Lab 5", course: "C1", start: 14, end: 15, dur: 60, color: "#22d3ee" },
        { key: "C9|งานเสร็จ|" + weekLater, title: "งานเสร็จ", course: "C9", start: 16, end: 17, dur: 60, color: "#fff" },
      ],
    })
  );
  const hidden = [
    { key: "C9|งานเสร็จ|" + weekLater, title: "งานเสร็จ", course: "C9", due: weekLater, reason: "already-submitted", hiddenAt: TODAY + "T12:00:00+07:00" },
  ];
  const f = mod.computeReview(hidden, baseAssign, [], [], TODAY);
  check("plan.planned = 2", f.plan.planned === 2);
  check("plan.completed = 1", f.plan.completed === 1, dump(f.plan));
  check("plan.remaining = 1", f.plan.remaining === 1);
}

// ── Scenario: midnight pinch — explicit date never leaks an adjacent day ──
{
  storage.clear();
  const hidden = [
    { key: "A|X|" + weekLater, title: "X", course: "A", due: weekLater, reason: "already-submitted", hiddenAt: TODAY + "T23:59:00+07:00" },
    { key: "B|Y|" + weekLater, title: "Y", course: "B", due: weekLater, reason: "already-submitted", hiddenAt: TODAY + "T00:01:00+07:00" },
  ];
  const f = mod.computeReview(hidden, [], [], [], TODAY);
  check("both today-day completions counted (2)", f.completedToday === 2, dump(f.completedToday));
}

// ── Scenario: next-action reuse returns state/idle and never a hidden task ──
// NOTE: computeNextAction scores against the REAL current moment (its own now),
// so this scenario must use realistic (real-today-relative) due dates.
{
  storage.clear();
  const now = new Date();
  const todayIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
  const near = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString().slice(0, 10);
  const hidden = [{ key: "C2|ใบงาน 6|" + near, title: "ใบงาน 6", course: "C2", due: near, reason: "already-submitted", hiddenAt: todayIso + "T18:00:00+07:00" }];
  const assign = [
    { title: "Lab 5", course: "C1", courseName: "C1", due: near, bucket: "today", points: 60 },
  ];
  const f = mod.computeReview(hidden, assign, [], [], todayIso);
  check("next defined (Lab 5 due tomorrow)", !!f.next && f.next.title === "Lab 5", dump(f.next && f.next.title));
  check("nextActionState action", f.nextActionState === "action", f.nextActionState);
  check("next is not the already-hidden task", f.next?.title !== "ใบงาน 6", dump(f.next && f.next.title));
  const f2 = mod.computeReview([], [], [], [], todayIso);
  check("idle when no tasks", f2.nextActionState === "idle", f2.nextActionState);
}

console.log(`\n${pass} passed, ${fail} failed`);
await writeFile(".review-test.cjs", ""); // leave temp bundle empty
process.exit(fail ? 1 : 0);
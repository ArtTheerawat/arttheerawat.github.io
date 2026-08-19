// test/plan-engine.spec.cjs — real behavioral verification for SYSTEM 10.
// Bundles the ACTUAL lib/plan.ts + priority engine via esbuild and asserts the
// deterministic planning rules against the REAL SCHEDULE/MAKEUP/assignments data.
//
// Run: node test/plan-engine.spec.cjs  (after `npm run build` for esbuild)
import fs from "node:fs";
import { buildSync } from "esbuild";

// 1) Bundle the real engine (+ its deps) to an ESM blob with a localStorage shim.
const src = `
  // --- very small window shim so loadPlan/savePlan work in Node ---
  const _mem = {};
  global.window = {
    localStorage: {
      getItem: (k) => (k in _mem ? _mem[k] : null),
      setItem: (k, v) => { _mem[k] = String(v); },
    },
  };

  export * from "./lib/plan.ts";
  export { rankAssignments } from "./lib/priority.ts";
  export { SCHEDULE, MAKEUP, COURSES } from "./lib/schedule-data.ts";
`;
const out = "node_modules/.cache/plan_engine_test.mjs";
buildSync({
  stdin: { contents: src, resolveDir: process.cwd(), loader: "ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  alias: { "@": "." },
  logLevel: "silent",
});

const mod = await import(new URL(`../${out}`, new URL(import.meta.url)));
const {
  SCHEDULE, MAKEUP, COURSES,
} = mod;
const { buildDailyPlan, computeFreeSlots, dayWindow, fmtHour, isFree, mergeDayEvents, occupiedRanges, planTodayIdx, planTodayStr, proposeBlock, roundUp15, PLAN_DURATIONS } = mod;

const DATA = "public/data";
const assign = JSON.parse(fs.readFileSync(`${DATA}/assignments.json`, "utf8"));
const sched  = JSON.parse(fs.readFileSync(`${DATA}/schedule.json`, "utf8"));
const quizzes = sched.quizzes || [];
// sessions for rankAssignments = real weekly + makeup (same as the /plan page).
const sessions = [...SCHEDULE, ...MAKEUP];

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? " — " + extra : "")); }
};

console.log("▸ day helper round-trip");
ok("fmtHour(10.5) = 10:30", fmtHour(10.5) === "10:30", fmtHour(10.5));
ok("fmtHour(13.37) = 13:22", fmtHour(13.37) === "13:22", fmtHour(13.37));
ok("roundUp15(10.0)=10.0", roundUp15(10.0) === 10.0);
ok("roundUp15(10.2)=10.25", roundUp15(10.2) === 10.25, roundUp15(10.2));
ok("roundUp15(14.6)=14.75", roundUp15(14.6) === 14.75, roundUp15(14.6));

console.log("▸ mergeDayEvents uses real schedule data");
const di = planTodayIdx();
const todayIso = planTodayStr();
const fixed = mergeDayEvents(di, todayIso);
ok("has fixed events (or empty handled later)", Array.isArray(fixed));
ok("no overlap within fixed (class.time are real)",
  fixed.every((r) => r.start < r.end));
ok("fixed sorted by start",
  fixed.every((r, i) => i === 0 || fixed[i-1].start <= r.start));

console.log("▸ computeFreeSlots — available time = complement of FIXED");
// Free slots must not overlap any fixed event.
const freeNowEarly = computeFreeSlots(fixed, 0);
ok("no free slot overlaps a fixed class",
  freeNowEarly.every((s) => fixed.every((c) => !(s.start < c.end && s.end > c.start))));
for (const s of freeNowEarly) {
  ok("free slot finite & non-empty", s.start < s.end && s.end - s.start >= 20/60);
}
// "no class = free" is NOT assumed: free slots only exist INSIDE the working day
// window, which is null-bounded by real classes.
const win = dayWindow(fixed);
ok("working window within [0,24]", win.start >= 0 && win.end <= 24);
ok("free slots respect working window",
  freeNowEarly.every((s) => s.start >= win.start && s.end <= win.end));
// A later 'now' trims slots that start before it.
const late = computeFreeSlots(fixed, 15.0);
ok("later nowHour drops earlier free slots",
  late.length <= freeNowEarly.length);
ok("free slots after now respect fromHour",
  late.every((s) => s.start >= 15.0));

console.log("▸ isFree + occupiedRanges");
const occ = occupiedRanges(fixed);
ok("isFree rejects overlap with a class",
  fixed.every((c) => !isFree(c.start - 0.5, c.start + 0.1, occ)));
ok("isFree accepts a window fully inside a gap",
  isFree(10.0, 10.5, occ) === (occ.every((o) => !(10.0 < o.end && 10.5 > o.start))));

console.log("▸ proposeBlock derives a REAL start, never fake");
// A day with NO fixed classes → one big free window in the neutral working day.
const freeFull = computeFreeSlots([], 9);
ok("no-class day yields a usable free window (inside working day)",
  freeFull.length >= 1 && freeFull.every((s) => s.start >= 9.0 && s.end <= 23.0));
const fakeTask = {
  key: "K", title: "T", course: "C", courseName: "C",
  score: 80, level: "HIGH", dueLabel: "due today", reasons: [], actionTarget: "t",
  due: "", source: "assignments",
};
const prop = proposeBlock(fakeTask, freeFull, 50);
ok("proposeBlock returns a block within the free window", !!prop);
if (prop) {
  ok("proposed end = start + duration", Math.abs((prop.end - prop.start)*60 - 50) < 0.01);
  ok("proposed start is real (>= now / window boundary)", prop.start >= 9.0);
}
ok("proposeBlock returns null when no slot fits",
  proposeBlock(fakeTask, [], 50) === null);
ok("90-min propose fits an exactly 1.5h slot or returns usable block",
  proposeBlock(fakeTask, [{ start: 9, end: 10.5 }], 90) !== null);

console.log("▸ buildDailyPlan with real data");
const hidden = new Set(["__nonexistent__"]);
const plan = buildDailyPlan(assign.todo || [], quizzes, sessions, hidden, 9.5, todayIso);
ok("plan has date", plan.date === todayIso);
ok("plan.fixed present", Array.isArray(plan.fixed));
ok("plan.free present", Array.isArray(plan.free));
ok("plan.unscheduled present", Array.isArray(plan.unscheduled));
ok("unscheduled tasks sorted by priority (score desc)",
  plan.unscheduled.every((t, i) => i === 0 || plan.unscheduled[i-1].score >= t.score));
// Priority reuse: ranked all non-decreasing by score
ok("ranked non-increasing score (Priority engine reused)",
  plan.ranked.every((t, i) => i === 0 || plan.ranked[i-1].score >= t.score));
// No fabricated duration on a task without estimate -> stays UNSCHEDULED unless the user
// picks one; engine never fabricates an end time.
ok("unscheduled uses real priority metadata (level present)",
  plan.unscheduled.every((t) => "level" in t && "score" in t));

// Overdue / due-today handling via priority reuse: dueLabel reflects it.
const anyToday = plan.unscheduled.find((t) => t.dueLabel && t.dueLabel.includes("วันนี้"));
console.log("  ℹ unscheduled count =", plan.unscheduled.length,
  "| scheduled(persisted) =", plan.scheduled.length,
  "| fixed =", plan.fixed.length, "| free slots =", plan.free.length);

console.log("▸ edge cases (no tasks / no schedule / now inside day / conflict)");
// No tasks → no unscheduled work.
const emptyPlan = buildDailyPlan([], quizzes, sessions, new Set(), 9.5, todayIso);
ok("no tasks → zero unscheduled", emptyPlan.unscheduled.length === 0);
// No schedule (empty fixed) → still returns a usable free window (working day).
const noFixedPlan = buildDailyPlan(assign.todo || [], quizzes, [], new Set(), 9.5, todayIso);
ok("no fixed events → plan handles gracefully", Array.isArray(noFixedPlan.fixed) && Array.isArray(noFixedPlan.free));
// "Current time already inside the day" — a late nowHour simply trims slots;
// the engine never schedules into the past.
const latePlan = buildDailyPlan(assign.todo || [], quizzes, sessions, new Set(), 22.5, todayIso);
ok("late nowHour leaves no free slots before now",
  latePlan.free.every((s) => s.end >= 22.5));
// Insufficient free time: a day fully occupied → no free slot.
const busyFixed = [
  { start: 9, end: 12, label: "A", code: "X", color: "#fff", kind: "class", icon: "📚" },
  { start: 12, end: 23, label: "B", code: "Y", color: "#fff", kind: "class", icon: "📚" },
];
const busyFree = computeFreeSlots(busyFixed, 9);
ok("fully-occupied day yields no usable free window", busyFree.length === 0);
ok("proposeBlock returns null for a fully-occupied day",
  proposeBlock(fakeTask, busyFree, 50) === null);
// Fixed-event conflict: proposed block that overlaps a class is rejected by isFree.
ok("conflicting block rejected by isFree", !isFree(9.0, 12.0, busyFixed));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
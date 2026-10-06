import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  currentWeek,
  evaluationDate,
  calendarInstant,
  emptyPlan,
  prepareWeek,
  scoreWeek,
  scoreDay,
} from "../shared/domain.js";
import { calendar } from "../server/calendar.js";
const plan = () => ({
  ...emptyPlan(),
  goals: [
    {
      id: "goal",
      title: "12주 변화",
      leading: "행동",
      lagging: "결과",
      measurement: "주간 측정",
      tactics: [
        {
          id: "run",
          title: "주 3회 달리기",
          condition: "5km 완주",
          kind: "weekly",
          count: 3,
          weeks: [1, 2],
        },
        {
          id: "daily",
          title: "매일 기록",
          condition: "기록 1건",
          kind: "daily",
          count: 1,
          weeks: [1],
        },
      ],
    },
  ],
});
test("04:00 KST is the exact evaluation boundary, including Monday", () => {
  assert.equal(evaluationDate("2026-10-05T03:59:59+09:00"), "2026-10-04");
  assert.equal(evaluationDate("2026-10-05T04:00:00+09:00"), "2026-10-05");
  assert.equal(currentWeek("2026-10-05", "2026-10-12T03:59:59+09:00"), 1);
  assert.equal(currentWeek("2026-10-05", "2026-10-12T04:00:00+09:00"), 2);
});
test("first cycle is 84 execution days then 7 review days", () => {
  assert.equal(addDays("2026-10-05", 83), "2026-12-27");
  assert.equal(addDays("2026-10-05", 90), "2027-01-03");
  assert.equal(currentWeek("2026-10-05", "2026-12-28T04:00:00+09:00"), 13);
});
test("eleven-week cycle keeps December 27 and enters review at KST 04:00", () => {
  assert.equal(addDays("2026-10-12", 11 * 7 - 1), "2026-12-27");
  assert.equal(currentWeek("2026-10-12", "2026-12-28T03:59:59+09:00", 11), 11);
  assert.equal(currentWeek("2026-10-12", "2026-12-28T04:00:00+09:00", 11), 12);
  assert.equal(currentWeek("2026-10-12", "2027-01-20T04:00:00+09:00", 11), 12);
  assert.equal(currentWeek("2026-10-12", "2026-10-11T20:00:00+09:00", 11), 0);
});
test("post-midnight plan times map into the following calendar day", () => {
  assert.equal(
    calendarInstant("2026-10-05", "02:30").toISOString(),
    "2026-10-05T17:30:00.000Z",
  );
  assert.equal(
    calendarInstant("2026-10-05", "04:00").toISOString(),
    "2026-10-04T19:00:00.000Z",
  );
});
test("repetitions are separate from tactics, daily opportunities have required dates", () => {
  const w = prepareWeek(plan(), "2026-10-05", 1);
  assert.equal(w.tactics.length, 2);
  assert.equal(w.occurrences.length, 10);
  assert.equal(w.occurrences[3].requiredDate, "2026-10-05");
  assert.equal(w.occurrences[9].requiredDate, "2026-10-11");
  assert.equal(w.tactics[0].goalLeading, "행동");
  assert.equal(prepareWeek(plan(), "2026-10-05", 2).tactics.length, 1);
});
test("five equal tactics with one at 2/3 yield 93.333 without premature rounding", () => {
  const state = {
    tactics: Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      plannedCount: i ? 1 : 3,
    })),
    occurrences: [
      { tacticId: "0", completed: true },
      { tacticId: "0", completed: true },
      { tacticId: "0", completed: false },
      ...Array.from({ length: 4 }, (_, i) => ({
        tacticId: String(i + 1),
        completed: true,
      })),
    ],
  };
  const result = scoreWeek(state);
  assert.ok(Math.abs(result.score - 93.33333333333333) < 1e-9);
  assert.equal(result.rows[0].complete, false);
  assert.equal(result.rows[0].weight, 20);
  assert.notEqual(result.score, (6 / 7) * 100);
});
test("daily score is binary per occurrence, no-plan is N/A, overexecution caps at 100", () => {
  const state = {
    tactics: [{ id: "one", plannedCount: 1 }],
    occurrences: Array.from({ length: 5 }, (_, i) => ({
      tacticId: "one",
      date: "2026-10-05",
      completed: i < 4,
    })),
  };
  assert.deepEqual(scoreDay(state, "2026-10-05"), {
    planned: 5,
    done: 4,
    score: 80,
  });
  assert.equal(scoreDay(state, "2026-10-06").score, null);
  assert.equal(scoreWeek(state).score, 100);
  assert.equal(scoreWeek({ tactics: [], occurrences: [] }).score, null);
});
test("future regeneration preserves schedule but applies revised commitment count", () => {
  const p = plan(),
    old = prepareWeek(p, "2026-10-05", 2);
  old.occurrences[0].date = "2026-10-14";
  p.goals[0].tactics[0].count = 2;
  const next = prepareWeek(p, "2026-10-05", 2, old);
  assert.equal(next.occurrences.length, 2);
  assert.equal(next.occurrences[0].date, "2026-10-14");
});
test("ICS uses actual KST instants, stable UID, escaping and UTF-8 75-byte folding", () => {
  const p = plan();
  p.goals[0].tactics[0].title = "러닝, 완료; " + "한글".repeat(70) + "\n다음";
  const state = prepareWeek(p, "2026-10-05", 2);
  state.occurrences[0].date = "2026-10-12";
  state.occurrences[0].time = "02:00";
  const result = calendar(
    { id: "cycle" },
    { number: 2, version: 3, state },
    new Date("2026-10-05T00:00:00Z"),
  );
  assert.match(result, /DTSTART:20261012T170000Z/);
  assert.match(result, /UID:cycle-2-run~0@twelve.local/);
  assert.match(result, /SEQUENCE:3/);
  assert.equal((result.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(result.replaceAll("\r\n ", ""), /SUMMARY:러닝\\, 완료\\;/);
  for (const line of result.split("\r\n"))
    assert.ok(Buffer.byteLength(line) <= 75);
});

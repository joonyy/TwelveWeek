import { test } from "node:test";
import assert from "node:assert/strict";
import ICAL from "ical.js";
import { calendar } from "../server/calendar.js";
import { emptyPlan, prepareWeek } from "../shared/domain.js";
import { timetableForWeek, calendarFragments } from "../shared/planning.js";

const block = (id, day, time, minutes, title) => ({
  id,
  day,
  time,
  minutes,
  title,
  kind: "fixed",
});
const events = (text) =>
  new ICAL.Component(ICAL.parse(text)).getAllSubcomponents("vevent");
const value = (event, key) => event.getFirstPropertyValue(key);
const instant = (event, key) => value(event, key).toJSDate().toISOString();
test("untimed execution promises stay in evaluation but do not export an obsolete clock block", () => {
  const p = emptyPlan(2);
  p.goals[0].title = "약속 유지";
  Object.assign(p.goals[0].tactics[0], { title: "기록", condition: "한 줄" });
  const state = prepareWeek(p, "2026-10-05", 1);
  Object.assign(state.occurrences[0], {
    date: "2026-10-07",
    timePlaced: false,
  });
  const c = { id: "cycle", start_date: "2026-10-05", plan: p };
  const w = { number: 1, version: 2, state };
  assert.equal(events(calendar(c, w)).length, 0);
  assert.equal(state.occurrences[0].date, "2026-10-07");
  delete state.occurrences[0].timePlaced;
  assert.equal(events(calendar(c, w)).length, 1);
});

test("weekly export uses the override or fallback, includes actual executions, and leaves scores untouched", () => {
  const plan = emptyPlan(2);
  plan.goals[0].title = "학습";
  Object.assign(plan.goals[0].tactics[0], {
    title: "정리",
    condition: "한 글 완성",
    count: 3,
    weeks: [1, 2],
  });
  const shift = block("shift", 0, "19:00", 360, "맥날 근무");
  const review = block("review", 6, "01:00", 30, "주간 평가");
  plan.modelWeek = [shift, review];
  plan.weeklyModelWeeks = [
    { week: 1, blocks: [{ ...shift, time: "17:00" }, review] },
  ];
  const state = prepareWeek(plan, "2026-10-05", 1);
  Object.assign(state.occurrences[0], {
    date: "2026-10-07",
    time: "22:00",
    minutes: 60,
  });
  const cycle = { id: "cycle", version: 7, start_date: "2026-10-05", plan };
  const week = { number: 1, version: 3, state };
  const before = structuredClone({ cycle, week });
  const exported = events(calendar(cycle, week));
  assert.equal(exported.length, 3);
  assert.equal(
    instant(
      exported.find((e) => value(e, "summary") === "맥날 근무"),
      "dtstart",
    ),
    "2026-10-05T08:00:00.000Z",
  );
  assert.equal(
    instant(
      exported.find((e) => value(e, "summary") === "주간 평가"),
      "dtstart",
    ),
    "2026-10-11T16:00:00.000Z",
  );
  assert.equal(
    exported.filter((e) => value(e, "categories") === "TWELVEWEEK-EXECUTION")
      .length,
    1,
  );
  const fallback = events(
    calendar(cycle, {
      ...week,
      number: 2,
      state: prepareWeek(plan, cycle.start_date, 2),
    }),
  );
  assert.equal(
    instant(
      fallback.find((e) => value(e, "summary") === "맥날 근무"),
      "dtstart",
    ),
    "2026-10-12T10:00:00.000Z",
  );
  plan.weeklyModelWeeks.push({ week: 2, blocks: [] });
  assert.equal(
    events(
      calendar(cycle, {
        number: 2,
        version: 0,
        state: prepareWeek(plan, cycle.start_date, 2),
      }),
    ).length,
    0,
  );
  plan.weeklyModelWeeks.pop();
  assert.deepEqual({ cycle, week }, before);
});

test("03:00 sleep continues into the next evaluation day and keeps one UID across adjacent exports", () => {
  const plan = emptyPlan(2);
  plan.modelWeek = [block("sleep", 6, "03:00", 360, "수면")];
  plan.weeklyModelWeeks = [
    { week: 1, blocks: [{ ...plan.modelWeek[0], minutes: 420 }] },
  ];
  const cycle = { id: "cycle", version: 8, start_date: "2026-10-05", plan };
  const state = { tactics: [], occurrences: [] };
  const first = events(calendar(cycle, { number: 1, version: 0, state }));
  const second = events(calendar(cycle, { number: 2, version: 0, state }));
  const previous = first.find(
    (e) => value(e, "uid") === "cycle-1-timetable-sleep@twelve.local",
  );
  const carried = second.find(
    (e) => value(e, "uid") === value(previous, "uid"),
  );
  assert.equal(instant(previous, "dtstart"), "2026-10-11T18:00:00.000Z");
  assert.equal(instant(previous, "dtend"), "2026-10-12T01:00:00.000Z");
  assert.equal(instant(carried, "dtstart"), instant(previous, "dtstart"));
  assert.equal(instant(carried, "dtend"), instant(previous, "dtend"));
  const pieces = calendarFragments(timetableForWeek(plan, 2), { wrap: false });
  const monday = pieces.filter((piece) => piece.day === 0);
  assert.equal(monday.length, 1);
  assert.deepEqual([monday[0].start, monday[0].end], [0, 360]);
  assert.equal(monday[0].sourceWeek, 1);
  assert.equal(
    pieces.some((piece) => piece.day === 6 && piece.part === 1),
    false,
  );
});

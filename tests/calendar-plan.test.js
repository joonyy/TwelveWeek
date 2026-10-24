import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPlan, prepareWeek, scoreWeek } from "../shared/domain.js";
import {
  calendarRange,
  placementConflicts,
  appleCalendarBlocks,
  linkedPlacement,
} from "../shared/calendar-plan.js";
import { validateCalendarPlacements } from "../server/calendar-routes.js";
import { planSchema } from "../server/schema.js";

function fixture() {
  const plan = emptyPlan(10),
    g = plan.goals[0];
  g.title = "학습";
  g.tactics[0] = {
    ...g.tactics[0],
    title: "공부",
    condition: "직접 설명",
    count: 2,
    weeks: [1, 2],
  };
  const state = prepareWeek(plan, "2026-10-19", 1);
  const placements = state.occurrences.map((o) => ({
    occurrenceId: o.id,
    date: "2026-10-19",
    time: "10:00",
    minutes: 60,
    action: "skip",
    allowOverlap: false,
  }));
  return { plan, state, placements, range: calendarRange("2026-10-19", 1) };
}
const event = {
  id: "work",
  calendarId: "job",
  calendarName: "직장",
  title: "OVS",
  start: "2026-10-19T01:00:00Z",
  end: "2026-10-19T09:00:00Z",
};
test("calendar comparisons respect 04:00 KST, overnight spans, transparent events and shared links", () => {
  const { range, placements: p } = fixture();
  assert.equal(range.start, "2026-10-18T19:00:00.000Z");
  assert.equal(range.end, "2026-10-25T19:00:00.000Z");
  p[0].action = "create";
  assert.equal(placementConflicts(p, [event])[p[0].occurrenceId].length, 1);
  assert.equal(
    placementConflicts(p, [{ ...event, transparent: true }])[p[0].occurrenceId]
      .length,
    0,
  );
  p[0].time = "18:00"; // touching endpoints are not an overlap.
  assert.equal(placementConflicts(p, [event])[p[0].occurrenceId].length, 0);
  for (const x of p)
    Object.assign(x, { action: "link", time: "12:00", linkId: "work" });
  assert.ok(
    Object.values(placementConflicts(p, [event])).every((x) => !x.length),
  );
  const blocks = appleCalendarBlocks(
    [{ ...event, start: "2026-10-25T14:00:00Z", end: "2026-10-25T22:00:00Z" }],
    range,
  );
  assert.deepEqual(
    blocks.map((b) => [b.day, b.time, b.minutes]),
    [[6, "23:00", 300]],
  );
});
test("calendar review requires explicit overlap acknowledgement and keeps each execution", () => {
  const { state, range, placements: p } = fixture();
  for (const x of p) x.action = "create";
  assert.throws(
    () => validateCalendarPlacements(state, p, [event], range, "2026-10-19"),
    /겹치는/,
  );
  for (const x of p) x.allowOverlap = true;
  assert.doesNotThrow(() =>
    validateCalendarPlacements(state, p, [event], range, "2026-10-19"),
  );
  assert.throws(
    () =>
      validateCalendarPlacements(
        state,
        [p[0], p[0]],
        [event],
        range,
        "2026-10-19",
      ),
    /목록/,
  );
  p[0].action = "link";
  p[0].linkId = "work";
  p[0].time = "20:00";
  assert.throws(
    () => validateCalendarPlacements(state, p, [event], range, "2026-10-19"),
    /시간 안/,
  );
});
test("daily requirements, completed records and past-week dates survive calendar review", () => {
  const { plan, range } = fixture();
  plan.goals[0].tactics[0].kind = "daily";
  const state = prepareWeek(plan, "2026-10-19", 1);
  const p = state.occurrences.map((o) => ({
    occurrenceId: o.id,
    date: o.date,
    time: o.time,
    minutes: 60,
    action: "skip",
    allowOverlap: false,
  }));
  p[0].action = "create";
  p[0].date = "2026-10-20";
  assert.throws(
    () => validateCalendarPlacements(state, p, [], range, "2026-10-19"),
    /매일/,
  );
  p[0].date = state.occurrences[0].date;
  state.occurrences[0].completed = true;
  p[0].time = "10:00";
  assert.throws(
    () => validateCalendarPlacements(state, p, [], range, "2026-10-19"),
    /완료한/,
  );
  const weekly = fixture();
  weekly.state.occurrences[0].date = "2026-10-19";
  Object.assign(weekly.placements[0], { action: "create", date: "2026-10-20" });
  assert.throws(
    () =>
      validateCalendarPlacements(
        weekly.state,
        weekly.placements,
        [],
        range,
        "2026-10-26",
      ),
    /지난주/,
  );
});
test("draft calendar placements seed execution once without changing counts, scores or stale dates", () => {
  const { plan, state } = fixture();
  const id = state.occurrences[0].id;
  plan.weeklySchedules = [
    {
      week: 1,
      placements: [
        {
          occurrenceId: id,
          date: "2026-10-20",
          time: "00:30",
          minutes: 30,
          calendarLink: {
            calendarId: "study",
            eventId: "event",
            title: "학습",
          },
        },
      ],
    },
  ];
  const seeded = prepareWeek(plan, "2026-10-19", 1);
  assert.equal(seeded.occurrences.length, state.occurrences.length);
  assert.deepEqual(scoreWeek(seeded), scoreWeek(state));
  assert.equal(seeded.occurrences[0].date, "2026-10-20");
  assert.equal(seeded.occurrences[0].time, "00:30");
  assert.equal(seeded.occurrences[0].calendarLink.eventId, "event");
  assert.equal(prepareWeek(plan, "2026-10-26", 1).occurrences[0].date, null);
  plan.goals[0].tactics[0].kind = "daily";
  assert.equal(
    prepareWeek(plan, "2026-10-19", 1).occurrences[0].date,
    "2026-10-19",
  );
});
test("all-day links stay inside the evaluation week and duplicate schedule records are rejected", () => {
  const { plan, state, range } = fixture();
  const day = { start: "2026-10-18T15:00:00Z", end: "2026-10-19T15:00:00Z" };
  assert.deepEqual(linkedPlacement(day, range, null, 120), {
    date: "2026-10-19",
    time: "04:00",
    minutes: 120,
  });
  assert.equal(linkedPlacement(day, range, "2026-10-20", 120), null);
  const schedule = {
    week: 1,
    placements: [
      {
        occurrenceId: state.occurrences[0].id,
        date: "2026-10-19",
        time: "10:00",
        minutes: 60,
      },
    ],
  };
  plan.weeklySchedules = [schedule, schedule];
  assert.equal(planSchema.safeParse(plan).success, false);
  plan.weeklySchedules = [
    {
      ...schedule,
      placements: [...schedule.placements, ...schedule.placements],
    },
  ];
  assert.equal(planSchema.safeParse(plan).success, false);
});

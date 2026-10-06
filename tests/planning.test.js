import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPlan, prepareWeek } from "../shared/domain.js";
import {
  editablePlan,
  hasGoalContent,
  calendarOffset,
  timeAtOffset,
  calendarFragments,
  calendarLanes,
  planWithinWeeks,
} from "../shared/planning.js";
import { planSchema } from "../server/schema.js";
test("shorter draft keeps content and IDs, limits starter and selected execution weeks", () => {
  const p = emptyPlan(11);
  assert.equal(p.goals.length, 3);
  assert.ok(p.goals.every((g) => g.tactics[0].weeks.length === 11));
  const full = emptyPlan();
  full.goals[0].title = "내용 보존";
  full.goals[0].tactics[0].weeks = [1, 11, 12];
  const before = structuredClone(full);
  const shortened = planWithinWeeks(full, 11);
  assert.deepEqual(full, before);
  assert.equal(shortened.goals[0].title, "내용 보존");
  assert.equal(shortened.goals[0].id, before.goals[0].id);
  assert.deepEqual(shortened.goals[0].tactics[0].weeks, [1, 11]);
  const legacy = editablePlan({ ...p, goals: [] }, { weekCount: 11 });
  assert.ok(legacy.goals.every((g) => g.tactics[0].weeks.length === 11));
});
test("new plan has three immediately editable goals, list modes and seven areas", () => {
  const p = emptyPlan();
  assert.equal(p.goals.length, 3);
  assert.ok(
    p.goals.every((g) => g.tactics.length === 1 && g.difficulties.length === 1),
  );
  assert.ok(Object.values(p.visionModes).every((m) => m === "list"));
  assert.equal(new Set(p.commitments.map((c) => c.area)).size, 7);
  assert.equal(p.commitments.length, 21);
  assert.equal(p.goals.filter(hasGoalContent).length, 0);
  assert.equal(prepareWeek(p, "2026-10-05", 1).tactics.length, 0);
  assert.deepEqual(planSchema.parse(p), p);
  p.goals[0].title = "나의 목표";
  Object.assign(p.goals[0].tactics[0], {
    title: "실행",
    condition: "한 번 완료",
  });
  const week = prepareWeek(p, "2026-10-05", 1);
  assert.equal(week.goals.length, 1);
  assert.equal(week.tactics.length, 1);
});
test("legacy text, existing goal IDs and custom commitments survive editor normalization", () => {
  const p = emptyPlan();
  delete p.visionModes;
  delete p.responsibilityActions;
  p.longVision = "첫 문장\n\n두 번째 문장";
  p.responsibility = "기존 책임 메모";
  p.goals = p.goals.slice(0, 1);
  p.goals[0].title = "기존 목표";
  p.goals[0].tactics = [];
  const legacy = {
    id: crypto.randomUUID(),
    area: "나만의 영역",
    promise: "약속",
    action: "행동",
    cost: "시간",
    choice: "기존 선택",
  };
  p.commitments = [legacy];
  const before = structuredClone(p),
    next = editablePlan(p);
  assert.deepEqual(p, before);
  assert.equal(next.longVision, before.longVision);
  assert.equal(next.responsibility, before.responsibility);
  assert.equal(next.goals.length, 1);
  assert.equal(next.goals[0].id, p.goals[0].id);
  assert.deepEqual(next.commitments[0], { ...legacy, accepted: false });
  assert.equal(next.commitments.length, 22);
  assert.deepEqual(planSchema.parse(next), next);
});
test("calendar 04:00 origin, midnight and wrap keep original block duration", () => {
  assert.equal(calendarOffset("04:00"), 0);
  assert.equal(calendarOffset("00:00"), 1200);
  assert.equal(timeAtOffset(1410), "03:30");
  const blocks = [{ id: "a", day: 6, time: "03:00", minutes: 180 }];
  const pieces = calendarFragments(blocks);
  assert.equal(pieces.length, 2);
  assert.deepEqual(
    pieces.map((p) => [p.day, p.start, p.end]),
    [
      [6, 1380, 1440],
      [0, 0, 120],
    ],
  );
  assert.equal(
    pieces.reduce((n, p) => n + p.end - p.start, 0),
    180,
  );
  assert.equal(calendarFragments(blocks, { wrap: false }).length, 1);
});
test("overlapping calendar blocks share columns without treating model references as conflicts", () => {
  const blocks = [
    { id: "a", day: 0, start: 0, end: 180 },
    { id: "b", day: 0, start: 60, end: 120 },
    { id: "c", day: 0, start: 180, end: 240 },
    { id: "ref", day: 0, start: 0, end: 1440, background: true },
  ];
  const result = calendarLanes(blocks);
  assert.equal(result.find((x) => x.id === "a").lanes, 2);
  assert.equal(result.find((x) => x.id === "b").lane, 1);
  assert.equal(result.find((x) => x.id === "c").lanes, 1);
  assert.equal(result.find((x) => x.id === "ref").lanes, 1);
  assert.equal(blocks[0].lane, undefined);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPlan } from "../shared/domain.js";
import { planTimeline } from "../shared/plan-timeline.js";

test("timeline uses existing periods without joining gaps or inventing milestones and preserves source data", () => {
  const plan = emptyPlan(6);
  plan.goals[0].title = "학습 후 공개";
  Object.assign(plan.goals[0].tactics[0], {
    title: "학습",
    condition: "정리",
    kind: "weekly",
    count: 2,
    weeks: [1, 2, 4, 4, 8],
  });
  plan.goals[0].tactics.push({
    id: "publish",
    title: "공개",
    condition: "주소",
    kind: "once",
    count: 9,
    weeks: [6],
  });
  plan.goals[0].tactics.push({
    id: "daily",
    title: "매일 기록",
    condition: "한 줄",
    kind: "daily",
    count: 1,
    weeks: [1, 2],
  });
  plan.goals[0].tactics.push({
    id: "undated",
    title: "미정",
    condition: "결정",
    kind: "weekly",
    count: 1,
    weeks: [],
  });
  const before = structuredClone(plan);
  const result = planTimeline(plan, 6);
  assert.deepEqual(result.goals[0].tactics[0].segments, [
    { start: 1, end: 2 },
    { start: 4, end: 4 },
  ]);
  assert.deepEqual(result.totals, [9, 9, 0, 2, 0, 1]);
  assert.equal(result.goals[0].tactics[1].minimum, 1);
  assert.deepEqual(result.goals[0].tactics[3].segments, []);
  assert.deepEqual(plan, before);
  assert.deepEqual(planTimeline(plan, 3).totals, [9, 9, 0]);
});

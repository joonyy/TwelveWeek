import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPlan,
  prepareWeek,
  scoreWeek,
  scoreDay,
  occurrenceLabel,
} from "../shared/domain.js";

test("extra attempts count toward a minimum, cap its weight and never penalize unfinished extra attempts", () => {
  const p = emptyPlan(2);
  p.goals[0].title = "학습";
  Object.assign(p.goals[0].tactics[0], {
    title: "한 단원",
    condition: "한 줄 정리",
    count: 3,
    weeks: [1, 2],
  });
  const state = prepareWeek(p, "2026-10-05", 1);
  const tactic = state.tactics[0];
  for (const o of state.occurrences)
    Object.assign(o, { date: "2026-10-07", completed: true });
  for (let i = 0; i < 3; i++)
    state.occurrences.push({
      id: `${tactic.id}~extra-${i}`,
      tacticId: tactic.id,
      extra: true,
      date: "2026-10-07",
      time: "11:00",
      minutes: 30,
      completed: i < 2,
    });
  const score = scoreWeek(state);
  assert.equal(score.rows[0].done, 5);
  assert.equal(score.rows[0].plannedCount, 3);
  assert.equal(score.rows[0].over, 2);
  assert.equal(score.score, 100);
  assert.deepEqual(scoreDay(state, "2026-10-07"), {
    planned: 3,
    done: 3,
    score: 100,
    extraPlanned: 3,
    extraDone: 2,
  });
  assert.equal(
    occurrenceLabel(state.occurrences.at(-1), state.occurrences),
    "추가 실행 3",
  );
  state.tactics.push({ id: "other", plannedCount: 1 });
  state.occurrences.push({
    id: "other~0",
    tacticId: "other",
    completed: false,
  });
  assert.equal(scoreWeek(state).score, 50);
  state.occurrences[0].completed = false;
  assert.equal(scoreWeek(state).rows[0].rate, 1);
});

test("future regeneration preserves optional records while changing only the minimum slots", () => {
  const p = emptyPlan(2);
  p.goals[0].title = "학습";
  Object.assign(p.goals[0].tactics[0], {
    title: "한 단원",
    condition: "한 줄 정리",
    count: 1,
    weeks: [1, 2],
  });
  const state = prepareWeek(p, "2026-10-05", 2);
  const extra = {
    id: `${state.tactics[0].id}~extra-evidence`,
    tacticId: state.tactics[0].id,
    extra: true,
    date: "2026-10-14",
    time: "01:00",
    minutes: 30,
    timePlaced: false,
    completed: true,
    executedAt: "2026-10-14T16:10:00Z",
  };
  state.occurrences.push(extra);
  const before = structuredClone(state);
  p.goals[0].tactics[0].count = 2;
  const rebuilt = prepareWeek(p, "2026-10-05", 2, state);
  assert.equal(rebuilt.tactics[0].plannedCount, 2);
  assert.equal(rebuilt.occurrences.length, 3);
  assert.deepEqual(rebuilt.occurrences.at(-1), extra);
  assert.equal(new Set(rebuilt.occurrences.map((o) => o.id)).size, 3);
  assert.deepEqual(state, before);
  assert.equal(
    prepareWeek(p, "2026-10-05", 1).occurrences.some((o) => o.extra),
    false,
  );
});

test("an optional record retained after a future tactic changes to daily cannot replace a missed day", () => {
  const state = {
    tactics: [{ id: "daily", kind: "daily", plannedCount: 7 }],
    occurrences: [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `daily~${i}`,
        tacticId: "daily",
        completed: i < 6,
      })),
      {
        id: "daily~extra-old",
        tacticId: "daily",
        extra: true,
        completed: true,
      },
    ],
  };
  assert.equal(scoreWeek(state).rows[0].done, 6);
  assert.equal(scoreWeek(state).rows[0].rate, 6 / 7);
});

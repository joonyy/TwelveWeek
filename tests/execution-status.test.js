import { test } from "node:test";
import assert from "node:assert/strict";
import {
  executionStatus,
  summarizeExecutions,
} from "../shared/execution-status.js";
import { evaluationDate } from "../shared/domain.js";

const context = { today: "2026-10-07", weekEnd: "2026-10-11" };

test("completion, missed promises, scheduled and unplaced executions form disjoint totals", () => {
  const occurrences = [
    { completed: true, date: "2026-10-05", timePlaced: false },
    { completed: false, date: "2026-10-06" },
    { completed: false, date: "2026-10-06", timePlaced: false },
    { completed: false, date: "2026-10-07", time: "01:00" },
    { completed: false, date: "2026-10-08" },
    { completed: false, date: "2026-10-07", timePlaced: false },
    { completed: false, date: null },
  ];
  const before = structuredClone(occurrences);
  const counts = summarizeExecutions(occurrences, context);
  assert.deepEqual(counts, {
    total: 7,
    completed: 1,
    missed: 2,
    scheduled: 2,
    unplaced: 2,
  });
  assert.equal(
    counts.completed + counts.missed + counts.scheduled + counts.unplaced,
    counts.total,
  );
  assert.deepEqual(occurrences, before);
});

test("an unplaced or scheduled promise becomes missed only at its 04:00 evaluation boundary", () => {
  for (const timePlaced of [false, true]) {
    const o = { date: "2026-10-07", time: "09:00", timePlaced };
    assert.equal(
      executionStatus(o, {
        ...context,
        today: evaluationDate("2026-10-08T03:59:59+09:00"),
      }),
      timePlaced ? "scheduled" : "unplaced",
    );
    assert.equal(
      executionStatus(o, {
        ...context,
        today: evaluationDate("2026-10-08T04:00:00+09:00"),
      }),
      "missed",
    );
  }
});

test("undated weekly promises remain open until the week ends, and completed ones stay completed", () => {
  const occurrences = [{ date: null }, { date: null, completed: true }];
  assert.deepEqual(
    summarizeExecutions(occurrences, { ...context, today: "2026-10-11" }),
    {
      total: 2,
      completed: 1,
      missed: 0,
      scheduled: 0,
      unplaced: 1,
    },
  );
  assert.deepEqual(
    summarizeExecutions(occurrences, { ...context, today: "2026-10-12" }),
    {
      total: 2,
      completed: 1,
      missed: 1,
      scheduled: 0,
      unplaced: 0,
    },
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPlan,
  prepareWeek,
  scoreWeek,
  scoreDay,
} from "../shared/domain.js";
import {
  replanWeek,
  calendarWeekState,
  stateForDay,
} from "../shared/week-replanning.js";
import { readingRecords } from "../shared/reading-notes.js";

function fixture() {
  const plan = emptyPlan(2);
  const goal = plan.goals[0];
  goal.title = "유지할 목표";
  Object.assign(goal.tactics[0], {
    title: "원래 약속",
    condition: "결과 한 개",
    count: 4,
    weeks: [1, 2],
  });
  const state = prepareWeek(plan, "2026-10-05", 1);
  Object.assign(state.occurrences[0], {
    date: "2026-10-05",
    completed: true,
    executedAt: "2026-10-05T12:00:00Z",
    readingRecord: { book: "책", chapter: "1장", thought: "생각" },
  });
  Object.assign(state.occurrences[1], { date: "2026-10-06" });
  state.occurrences[2].date = "2026-10-08";
  const options = {
    today: "2026-10-07",
    at: "2026-10-07T03:00:00Z",
    end: "2026-10-11",
    id: "revision-1",
    newId: () => "new-tactic",
    goals: plan.goals,
  };
  const input = {
    reason: "work",
    note: "근무 변경",
    keepIds: [state.occurrences[3].id],
    additions: [],
  };
  return { state, options, input, plan };
}

test("replanning archives completed, missed, reading and review records, scoring only remaining commitments", () => {
  const { state, input, options } = fixture();
  state.review = { learned: "기존 평가", next: "다음 계획", metrics: {} };
  const before = structuredClone(state);
  const next = replanWeek(state, input, options);
  assert.deepEqual(state, before);
  assert.deepEqual(next.replans[0].snapshot, before);
  assert.equal(next.replans[0].score.score, 25);
  assert.equal(next.tactics[0].plannedCount, 1);
  assert.equal(next.occurrences.length, 1);
  assert.equal(scoreWeek(next).score, 0);
  next.occurrences[0].completed = true;
  assert.equal(scoreWeek(next).score, 100);
  assert.equal(next.replans[0].score.score, 25);
  assert.deepEqual(next.review, before.review);
  assert.equal(readingRecords([{ number: 1, state: next }]).length, 1);
  assert.deepEqual(
    scoreDay(stateForDay(next, "2026-10-05"), "2026-10-05"),
    scoreDay(before, "2026-10-05"),
  );
});

test("daily new promises start today, optional executions do not become minimum commitments", () => {
  const { state, input, options, plan } = fixture();
  const extra = { ...state.occurrences[3], id: "extra", extra: true };
  state.occurrences.push(extra);
  const next = replanWeek(
    state,
    {
      ...input,
      keepIds: [...input.keepIds, "extra"],
      additions: [
        {
          goalId: plan.goals[0].id,
          title: "매일 기록",
          condition: "한 줄",
          kind: "daily",
          count: 1,
        },
      ],
    },
    options,
  );
  assert.equal(next.tactics[0].plannedCount, 1);
  assert.equal(next.tactics[1].plannedCount, 5);
  assert.deepEqual(
    next.occurrences.filter((o) => o.requiredDate).map((o) => o.date),
    ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"],
  );
  const optional = replanWeek(state, { ...input, keepIds: ["extra"] }, options);
  assert.equal(optional.tactics[0].plannedCount, 0);
  assert.equal(scoreWeek(optional).score, null);
  optional.occurrences[0].completed = true;
  assert.equal(scoreWeek(optional).score, null);
  assert.throws(
    () =>
      replanWeek(
        state,
        { ...input, keepIds: [state.occurrences[0].id] },
        options,
      ),
    /오늘 이후/,
  );
  assert.throws(
    () =>
      replanWeek(
        state,
        { ...input, keepIds: [state.occurrences[1].id] },
        options,
      ),
    /오늘 이후/,
  );
  assert.throws(
    () =>
      replanWeek(
        state,
        { ...input, keepIds: [...input.keepIds, ...input.keepIds] },
        options,
      ),
    /오늘 이후/,
  );
});

test("repeated revisions preserve history without resurrecting removed future calendar events or duplicating reading notes", () => {
  const { state, input, options } = fixture();
  state.occurrences[3].readingRecord = {
    book: "책",
    chapter: "2장",
    thought: "초안",
  };
  const first = replanWeek(state, input, options);
  first.occurrences[0].readingRecord.thought = "수정한 초안";
  const second = replanWeek(
    first,
    { ...input, keepIds: [] },
    { ...options, today: "2026-10-09", id: "revision-2" },
  );
  assert.equal(second.replans.length, 2);
  assert.equal(second.replans[1].snapshot.replans, undefined);
  assert.equal(scoreWeek(second).score, null);
  const exported = calendarWeekState(second);
  assert.deepEqual(
    exported.occurrences.map((o) => o.id),
    [state.occurrences[0].id, state.occurrences[1].id],
  );
  const notes = readingRecords([{ number: 1, state: second }]);
  assert.equal(notes.length, 2);
  assert.equal(notes[1].thought, "수정한 초안");
});

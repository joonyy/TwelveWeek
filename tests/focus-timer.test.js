import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceFocusTimer,
  initialFocusTimer,
  nextFocusPhase,
  TIMER_DURATIONS,
} from "../shared/focus-timer.js";

test("focus ends at its deadline and waits at zero without starting the break", () => {
  const initial = initialFocusTimer();
  const timer = {
    ...initial,
    running: true,
    endAt: 1000 + TIMER_DURATIONS.focus,
  };
  assert.equal(advanceFocusTimer(timer, timer.endAt - 1), timer);
  const finished = advanceFocusTimer(timer, timer.endAt);
  assert.deepEqual(finished, {
    ...initial,
    remainingMs: 0,
    finishedAt: timer.endAt,
  });
  assert.equal(
    advanceFocusTimer(finished, timer.endAt + 2 * 86400000),
    finished,
  );
  assert.equal(timer.running, true);
  assert.equal(nextFocusPhase(finished.phase), "short");
});
test("short and long rests finish in their own phase even after a background delay", () => {
  for (const phase of ["short", "long"]) {
    const timer = {
      ...initialFocusTimer(),
      phase,
      running: true,
      remainingMs: TIMER_DURATIONS[phase],
      endAt: TIMER_DURATIONS[phase],
    };
    const finished = advanceFocusTimer(timer, timer.endAt + 7 * 86400000);
    assert.equal(finished.phase, phase);
    assert.equal(finished.running, false);
    assert.equal(finished.remainingMs, 0);
    assert.equal(finished.finishedAt, timer.endAt);
    assert.equal(nextFocusPhase(phase), "focus");
  }
  const paused = { ...initialFocusTimer(), remainingMs: 92000 };
  assert.equal(advanceFocusTimer(paused, 7 * 86400000), paused);
});

export const TIMER_DURATIONS = {
  focus: 25 * 60000,
  short: 5 * 60000,
  long: 10 * 60000,
};
export const initialFocusTimer = () => ({
  phase: "focus",
  running: false,
  remainingMs: TIMER_DURATIONS.focus,
  endAt: null,
  finishedAt: null,
  alarmSilenced: false,
});

export const nextFocusPhase = (phase) =>
  phase === "focus" ? "short" : "focus";

// Wall time can finish this phase, but never starts another phase for the user.
export function advanceFocusTimer(timer, now) {
  if (!timer.running || now < timer.endAt) return timer;
  return {
    ...timer,
    running: false,
    remainingMs: 0,
    endAt: null,
    finishedAt: timer.endAt,
    alarmSilenced: false,
  };
}

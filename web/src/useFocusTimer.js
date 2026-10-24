import { useEffect, useRef, useState } from "react";
import {
  TIMER_DURATIONS,
  initialFocusTimer,
  advanceFocusTimer,
  nextFocusPhase,
} from "../../shared/focus-timer.js";
import { createTimerAlarm } from "./timer-alarm.js";

function load(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    if (
      value &&
      Object.hasOwn(TIMER_DURATIONS, value.phase) &&
      typeof value.running === "boolean" &&
      Number.isFinite(value.remainingMs) &&
      value.remainingMs >= 0 &&
      value.remainingMs <= TIMER_DURATIONS[value.phase] &&
      (!value.running || Number.isFinite(value.endAt))
    ) {
      const normalized = {
        ...value,
        finishedAt:
          !value.running && value.remainingMs === 0
            ? Number.isFinite(value.finishedAt)
              ? value.finishedAt
              : Date.now()
            : null,
        alarmSilenced: value.alarmSilenced === true,
      };
      return advanceFocusTimer(normalized, Date.now());
    }
  } catch {
    /* Storage is optional. */
  }
  return initialFocusTimer();
}

export function useFocusTimer(storageKey) {
  const key = `twelve.focusTimer.${storageKey}`;
  const [timer, setTimer] = useState(() => load(key));
  const [now, setNow] = useState(Date.now);
  const [audioReady, setAudioReady] = useState(false);
  const alarm = useRef(null);
  useEffect(() => {
    const sound = createTimerAlarm(setAudioReady);
    alarm.current = sound;
    sound.prepare();
    return () => {
      sound.dispose();
      alarm.current = null;
    };
  }, [key]);
  useEffect(() => {
    const tick = () => {
      const at = Date.now();
      setNow(at);
      setTimer((previous) => advanceFocusTimer(previous, at));
    };
    tick();
    const interval = setInterval(tick, 500);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [key]);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(timer));
    } catch {
      /* Optional persistence. */
    }
  }, [key, timer]);
  useEffect(() => {
    if (timer.finishedAt != null && !timer.alarmSilenced) alarm.current?.ring();
    else alarm.current?.stop();
    return () => alarm.current?.stop();
  }, [timer.finishedAt, timer.alarmSilenced, audioReady, key]);
  const arm = () => {
    void alarm.current?.enable();
  };
  function select(phase, running = false) {
    const at = Date.now();
    if (running) arm();
    alarm.current?.stop();
    setNow(at);
    setTimer({
      phase,
      running,
      remainingMs: TIMER_DURATIONS[phase],
      endAt: running ? at + TIMER_DURATIONS[phase] : null,
      finishedAt: null,
      alarmSilenced: false,
    });
  }
  return {
    timer,
    now,
    audioReady,
    toggle() {
      const at = Date.now();
      arm();
      setNow(at);
      setTimer((previous) => {
        const current = advanceFocusTimer(previous, at);
        if (current.finishedAt != null) return current;
        return current.running
          ? {
              ...current,
              running: false,
              remainingMs: Math.max(0, current.endAt - at),
              endAt: null,
            }
          : { ...current, running: true, endAt: at + current.remainingMs };
      });
    },
    select,
    reset: () => select(timer.phase),
    startNext: () => select(nextFocusPhase(timer.phase), true),
    silence() {
      alarm.current?.stop();
      setTimer((previous) => ({ ...previous, alarmSilenced: true }));
    },
    async preview() {
      if (await alarm.current?.enable()) {
        if (timer.finishedAt != null && !timer.alarmSilenced)
          alarm.current.ring();
        else alarm.current.preview();
      }
    },
  };
}

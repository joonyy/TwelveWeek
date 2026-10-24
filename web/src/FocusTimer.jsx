import React, { createContext, useContext, useEffect, useState } from "react";
import { Play, Pause, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { TIMER_DURATIONS, nextFocusPhase } from "../../shared/focus-timer.js";
import { useFocusTimer } from "./useFocusTimer.js";

const TimerContext = createContext(null);
export function FocusTimerProvider({ storageKey, children }) {
  const controller = useFocusTimer(storageKey);
  const [visible, setVisible] = useState(false);
  const { timer } = controller;
  const next = nextFocusPhase(timer.phase);
  return (
    <TimerContext.Provider value={{ ...controller, setVisible }}>
      {children}
      {!visible && timer.finishedAt != null && !timer.alarmSilenced && (
        <aside
          className="timer-alarm-banner"
          role="alert"
          aria-label="타이머 완료 알림"
        >
          <strong>{names[timer.phase]} 시간이 끝났어요.</strong>
          <div className="timer-actions">
            <button
              type="button"
              className="button"
              onClick={controller.startNext}
            >
              {names[next]} {TIMER_DURATIONS[next] / 60000}분 시작
            </button>
            <button
              type="button"
              className="button outlined"
              onClick={controller.silence}
            >
              알람 끄기
            </button>
          </div>
        </aside>
      )}
    </TimerContext.Provider>
  );
}
const names = { focus: "집중", short: "짧은 휴식", long: "긴 휴식" };
export default function FocusTimer() {
  const controller = useContext(TimerContext);
  const { timer, now, audioReady } = controller;
  const { setVisible } = controller;
  useEffect(() => {
    setVisible(true);
    return () => setVisible(false);
  }, [setVisible]);
  const finished = timer.finishedAt != null;
  const next = nextFocusPhase(timer.phase);
  const seconds = Math.max(
    0,
    Math.ceil((timer.running ? timer.endAt - now : timer.remainingMs) / 1000),
  );
  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <section
      className={`focus-timer ${timer.phase} ${finished ? "finished" : ""}`}
      aria-label="집중 타이머"
    >
      <header>
        <h3>집중 타이머</h3>
        <span role="status" aria-live="polite">
          {names[timer.phase]}
          {finished
            ? " 완료 · 다음 시작 대기"
            : timer.running
              ? " 중"
              : " 대기"}
        </span>
      </header>
      <div className="timer-modes" role="group" aria-label="타이머 시간 선택">
        {Object.entries(TIMER_DURATIONS).map(([phase, duration]) => (
          <button
            type="button"
            key={phase}
            aria-pressed={timer.phase === phase}
            onClick={() => controller.select(phase)}
          >
            {names[phase]} {duration / 60000}분
          </button>
        ))}
      </div>
      <div
        className="timer-countdown"
        role="timer"
        aria-label="남은 시간"
        aria-live="off"
      >
        {time}
      </div>
      {finished && (
        <p className="timer-finished-message">
          {names[timer.phase]} 시간이 끝났어요. 준비되면 다음 타이머를
          시작하세요.
        </p>
      )}
      <div className="timer-actions">
        {finished ? (
          <>
            <button
              type="button"
              className="button"
              onClick={controller.startNext}
            >
              <Play size={16} />
              {names[next]} {TIMER_DURATIONS[next] / 60000}분 시작
            </button>
            <button
              type="button"
              className="button outlined"
              onClick={controller.silence}
              disabled={timer.alarmSilenced}
            >
              <VolumeX size={15} />
              {timer.alarmSilenced ? "알람 꺼짐" : "알람 끄기"}
            </button>
          </>
        ) : (
          <button type="button" className="button" onClick={controller.toggle}>
            {timer.running ? <Pause size={16} /> : <Play size={16} />}
            {timer.running ? "일시정지" : "시작"}
          </button>
        )}
        <button
          type="button"
          className="button outlined"
          onClick={controller.reset}
        >
          <RotateCcw size={15} />
          초기화
        </button>
      </div>
      <button
        type="button"
        className="text-button timer-sound-test"
        onClick={controller.preview}
      >
        <Volume2 size={14} />
        {finished && !audioReady && !timer.alarmSilenced
          ? "알람 소리 켜기"
          : "알람 소리 확인"}
      </button>
      {finished && !audioReady && !timer.alarmSilenced && (
        <p className="timer-audio-help">
          브라우저에서 소리를 재생하려면 ‘알람 소리 켜기’를 눌러주세요.
        </p>
      )}
      <small>
        집중·휴식이 끝나면 알람이 울리고 00:00에서 기다립니다. 다음 시간은 직접
        시작하세요.
      </small>
    </section>
  );
}

import React, { useRef, useState } from "react";
import { CalendarDays, Check, Download } from "lucide-react";
import {
  addDays,
  hasScheduledTime,
  occurrenceLabel,
} from "../../shared/domain.js";
import {
  executionStatus,
  summarizeExecutions,
} from "../../shared/execution-status.js";
import "./current-week-plan.css";
import GoalReferenceLink from "./GoalReferenceLink.jsx";

function scheduledLabel(occurrence, today) {
  if (+occurrence.time.slice(0, 2) < 4) {
    return occurrence.date === today
      ? `내일 새벽 ${occurrence.time}`
      : `${occurrence.date.slice(5).replace("-", ".")} 다음 날 ${occurrence.time}`;
  }
  const date =
    occurrence.date === today
      ? "오늘"
      : occurrence.date.slice(5).replace("-", ".");
  return `${date} ${occurrence.time}`;
}

export default function CurrentWeekPlan({
  week,
  readonly,
  scheduleReadonly,
  onSchedule,
  onCalendar,
  timetable,
  timetableSource,
  editingTimetable,
  onExport,
  exportDisabled,
  referenceGoals = [],
}) {
  const [showAllActions, setShowAllActions] = useState(false);
  const detailsRef = useRef(null);
  const { tactics, occurrences, goals } = week.state;
  const groups = goals.filter((g) => tactics.some((t) => t.goalId === g.id));
  const statusContext = { today: week.today, weekEnd: addDays(week.start, 6) };
  const statusOf = (o) => executionStatus(o, statusContext);
  const extras = occurrences.filter((o) => o.extra);
  const counts = summarizeExecutions(
    occurrences.filter((o) => !o.extra),
    statusContext,
  );
  const showPastExecutions = (tacticId) => {
    const details = detailsRef.current;
    details.open = true;
    const row = [...details.querySelectorAll("[data-tactic-id]")].find(
      (element) => element.dataset.tacticId === tacticId,
    );
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const actionRows = tactics
    .map((t) => {
      const items = occurrences.filter((o) => o.tacticId === t.id);
      const missed = items.filter((o) => !o.extra && statusOf(o) === "missed");
      const unplaced = items.filter((o) => statusOf(o) === "unplaced");
      const scheduled = items
        .filter((o) => statusOf(o) === "scheduled")
        .sort((a, b) =>
          `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`),
        );
      return {
        tactic: t,
        goal: goals.find((g) => g.id === t.goalId),
        items,
        missed,
        unplaced,
        scheduled,
        done: items.filter(
          (o) => o.completed && (t.kind !== "daily" || !o.extra),
        ).length,
        target: unplaced[0] || scheduled[0],
      };
    })
    .filter((row) => row.missed.length || row.target)
    .sort((a, b) => Number(!!b.unplaced.length) - Number(!!a.unplaced.length));
  const visibleActionRows = showAllActions
    ? actionRows
    : actionRows.slice(0, 4);
  return (
    <section className="current-week-plan" aria-label="이번 주 계획표">
      <header className="section-heading">
        <div>
          <span className="eyebrow">
            WEEK {String(week.number).padStart(2, "0")}
          </span>
          <h2>{week.number}주차 계획표</h2>
          <p className="muted">
            {week.start}~{addDays(week.start, 6)} · 목표 {groups.length}개 ·
            전술 {tactics.length}개 · 실행 {occurrences.length}회
          </p>
        </div>
        <button type="button" className="button outlined" onClick={onCalendar}>
          <CalendarDays size={16} />
          주간 일정으로 보기
        </button>
      </header>
      <section
        className="panel current-week-actions"
        aria-label="이번 주 할 일"
      >
        <header className="section-heading">
          <div>
            <h3>이번 주 할 일</h3>
            <p className="muted">
              시간을 정할 실행과 실행 없이 지난 항목을 구분해서 확인하세요. 완료
              기록은 일간 실행에서 남길 수 있어요.
            </p>
          </div>
          <div
            className="current-week-action-counts"
            aria-label="이번 주 실행 현황"
          >
            <span data-status="completed">완료 {counts.completed}회</span>
            <span data-status="missed">실행 없이 지남 {counts.missed}회</span>
            <span data-status="scheduled">
              예정·미완료 {counts.scheduled}회
            </span>
            <span data-status="unplaced">
              아직 시간 미정 {counts.unplaced}회
            </span>
          </div>
        </header>
        <p className="current-week-status-note">
          네 상태는 서로 겹치지 않으며 합계는{" "}
          {extras.length ? "기본 약속" : "전체"} {counts.total}회예요. ‘실행
          없이 지남’은 평가일이 끝났는데 완료 기록이 없는 항목입니다. 오늘의
          실행은 다음 날 04시까지, 날짜를 정하지 않은 실행은 이번 주가 끝날
          때까지 기다립니다.
        </p>
        {extras.length > 0 && (
          <p className="current-week-status-note">
            추가 실행 {extras.filter((o) => o.completed).length}회 완료 /{" "}
            {extras.length}회 등록 · 추가 실행은 최소 약속을 늘리지 않으며,
            미완료여도 점수가 깎이지 않아요.
          </p>
        )}
        {actionRows.length ? (
          <div className="current-week-action-grid">
            {visibleActionRows.map((row) => (
              <article className="current-week-action" key={row.tactic.id}>
                <div className="current-week-action-main">
                  <small>{row.goal?.title || "목표"}</small>
                  <h4>{row.tactic.title}</h4>
                  <details className="current-week-action-condition">
                    <summary>1회 완료 기준</summary>
                    <p>{row.tactic.condition}</p>
                  </details>
                </div>
                <div className="current-week-action-footer">
                  <span className="current-week-action-progress">
                    {row.done}회 실행 / 최소 {row.tactic.plannedCount}회
                  </span>
                  {row.done >= row.tactic.plannedCount && (
                    <span className="pill">
                      최소 약속 달성
                      {row.done > row.tactic.plannedCount
                        ? ` · 초과 실행 ${row.done - row.tactic.plannedCount}회`
                        : ""}
                    </span>
                  )}
                  {row.unplaced.length > 0 && (
                    <span className="current-week-action-unplaced">
                      시간 미정 {row.unplaced.length}회
                    </span>
                  )}
                  {row.missed.length > 0 && (
                    <span className="current-week-action-missed">
                      실행 없이 지남 {row.missed.length}회
                    </span>
                  )}
                  {row.scheduled[0] && (
                    <span className="current-week-action-time">
                      예정 {scheduledLabel(row.scheduled[0], week.today)}
                    </span>
                  )}
                </div>
                {row.target ? (
                  <button
                    type="button"
                    className="button outlined current-week-action-button"
                    disabled={readonly || scheduleReadonly}
                    onClick={() => onSchedule(row.target)}
                    aria-label={`${row.tactic.title} ${occurrenceLabel(row.target, row.items)} ${row.unplaced.length ? "배치" : "일정 수정"}`}
                  >
                    <CalendarDays size={15} />
                    {row.unplaced.length ? "시간 정하기" : "일정 확인·수정"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button outlined current-week-action-button"
                    onClick={() => showPastExecutions(row.tactic.id)}
                    aria-label={`${row.tactic.title} 지난 실행 확인`}
                  >
                    지난 실행 확인
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="current-week-actions-empty">
            {occurrences.length
              ? "이번 주 실행을 모두 완료했어요."
              : "이 주에 배정된 실행이 없어요."}
          </p>
        )}
        {actionRows.length > 4 && (
          <button
            type="button"
            className="button outlined current-week-actions-toggle"
            onClick={() => setShowAllActions((value) => !value)}
            aria-expanded={showAllActions}
          >
            {showAllActions
              ? "처음 4개만 보기"
              : `나머지 ${actionRows.length - 4}개 할 일 보기`}
          </button>
        )}
      </section>
      <section className="current-week-timetable" aria-label="주차별 시간표">
        <header className="section-heading">
          <div>
            <h3>{week.number}주차 근무·생활 시간표와 실행 일정</h3>
            <p className="muted">
              {timetableSource}{" "}
              {editingTimetable
                ? "아래에서 블록 종류를 고르고 빈 시간을 눌러 직접 편집할 수 있습니다."
                : "점선은 근무·생활 시간표, 실선은 배치한 실행입니다."}
            </p>
          </div>
          <div className="week-model-actions">
            <button
              type="button"
              className="button outlined"
              disabled={readonly || exportDisabled}
              onClick={onExport}
            >
              <Download size={16} />
              Apple 캘린더로 내보내기
            </button>
          </div>
        </header>
        {timetable}
        <p className="footnote">
          내보내기에는 이 주의 근무·생활 시간표와 배치한 실행이 함께 포함됩니다.
          근무·생활 블록을 수정했다면 먼저 시간표를 저장하세요. .ics 파일을 다시
          가져올 때 기존 일정을 확인하세요.
        </p>
      </section>
      <details className="current-week-details" ref={detailsRef}>
        <summary>전술·완료 기준·전체 회차 자세히 보기</summary>
        <p className="current-week-note">
          이번 주 기준을 그대로 보여줍니다. 실행 횟수는 소요시간을 뜻하지
          않아요.
        </p>
        {groups.map((g) => (
          <section
            className="panel current-week-goal"
            key={g.id}
            aria-label={g.title}
          >
            <h3>{g.title}</h3>
            <GoalReferenceLink
              url={
                referenceGoals.find((goal) => goal.id === g.id)?.referenceUrl
              }
            />
            {tactics
              .filter((t) => t.goalId === g.id)
              .map((t) => {
                const items = occurrences.filter((o) => o.tacticId === t.id);
                const done = items.filter(
                  (o) => o.completed && (t.kind !== "daily" || !o.extra),
                ).length;
                return (
                  <article
                    className="current-week-tactic"
                    key={t.id}
                    data-tactic-id={t.id}
                    tabIndex={-1}
                  >
                    <header>
                      <h4>{t.title}</h4>
                      <span>
                        {t.kind === "daily"
                          ? "매일"
                          : t.kind === "once"
                            ? "이번 주 최소 1회"
                            : `주 ${t.plannedCount}회 이상`}{" "}
                        · {done}회 실행 / 최소 {t.plannedCount}회
                      </span>
                    </header>
                    <p>
                      <strong>1회 완료 기준</strong> {t.condition}
                    </p>
                    <div className="current-week-occurrences">
                      {items.map((o, i) => (
                        <button
                          type="button"
                          key={o.id}
                          data-status={o.extra ? "extra" : statusOf(o)}
                          disabled={readonly || scheduleReadonly || o.completed}
                          onClick={() => onSchedule(o)}
                          aria-label={`${t.title} ${occurrenceLabel(o, items)} ${o.completed ? "완료" : hasScheduledTime(o) ? "일정 수정" : "배치"}`}
                        >
                          {o.completed ? (
                            <Check size={14} />
                          ) : (
                            <CalendarDays size={14} />
                          )}
                          <span>
                            {occurrenceLabel(o, items)} ·{" "}
                            {hasScheduledTime(o)
                              ? `${o.date.slice(5).replace("-", ".")} ${+o.time.slice(0, 2) < 4 ? "다음 날 " : ""}${o.time} · ${o.minutes}분`
                              : o.date
                                ? `${o.date.slice(5).replace("-", ".")} · 시간 미배치`
                                : "시간 미정"}
                          </span>
                          <span className="current-week-occurrence-status">
                            {o.extra
                              ? o.completed
                                ? "추가 실행 완료"
                                : "선택한 추가 실행 · 점수 기준 제외"
                              : {
                                  completed: "완료",
                                  missed: "실행 없이 지남",
                                  scheduled: "예정·미완료",
                                  unplaced: "아직 시간 미정",
                                }[statusOf(o)]}
                          </span>
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
          </section>
        ))}
        {!groups.length && (
          <div className="panel empty-inline">
            <p>이 주에 배정된 전술이 없어요.</p>
          </div>
        )}
      </details>
    </section>
  );
}

import React from "react";
import { ArrowRight } from "lucide-react";
import {
  addDays,
  dateOnly,
  DEFAULT_START,
  prepareWeek,
} from "../../shared/domain.js";
import { hasTacticContent } from "../../shared/planning.js";
import "./weekly-plan.css";

const shortDate = (d) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
const dateRange = (start) =>
  `${shortDate(start)} — ${shortDate(addDays(start, 6))}`;

export default function WeeklyPlanPreview({
  plan,
  start,
  weekCount,
  week,
  onSelectWeek,
  onEditGoal,
  status,
  onCalendar,
  calendarLabel,
  calendarDisabled,
}) {
  let validStart = false;
  try {
    validStart = dateOnly(start);
  } catch {
    // The date input can be incomplete while the user edits it.
  }
  const number = Math.min(weekCount, Math.max(1, week));
  const referenceStart = validStart ? start : DEFAULT_START;
  const state = prepareWeek(plan, referenceStart, number);
  const groups = plan.goals
    .map((goal, index) => ({
      ...goal,
      number: index + 1,
      tactics: state.tactics.filter((t) => t.goalId === goal.id),
    }))
    .filter((g) => g.tactics.length);
  const unplaced = plan.goals.flatMap((g) =>
    g.tactics
      .filter(
        (t) =>
          hasTacticContent(t) && !t.weeks.some((w) => w >= 1 && w <= weekCount),
      )
      .map((t) => ({ ...t, goalId: g.id })),
  );
  return (
    <section className="weekly-plan-preview" aria-label="주차별 계획 미리보기">
      <nav className="planning-week-selector" aria-label="계획 주차 선택">
        {Array.from({ length: weekCount }, (_, i) => i + 1).map((w) => (
          <button
            type="button"
            key={w}
            aria-pressed={number === w}
            onClick={() => onSelectWeek(w)}
          >
            <strong>{w}주차</strong>
            {validStart && (
              <small>{dateRange(addDays(start, (w - 1) * 7))}</small>
            )}
          </button>
        ))}
      </nav>
      <header className="weekly-plan-heading">
        <div>
          <span className="eyebrow">
            WEEK {String(number).padStart(2, "0")}
          </span>
          <h2>{number}주차의 계획</h2>
          <p className="muted">
            {validStart
              ? dateRange(addDays(start, (number - 1) * 7))
              : "시작 월요일을 선택하면 주차별 날짜가 표시됩니다."}
          </p>
        </div>
        <dl className="weekly-plan-summary">
          <div>
            <dt>목표</dt>
            <dd>{groups.length}개</dd>
          </div>
          <div>
            <dt>전술</dt>
            <dd>{state.tactics.length}개</dd>
          </div>
          <div>
            <dt>실행</dt>
            <dd>{state.occurrences.length}회</dd>
          </div>
        </dl>
      </header>
      <p className="weekly-plan-note">
        작성 중인 계획을 모아 보여줍니다. 실행 횟수는 소요시간을 뜻하지 않아요.
        {status !== "draft" &&
          " 이미 시작한 주의 실행 기준과 기록은 ‘실행과 평가’에서 확인하세요."}
      </p>
      {onCalendar && (
        <div className="weekly-calendar-action">
          <button
            type="button"
            className="button light"
            onClick={onCalendar}
            disabled={calendarDisabled}
          >
            {calendarLabel}
          </button>
          <p className="muted">
            기존 일정을 불러온 뒤 날짜·시간을 배치하고, 겹침을 검토해
            적용합니다.
          </p>
        </div>
      )}
      {unplaced.length > 0 && (
        <aside className="weekly-unplaced" aria-label="실행 주차가 없는 전술">
          <strong>실행 주차를 지정하지 않은 전술 {unplaced.length}개</strong>
          {unplaced.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() => onEditGoal(t.goalId)}
            >
              {t.title.trim() || "이름 없는 전술"}
              <ArrowRight size={14} />
            </button>
          ))}
        </aside>
      )}
      {groups.length ? (
        groups.map((g) => (
          <article
            className="panel weekly-plan-goal"
            key={g.id}
            aria-label={`${g.title.trim() || "이름 없는 목표"}의 주간 전술`}
          >
            <header>
              <div>
                <span className="eyebrow">
                  GOAL {String(g.number).padStart(2, "0")}
                </span>
                <h3>{g.title.trim() || "이름 없는 목표"}</h3>
              </div>
              <button
                type="button"
                className="text-button"
                aria-label={`목표 ${g.number} 계획 수정`}
                onClick={() => onEditGoal(g.id)}
              >
                목표별 계획 수정
                <ArrowRight size={15} />
              </button>
            </header>
            <ul className="weekly-tactic-list">
              {g.tactics.map((t) => (
                <li key={t.id}>
                  <div className="weekly-tactic-title">
                    <strong>{t.title.trim() || "이름 없는 전술"}</strong>
                    <span className="pill">
                      {t.kind === "daily"
                        ? "매일 1회 · 총 7회"
                        : t.kind === "once"
                          ? "이번 주 최소 1회"
                          : `주 ${t.plannedCount}회 이상`}
                    </span>
                  </div>
                  <details>
                    <summary>1회 완료 기준</summary>
                    <p>
                      {t.condition.trim() || "1회 완료 기준을 작성해주세요."}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          </article>
        ))
      ) : (
        <div className="goal-plan-empty">
          이 주에 예정된 전술이 없어요. 목표별 보기에서 전술의 실행 주차를
          배치할 수 있습니다.
        </div>
      )}
    </section>
  );
}

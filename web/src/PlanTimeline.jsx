import React from "react";
import { ArrowRight, Flag } from "lucide-react";
import { addDays, dateOnly } from "../../shared/domain.js";
import { planTimeline } from "../../shared/plan-timeline.js";
import "./plan-timeline.css";

const shortDate = (date) =>
  `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`;
const frequency = (tactic) =>
  tactic.kind === "daily"
    ? "매일 1회"
    : tactic.kind === "once"
      ? "선택 주마다 최소 1회"
      : `주 ${tactic.minimum}회 이상`;

export default function PlanTimeline({
  plan,
  start,
  weekCount,
  week,
  onSelectWeek,
  onEditGoal,
  onDetails,
  status,
}) {
  const { goals, totals } = planTimeline(plan, weekCount);
  let validStart = false;
  try {
    validStart = dateOnly(start);
  } catch {
    /* Incomplete date input. */
  }
  const selected = Math.min(weekCount, Math.max(1, week));
  const active = goals
    .map((g) => ({
      ...g,
      tactics: g.tactics.filter((t) => t.weeks.includes(selected)),
    }))
    .filter((g) => g.tactics.length);
  return (
    <section className="panel plan-timeline" aria-label="전체 기간 마일스톤">
      <header className="section-heading">
        <div>
          <span className="eyebrow">
            <Flag size={13} /> MILESTONES
          </span>
          <h2>{weekCount}주 실행 로드맵</h2>
          <p className="muted">
            어느 기간에 무엇을 할지 먼저 살펴보고, 아래 모범 주간에 필요한
            시간을 확보하세요.
          </p>
        </div>
      </header>
      <p className="plan-timeline-note">
        막대는 전술의 실행 기간입니다. 주차를 누르면 그 주의 약속을 모아 봅니다.
        실행 횟수는 소요시간을 뜻하지 않아요.
        {status !== "draft" &&
          " 이미 시작한 주의 실제 약속과 기록은 ‘실행과 평가’에서 확인하세요."}
      </p>
      {!validStart && (
        <p className="muted">시작 월요일을 정하면 실제 날짜도 함께 표시돼요.</p>
      )}
      <div
        className="plan-timeline-scroll"
        tabIndex={0}
        aria-label="전체 주차 타임라인 · 좌우로 스크롤"
        style={{ "--timeline-weeks": weekCount }}
      >
        <div className="plan-timeline-board">
          <div className="plan-timeline-header">
            <strong className="plan-timeline-label">목표와 전술</strong>
            <div className="plan-timeline-track">
              {totals.map((total, i) => (
                <button
                  type="button"
                  key={i}
                  className="plan-timeline-week"
                  aria-pressed={selected === i + 1}
                  aria-label={`${i + 1}주차 약속 보기`}
                  onClick={() => onSelectWeek(i + 1)}
                >
                  <strong>{i + 1}주차</strong>
                  {validStart && (
                    <small>
                      {shortDate(addDays(start, i * 7))}~
                      {shortDate(addDays(start, i * 7 + 6))}
                    </small>
                  )}
                  <small>최소 {total}회</small>
                </button>
              ))}
            </div>
          </div>
          {goals.map((goal, index) => (
            <div className="plan-timeline-goal" key={goal.id}>
              <header>
                <h3>
                  {String(index + 1).padStart(2, "0")} ·{" "}
                  {goal.title.trim() || "이름 없는 목표"}
                </h3>
                <button
                  type="button"
                  className="text-button"
                  aria-label={`${goal.title} 계획 수정`}
                  onClick={() => onEditGoal(goal.id)}
                >
                  계획 수정 <ArrowRight size={13} />
                </button>
              </header>
              {goal.tactics.map((tactic) => (
                <div className="plan-timeline-row" key={tactic.id}>
                  <div className="plan-timeline-label">
                    <span>{tactic.title.trim() || "이름 없는 전술"}</span>
                    <small>{frequency(tactic)}</small>
                  </div>
                  <div className="plan-timeline-track plan-timeline-periods">
                    {!tactic.weeks.length && (
                      <span className="plan-timeline-unassigned">
                        실행 주차 미정 · 계획에서 주차를 정해주세요
                      </span>
                    )}
                    {tactic.segments.map((segment) => (
                      <button
                        type="button"
                        key={segment.start}
                        className={`plan-timeline-bar ${tactic.kind}`}
                        style={{
                          gridColumn: `${segment.start} / ${segment.end + 1}`,
                        }}
                        aria-label={`${tactic.title} · ${segment.start === segment.end ? `${segment.start}주차` : `${segment.start}~${segment.end}주차`} · ${frequency(tactic)}`}
                        title={`${tactic.title}\n${tactic.condition}`}
                        onClick={() => onSelectWeek(segment.start)}
                      >
                        {tactic.kind === "once" && <Flag size={11} />}
                        {tactic.title}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {!goal.tactics.length && (
                <p className="muted">
                  아직 전술이 없어요. 계획 수정에서 필요한 행동을 정해주세요.
                </p>
              )}
            </div>
          ))}
          {!goals.length && (
            <p className="muted">
              목표와 전술을 작성하면 전체 기간의 흐름이 여기에 표시돼요.
            </p>
          )}
        </div>
      </div>
      <section
        className="plan-timeline-selected"
        aria-label={`${selected}주차 약속 요약`}
      >
        <header>
          <h3>
            {selected}주차에 하기로 한 일 · 최소 {totals[selected - 1]}회
          </h3>
          <button
            type="button"
            className="text-button"
            onClick={() => onDetails(selected)}
          >
            이 주 계획 상세 보기 <ArrowRight size={14} />
          </button>
        </header>
        <div className="plan-timeline-selected-goals">
          {active.map((goal) => (
            <div key={goal.id}>
              <strong>{goal.title}</strong>
              <ul>
                {goal.tactics.map((t) => (
                  <li key={t.id}>
                    {t.title} <small>· {frequency(t)}</small>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {!active.length && (
          <p className="muted">
            이 주에 배정된 전술이 없어요. 여유로 둘지, 필요한 전술이 빠졌는지
            확인하세요.
          </p>
        )}
      </section>
    </section>
  );
}

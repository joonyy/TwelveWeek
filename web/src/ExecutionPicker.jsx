import React, { useState } from "react";
import { Plus, Target } from "lucide-react";
import { hasGoalContent, hasTacticContent } from "../../shared/planning.js";
import { hasScheduledTime, occurrenceLabel } from "../../shared/domain.js";
import "./execution-picker.css";

function TacticChoice({ tactic, occurrences, date, busy, onPlace, onExtra }) {
  const available = occurrences.filter(
    (o) => !o.completed && (!o.requiredDate || o.requiredDate === date),
  );
  const [selected, setSelected] = useState(
    () => (available.find((o) => !hasScheduledTime(o)) ?? available[0])?.id,
  );
  const occurrence =
    available.find((o) => o.id === selected) ??
    available.find((o) => !hasScheduledTime(o)) ??
    available[0];
  return (
    <article className="execution-tactic-choice">
      <h4>{tactic.title}</h4>
      <p className="execution-condition">1회 완료 기준 · {tactic.condition}</p>
      <p className="execution-status">
        {tactic.kind === "daily"
          ? "매일 1회"
          : `이번 주 최소 ${tactic.plannedCount}회`}{" "}
        · 미배치{" "}
        {occurrences.filter((o) => !o.completed && !hasScheduledTime(o)).length}{" "}
        · 배치{" "}
        {occurrences.filter((o) => hasScheduledTime(o) && !o.completed).length}{" "}
        · 완료 {occurrences.filter((o) => o.completed).length}
      </p>
      {occurrence ? (
        <div className="execution-choice-actions">
          <label className="field">
            <span>실행 회차</span>
            <select
              aria-label={`${tactic.title} 실행 회차`}
              value={occurrence.id}
              onChange={(e) => setSelected(e.target.value)}
              disabled={busy}
            >
              {available.map((o) => (
                <option key={o.id} value={o.id}>
                  {occurrenceLabel(o, occurrences)} ·{" "}
                  {hasScheduledTime(o)
                    ? `${o.date.slice(5).replace("-", ".")} ${o.time} 배치됨`
                    : "미배치"}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button outlined"
            disabled={busy}
            aria-label={`${tactic.title} ${occurrenceLabel(occurrence, occurrences)} ${hasScheduledTime(occurrence) ? "이 시간으로 이동" : "이 시간에 배치"}`}
            onClick={() => onPlace(occurrence)}
          >
            <Plus size={15} />
            {hasScheduledTime(occurrence)
              ? "이 시간으로 이동"
              : "이 시간에 배치"}
          </button>
        </div>
      ) : (
        <p className="muted">
          {occurrences.every((o) => o.completed)
            ? "이 전술의 실행을 모두 완료했어요."
            : "매일 전술은 해당 날짜의 실행만 옮길 수 있어요."}
        </p>
      )}
      {onExtra && tactic.kind !== "daily" && (
        <button
          type="button"
          className="text-button execution-extra"
          disabled={busy || occurrences.length >= 50}
          aria-label={`${tactic.title} 이번 주 1회 더 추가`}
          onClick={() => onExtra(tactic)}
        >
          <Plus size={15} /> 추가 실행 1회 · 최소 {tactic.plannedCount}회 유지
        </button>
      )}
    </article>
  );
}

export default function ExecutionPicker({
  cycle,
  week,
  placement,
  busy,
  onPlace,
  onAdd,
  onExtra,
  children,
}) {
  const goals = [...(week.state.goals ?? [])];
  for (const goal of cycle.plan.goals.filter(hasGoalContent))
    if (!goals.some((item) => item.id === goal.id)) goals.push(goal);
  const [selected, setSelected] = useState(
    goals.length === 1 ? goals[0].id : "",
  );
  const [choosing, setChoosing] = useState(goals.length !== 1);
  const goal = goals.find((item) => item.id === selected);
  const tactics = week.state.tactics.filter(
    (tactic) => tactic.goalId === selected,
  );
  const planGoal = cycle.plan.goals.find((item) => item.id === selected);
  const others = (planGoal?.tactics ?? []).filter(
    (tactic) =>
      hasTacticContent(tactic) &&
      !tactics.some((item) => item.id === tactic.id),
  );
  return (
    <div className="execution-picker">
      <p className="muted">
        어떤 목표에 집중할까요? 목표를 고른 뒤 실행을 배치하세요. 이미 배치한
        실행은 이 시간으로 옮길 수 있어요.
      </p>
      {goal && !choosing && (
        <div className="execution-focus">
          <span>
            <Target size={16} />
            집중할 목표 · {goal.title}
          </span>
          {goals.length > 1 && (
            <button
              type="button"
              className="text-button"
              onClick={() => setChoosing(true)}
            >
              다른 목표 선택
            </button>
          )}
        </div>
      )}
      {(!goal || choosing) && (
        <div className="execution-goal-list" aria-label="집중할 목표 선택">
          {goals.map((item) => {
            const rows = week.state.tactics.filter(
              (tactic) => tactic.goalId === item.id,
            );
            const occurrences = week.state.occurrences.filter((o) =>
              rows.some((tactic) => tactic.id === o.tacticId),
            );
            return (
              <button
                type="button"
                key={item.id}
                className={selected === item.id ? "selected" : ""}
                aria-pressed={selected === item.id}
                onClick={() => {
                  setSelected(item.id);
                  setChoosing(false);
                }}
              >
                <Target size={16} />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    이번 주 전술 {rows.length}개 · 미배치{" "}
                    {
                      occurrences.filter(
                        (o) => !o.completed && !hasScheduledTime(o),
                      ).length
                    }
                    회{!rows.length ? " · 이번 주 약속 없음" : ""}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {goal && (
        <section
          className="execution-goal-content"
          aria-label="선택한 목표의 전술"
        >
          <header>
            <h3>{goal.title}</h3>
            {onAdd && planGoal && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => onAdd(goal.id)}
              >
                <Plus size={15} />이 목표에 전술 추가
              </button>
            )}
          </header>
          {tactics.map((tactic) => (
            <TacticChoice
              key={tactic.id}
              tactic={tactic}
              occurrences={week.state.occurrences.filter(
                (o) => o.tacticId === tactic.id,
              )}
              date={placement.date}
              busy={busy}
              onPlace={onPlace}
              onExtra={onExtra}
            />
          ))}
          {!tactics.length && (
            <p className="muted">이 목표에는 이번 주에 확정된 전술이 없어요.</p>
          )}
          {others.length > 0 && (
            <details className="execution-other-weeks">
              <summary>
                이번 주 목록에 없던 전술 {others.length}개 · 이유 확인
              </summary>
              {others.map((tactic) => (
                <article key={tactic.id}>
                  <h4>{tactic.title}</h4>
                  <p>
                    {tactic.weeks.includes(week.number)
                      ? "계획에는 이번 주가 선택되어 있지만, 주간 기준이 확정된 뒤에 변경되어 아직 포함되지 않았어요."
                      : `다른 주차에 계획됨 · ${tactic.weeks.join("·")}주차`}
                  </p>
                  {onAdd && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => onAdd(goal.id, tactic)}
                    >
                      이 전술을 이번 주에 가져오기
                    </button>
                  )}
                </article>
              ))}
            </details>
          )}
          {children}
        </section>
      )}
    </div>
  );
}

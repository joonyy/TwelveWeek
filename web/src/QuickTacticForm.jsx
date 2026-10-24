import React, { useState } from "react";
import { newTactic } from "../../shared/planning.js";

export default function QuickTacticForm({
  goal,
  source,
  week,
  weekCount,
  busy,
  onSave,
  onCancel,
}) {
  const futureWeeks = Array.from({ length: weekCount }, (_, i) => i + 1).filter(
    (number) => number > week.number,
  );
  const [tactic, setTactic] = useState(
    () => source ?? { ...newTactic(weekCount), weeks: [] },
  );
  const [error, setError] = useState("");
  const update = (key, value) => setTactic((old) => ({ ...old, [key]: value }));
  return (
    <form
      className="execution-tactic-form"
      aria-label="목표에 전술 추가"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const result = await onSave({
          goalId: goal.id,
          ...(source ? { sourceTacticId: source.id } : { tactic }),
        });
        if (!result?.ok)
          setError(
            result?.error ||
              "저장하지 못했어요. 연결 상태를 확인하고 다시 시도해주세요.",
          );
      }}
    >
      <fieldset disabled={busy} className="quick-tactic-inputs">
        <span className="eyebrow">
          {source ? "기존 전술 가져오기" : "새 전술"}
        </span>
        <h3>{goal.title}</h3>
        <p className="muted">
          목표를 위해 직접 실행할 행동과, 한 번의 완료를 판단할 기준을 적으세요.
        </p>
        <label className="field">
          <span>전술 이름</span>
          <input
            aria-label="추가할 전술 이름"
            value={tactic.title}
            onChange={(event) => update("title", event.target.value)}
            required
            maxLength={6000}
            readOnly={!!source}
          />
        </label>
        <label className="field">
          <span>1회 완료 기준</span>
          <textarea
            aria-label="추가할 전술 완료 기준"
            value={tactic.condition}
            onChange={(event) => update("condition", event.target.value)}
            required
            maxLength={6000}
            rows={2}
            readOnly={!!source}
          />
        </label>
        {!source && (
          <div className="two-col">
            <label className="field">
              <span>정식 계획의 실행 방식</span>
              <select
                aria-label="추가할 전술 실행 방식"
                value={tactic.kind}
                onChange={(event) => update("kind", event.target.value)}
              >
                <option value="weekly">주간 반복</option>
                <option value="daily">매일 1회</option>
                <option value="once">선택 주차마다 1회</option>
              </select>
            </label>
            {tactic.kind === "weekly" && (
              <label className="field">
                <span>주당 실행 횟수</span>
                <small>
                  최소 약속입니다. 이 횟수 이상 실행하고 초과 실행은 별도로
                  기록해요.
                </small>
                <input
                  aria-label="추가할 전술 주당 횟수"
                  type="number"
                  min={1}
                  max={50}
                  required
                  value={tactic.count}
                  onChange={(event) =>
                    update("count", Number(event.target.value))
                  }
                />
              </label>
            )}
          </div>
        )}
        {tactic.kind === "daily" && (
          <p className="footnote">
            매일 전술은 이번 주 7일 모두 평가합니다. 이미 지난 날의 미실행도
            미완료로 남습니다.
          </p>
        )}
        {source && (
          <p className="footnote">
            이번 주에 추가할 약속:{" "}
            {tactic.kind === "daily"
              ? "매일 1회 · 총 7회"
              : tactic.kind === "once"
                ? "1회"
                : `주 ${tactic.count}회`}
          </p>
        )}
        <p className="current-week-note">
          이번 주 평가에 포함됩니다. 기존 약속은 유지하고 새 전술과 실행 횟수만
          추가합니다. 평가할 전술이 늘어나므로 주간 점수의 전술별 비중이
          달라집니다.
        </p>
        {!source && (
          <fieldset disabled={busy} className="week-picks">
            <legend>함께 적용할 이후 주차 (선택)</legend>
            <p className="footnote">
              {week.number}주차는 반드시 포함됩니다. 이후에도 반복할 주차를
              선택하세요.
            </p>
            <div className="weeks">
              {futureWeeks.map((number) => (
                <button
                  type="button"
                  key={number}
                  aria-label={`추가 전술 ${number}주차`}
                  aria-pressed={tactic.weeks.includes(number)}
                  className={tactic.weeks.includes(number) ? "on" : ""}
                  onClick={() =>
                    update(
                      "weeks",
                      tactic.weeks.includes(number)
                        ? tactic.weeks.filter((item) => item !== number)
                        : [...tactic.weeks, number].sort((a, b) => a - b),
                    )
                  }
                >
                  {number}주
                </button>
              ))}
            </div>
            {!futureWeeks.length && (
              <p className="footnote">
                마지막 실행 주차입니다. 이후 주차는 없어요.
              </p>
            )}
          </fieldset>
        )}
        {source && (
          <p className="footnote">
            기존 전술의 이후 주차와 완료 기준은 유지됩니다.
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={onCancel}
          >
            목표·전술 선택으로
          </button>
          <button className="button" type="submit" disabled={busy}>
            {busy ? "저장 중…" : "전술 추가하고 배치"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

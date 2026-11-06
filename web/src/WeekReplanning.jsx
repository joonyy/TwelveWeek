import React, { useState } from "react";
import { addDays, percentage } from "../../shared/domain.js";
import {
  REPLAN_REASONS,
  canReplanOccurrence,
} from "../../shared/week-replanning.js";
import "./week-replanning.css";

export function WeekReplanningHistory({ week }) {
  const history = week.state.replans;
  if (!history?.length) return null;
  return (
    <section className="panel replan-history" aria-label="주간 재정립 이력">
      <h2>재정립된 주 · {history.at(-1).effectiveDate}부터 새 약속</h2>
      <p>
        현재 점수 {percentage(week.score.score)}는 마지막 재정립 이후 약속의
        실행률입니다. 이전 기준의 진행률과 합산하지 않습니다.
      </p>
      {history.map((r, index) => (
        <details key={r.id}>
          <summary>
            {index + 1}차 재정립 · {r.effectiveDate} · 변경 당시{" "}
            {index === 0 ? "원안" : "이전 계획"} 진행률{" "}
            {percentage(r.score.score)}
          </summary>
          <p>
            {new Date(r.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}{" "}
            · {REPLAN_REASONS[r.reason]}
          </p>
          <p className="replan-note">{r.note}</p>
          <p>
            유지 {r.keptIds.length}회 · 이번 주에서 제외 {r.removedCount}회 · 새
            약속 {r.addedCount}회
          </p>
          <p className="muted">
            이전 실행·독서 기록과 평가는 변경 당시 상태로 보존됩니다. 제외한
            항목은 이월되지 않습니다.
          </p>
          <ul className="replan-archive">
            {r.snapshot.occurrences.map((o) => (
              <li key={o.id}>
                <strong>
                  {r.snapshot.tactics.find((t) => t.id === o.tacticId)?.title}
                </strong>
                <span>
                  {o.date || "날짜 미정"}
                  {o.date
                    ? ` ${o.timePlaced === false ? "시간 미정" : o.time}`
                    : ""}{" "}
                  ·{" "}
                  {o.completed
                    ? "완료"
                    : o.date && o.date < r.effectiveDate
                      ? "실행 없이 지남"
                      : r.keptIds.includes(o.id)
                        ? "새 계획에 유지"
                        : "재정립으로 제외"}
                  {o.extra ? " · 선택 실행" : ""}
                  {o.executedAt
                    ? ` · 실제 실행 ${new Date(o.executedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`
                    : ""}
                </span>
                {o.readingRecord && (
                  <blockquote>
                    {o.readingRecord.book} · {o.readingRecord.chapter}
                    <br />
                    {o.readingRecord.thought}
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
          {r.snapshot.review && (
            <details>
              <summary>당시 주간 평가</summary>
              <p className="replan-note">
                배운 점: {r.snapshot.review.learned || "미작성"}
              </p>
              <p className="replan-note">
                다음 주: {r.snapshot.review.next || "미작성"}
              </p>
              {Object.entries(r.snapshot.review.metrics || {}).map(
                ([goalId, metric]) => (
                  <div key={goalId}>
                    <strong>
                      {r.snapshot.goals?.find((g) => g.id === goalId)?.title ||
                        "목표 지표"}
                    </strong>
                    <p className="replan-note">
                      선행지표: {metric.leading || "미작성"}
                      <br />
                      후행지표: {metric.lagging || "미작성"}
                    </p>
                  </div>
                ),
              )}
            </details>
          )}
        </details>
      ))}
    </section>
  );
}

export default function WeekReplanning({
  Modal,
  week,
  referenceGoals,
  busy,
  onClose,
  onSave,
}) {
  const eligible = week.state.occurrences.filter((o) =>
    canReplanOccurrence(o, week.today),
  );
  const locked = week.state.occurrences.length - eligible.length;
  const [keepIds, setKeepIds] = useState(() => eligible.map((o) => o.id));
  const [reason, setReason] = useState("work");
  const [note, setNote] = useState("");
  const [additions, setAdditions] = useState([]);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const goals = [
    ...new Map(
      [...(week.state.goals || []), ...referenceGoals]
        .filter((g) => g.title?.trim())
        .map((g) => [g.id, g]),
    ).values(),
  ];
  const update = (index, key, value) =>
    setAdditions((old) =>
      old.map((a, i) =>
        i === index
          ? {
              ...a,
              [key]: value,
              ...(key === "kind" && value === "daily" ? { count: 1 } : {}),
            }
          : a,
      ),
    );
  const addedCount = additions.reduce(
    (sum, a) =>
      sum +
      (a.kind === "daily"
        ? Math.round(
            (Date.parse(addDays(week.start, 6)) - Date.parse(week.today)) /
              86400000,
          ) + 1
        : a.count),
    0,
  );
  const dirty = note || additions.length || keepIds.length !== eligible.length;
  const close = () => {
    if (
      !busy &&
      (!dirty || window.confirm("저장하지 않은 재정립 내용을 버릴까요?"))
    )
      onClose();
  };
  return (
    <Modal title="주간 계획 재정립" onClose={close} className="replan-modal">
      <p>
        {week.today} 평가일부터 {addDays(week.start, 6)}까지의 약속을 다시
        정합니다. 새벽 04시가 날짜 경계입니다.
      </p>
      <p className="info-note">
        완료·지난 평가일 실행 {locked}회는 이력에 보존합니다. 새 점수는 재정립
        이후 약속으로 계산하고, 변경 당시 원안 진행률도 함께 남깁니다.
      </p>
      {error && (
        <p role="alert" className="replan-error">
          {error}
        </p>
      )}
      {preview ? (
        <>
          <h3>변경 내용 확인</h3>
          <p>{REPLAN_REASONS[reason]}</p>
          <p className="replan-note">{note}</p>
          <p>
            유지 {keepIds.length}회 · 제외 {eligible.length - keepIds.length}회
            · 새 약속 {addedCount}회
          </p>
          <p>
            변경 당시 진행률 {percentage(week.score.score)}를 보존하고, 남은{" "}
            {keepIds.length + addedCount}회로 새 계획을 시작합니다. 미래 주차
            계획은 별도로 수정해주세요.
          </p>
          {!keepIds.length && !addedCount && (
            <p>남은 약속이 없어 재정립 후 점수는 ‘계획 없음’으로 표시됩니다.</p>
          )}
          <div className="replan-buttons">
            <button
              className="button outlined"
              disabled={busy}
              onClick={() => setPreview(false)}
            >
              다시 수정
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                setError("");
                const result = await onSave({
                  reason,
                  note,
                  keepIds,
                  additions,
                  effectiveDate: week.today,
                  confirmed: true,
                });
                if (result?.error) setError(result.error);
              }}
            >
              확인하고 재정립 저장
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            setPreview(true);
          }}
        >
          <fieldset disabled={busy}>
            <label className="field">
              <span>상황 변화</span>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {Object.entries(REPLAN_REASONS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>무엇이 바뀌었나요?</span>
              <textarea
                required
                maxLength={2000}
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="달라진 조건과 새 약속을 정한 이유를 짧게 남기세요."
              />
            </label>
            <h3>남은 실행에서 유지할 약속</h3>
            <p className="muted">
              체크를 해제하면 이번 주 계획에서 제외됩니다. 남겨둔 날짜·시간은
              저장 후 일간·주간 일정에서 옮길 수 있습니다.
            </p>
            <div className="replan-buttons">
              <button
                type="button"
                className="text-button"
                onClick={() => setKeepIds(eligible.map((o) => o.id))}
              >
                모두 유지
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setKeepIds([])}
              >
                모두 제외
              </button>
            </div>
            {week.state.tactics.map((t) => {
              const items = eligible.filter((o) => o.tacticId === t.id);
              return items.length ? (
                <details key={t.id} className="replan-tactic" open>
                  <summary>
                    {t.goalTitle} / {t.title} · 유지{" "}
                    {items.filter((o) => keepIds.includes(o.id)).length}/
                    {items.length}회
                  </summary>
                  {items.map((o, i) => (
                    <label key={o.id} className="replan-option">
                      <input
                        type="checkbox"
                        checked={keepIds.includes(o.id)}
                        onChange={(e) =>
                          setKeepIds((old) =>
                            e.target.checked
                              ? [...old, o.id]
                              : old.filter((id) => id !== o.id),
                          )
                        }
                      />
                      <span>
                        {i + 1}회 · {o.date || "날짜 미정"}{" "}
                        {o.date
                          ? o.timePlaced === false
                            ? "시간 미정"
                            : o.time
                          : ""}
                        {o.extra ? " · 선택 실행(최소 약속 제외)" : ""}
                      </span>
                    </label>
                  ))}
                </details>
              ) : null;
            })}
            {!eligible.length && (
              <p>
                유지·제외할 미완료 실행이 없습니다. 새 약속을 추가할 수
                있습니다.
              </p>
            )}
            <h3>이번 주에만 새 약속 추가</h3>
            {additions.map((a, index) => (
              <div className="replan-addition" key={index}>
                <label className="field">
                  <span>연결할 목표</span>
                  <select
                    aria-label={`새 약속 ${index + 1} 목표`}
                    value={a.goalId}
                    onChange={(e) => update(index, "goalId", e.target.value)}
                  >
                    {goals.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>할 행동</span>
                  <input
                    aria-label={`새 약속 ${index + 1} 행동`}
                    required
                    maxLength={300}
                    value={a.title}
                    onChange={(e) => update(index, "title", e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>1회 완료 기준</span>
                  <textarea
                    aria-label={`새 약속 ${index + 1} 완료 기준`}
                    required
                    maxLength={2000}
                    value={a.condition}
                    onChange={(e) => update(index, "condition", e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>반복</span>
                  <select
                    aria-label={`새 약속 ${index + 1} 반복`}
                    value={a.kind}
                    onChange={(e) => update(index, "kind", e.target.value)}
                  >
                    <option value="weekly">남은 기간에 최소 횟수</option>
                    <option value="daily">오늘부터 매일 1회</option>
                  </select>
                </label>
                {a.kind === "weekly" && (
                  <label className="field">
                    <span>최소 횟수</span>
                    <input
                      aria-label={`새 약속 ${index + 1} 최소 횟수`}
                      type="number"
                      required
                      min={1}
                      max={50}
                      value={a.count}
                      onChange={(e) =>
                        update(
                          index,
                          "count",
                          e.target.value === "" ? "" : Number(e.target.value),
                        )
                      }
                    />
                  </label>
                )}
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setAdditions((old) => old.filter((_, i) => i !== index))
                  }
                >
                  이 약속 제거
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button outlined"
              disabled={!goals.length || additions.length >= 20}
              onClick={() =>
                setAdditions((old) => [
                  ...old,
                  {
                    goalId: goals[0].id,
                    title: "",
                    condition: "",
                    kind: "weekly",
                    count: 1,
                  },
                ])
              }
            >
              새 약속 추가
            </button>
            <div className="replan-buttons">
              <button className="button" type="submit">
                변경 내용 확인
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </Modal>
  );
}

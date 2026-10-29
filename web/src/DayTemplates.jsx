import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { addDays, hasScheduledTime } from "../../shared/domain.js";
import {
  calendarOffset,
  timeAtOffset,
  modelWeekFor,
} from "../../shared/planning.js";
import {
  DAY_BLOCK_KINDS,
  dayTemplateTimeline,
  templateFromDay,
  workDuration,
  instantiateDayTemplate,
  templateReplacementCandidates,
  planWithDayTemplate,
  templateConflicts,
} from "../../shared/day-templates.js";
import TemplateDayClock, {
  templateTimeLabel,
  templatePaint,
} from "./TemplateDayClock.jsx";
import "./day-templates.css";
const days = ["월", "화", "수", "목", "금", "토", "일"];
const anchorNames = {
  clock: "고정 시각",
  "work-start": "출근 기준",
  "work-end": "퇴근 기준",
};
const labelDay = (dates, index) =>
  dates?.[index] ? `${dates[index]} (${days[index]})` : `${days[index]}요일`;
const endTime = (block) =>
  timeAtOffset(calendarOffset(block.time) + block.minutes);

export function DayTemplateLibrary({
  templates,
  onChange,
  sourceBlocks,
  sourceDates = [],
  readonly = false,
}) {
  const [selected, setSelected] = useState(templates[0]?.id || ""),
    [activityId, setActivityId] = useState(null),
    [name, setName] = useState(""),
    [sourceDay, setSourceDay] = useState(-1),
    [creating, setCreating] = useState(!templates.length),
    [, setHistoryVersion] = useState(0);
  const history = useRef({ past: [], future: [] });
  const current = templates.find((t) => t.id === selected) || templates[0];
  useEffect(() => {
    setActivityId(null);
  }, [current?.id]);
  function commit(next) {
    if (readonly) return;
    history.current.past.push(structuredClone(templates));
    history.current.past = history.current.past.slice(-50);
    history.current.future = [];
    setHistoryVersion((v) => v + 1);
    onChange(next);
  }
  function restore(redo) {
    if (readonly) return;
    const from = redo ? history.current.future : history.current.past;
    const to = redo ? history.current.past : history.current.future;
    if (!from.length) return;
    to.push(structuredClone(templates));
    onChange(from.pop());
    setHistoryVersion((v) => v + 1);
  }
  const change = (patch) =>
    commit(
      templates.map((t) => (t.id === current.id ? { ...t, ...patch } : t)),
    );
  const blockChange = (id, patch) =>
    change({
      blocks: current.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    });
  function asClock(block) {
    const resolved = dayTemplateTimeline(current).find(
      (b) => b.id === block.id,
    );
    return {
      ...block,
      anchor: "clock",
      offset: undefined,
      time: timeAtOffset(((resolved.start % 1440) + 1440) % 1440),
    };
  }
  function removeBlock(id) {
    change({
      ...(current.workBlockId === id ? { workBlockId: undefined } : {}),
      blocks: current.blocks
        .filter((b) => b.id !== id)
        .map((b) => (current.workBlockId === id ? asClock(b) : b)),
    });
    setActivityId(null);
  }
  const timeline = current ? dayTemplateTimeline(current) : [];
  const activity = current?.blocks.find((b) => b.id === activityId);
  const resolved = timeline.find((b) => b.id === activityId);
  function create() {
    if (!name.trim() || templates.length >= 20) return;
    const template = templateFromDay(
      sourceDay < 0 ? [] : sourceBlocks,
      sourceDay,
      name.trim(),
    );
    commit([...templates, template]);
    setSelected(template.id);
    setName("");
    setCreating(false);
  }
  function addActivity({ start = 300, minutes = 60 } = {}) {
    if (!current || current.blocks.length >= 100 || readonly) return;
    const block = {
      id: crypto.randomUUID(),
      title: "새 활동",
      time: timeAtOffset(((start % 1440) + 1440) % 1440),
      minutes: Math.min(720, Math.max(5, minutes)),
      kind: "strategy",
    };
    change({ blocks: [...current.blocks, block] });
    setActivityId(block.id);
  }
  function adjustTime(id, timing) {
    const block = current.blocks.find((b) => b.id === id);
    if (!block) return;
    const patch = { minutes: Math.max(5, Math.min(720, timing.minutes)) };
    if (
      !block.anchor ||
      block.anchor === "clock" ||
      block.id === current.workBlockId
    )
      patch.time = timeAtOffset(((timing.start % 1440) + 1440) % 1440);
    else {
      const work = timeline.find((b) => b.id === current.workBlockId);
      patch.offset = Math.max(
        -1440,
        Math.min(
          1440,
          timing.start -
            work.start -
            (block.anchor === "work-end" ? work.minutes : 0),
        ),
      );
    }
    blockChange(id, patch);
  }
  const creation = (
    <div className="day-template-new">
      <div className="day-template-create">
        <label className="field">
          <span>새 유형 이름</span>
          <input
            aria-label="새 하루 템플릿 이름"
            maxLength={80}
            value={name}
            placeholder="예: 평일·근무 없음"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>시작할 시간표</span>
          <select
            aria-label="템플릿 원본 하루"
            value={sourceDay}
            onChange={(e) => setSourceDay(+e.target.value)}
          >
            <option value={-1}>빈 하루부터 만들기</option>
            {days.map((d, i) => (
              <option key={d} value={i}>
                {labelDay(sourceDates, i)} 복사
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button outlined"
          disabled={!name.trim() || templates.length >= 20}
          onClick={create}
        >
          하루 유형 만들기
        </button>
      </div>
      <div
        className="day-template-presets"
        role="group"
        aria-label="템플릿 이름 예시"
      >
        {[
          "평일·근무 없음",
          "평일·근무 있음",
          "주말·근무 없음",
          "주말·근무 있음",
        ].map((value) => (
          <button
            type="button"
            className="text-button"
            key={value}
            onClick={() => setName(value)}
          >
            {value}
          </button>
        ))}
      </div>
      {templates.length > 0 && (
        <button
          type="button"
          className="text-button"
          onClick={() => setCreating(false)}
        >
          추가 닫기
        </button>
      )}
    </div>
  );
  return (
    <section className="day-template-library" aria-label="하루 템플릿 보관함">
      <p className="muted">
        하루 유형을 고르고 원 위에서 시간을 그려보세요. 수정한 유형은 저장 후
        날짜별로 적용합니다.
      </p>
      <fieldset disabled={readonly}>
        <div
          className="day-template-tabs"
          role="group"
          aria-label="편집할 하루 유형"
        >
          {templates.map((t) => (
            <button
              type="button"
              key={t.id}
              className="day-template-tab"
              aria-pressed={current?.id === t.id}
              onClick={() => {
                setSelected(t.id);
                setCreating(false);
              }}
            >
              <strong>{t.name || "이름 없는 유형"}</strong>
              <small>활동 {t.blocks.length}개</small>
            </button>
          ))}
          <button
            type="button"
            className="button outlined"
            disabled={templates.length >= 20}
            onClick={() => setCreating((v) => !v)}
          >
            + 하루 유형 추가
          </button>
        </div>
        {(creating || !templates.length) && creation}
        {current ? (
          <>
            <details className="day-template-settings">
              <summary>유형 이름·기준 근무 설정</summary>
              <div className="two-col">
                <label className="field">
                  <span>유형 이름</span>
                  <input
                    aria-label="하루 템플릿 이름"
                    maxLength={80}
                    value={current.name}
                    onChange={(e) => change({ name: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>출퇴근 연결의 기준 근무</span>
                  <select
                    aria-label="기준 근무 블록"
                    value={current.workBlockId || ""}
                    onChange={(e) =>
                      change({
                        workBlockId: e.target.value || undefined,
                        blocks: current.blocks.map((b) =>
                          !e.target.value || b.id === e.target.value
                            ? asClock(b)
                            : b,
                        ),
                      })
                    }
                  >
                    <option value="">기준 근무 없음 · 모두 고정 시각</option>
                    {current.blocks
                      .filter((b) => b.kind === "fixed")
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title || "이름 없는 근무"} · {b.time}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <p className="footnote">
                근무를 기준으로 연결할 활동만 출근·퇴근 기준을 선택하세요. 다른
                약속은 고정 시각으로 유지합니다.
              </p>
              <div className="day-template-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={templates.length >= 20}
                  onClick={() => {
                    const copy = structuredClone(current),
                      id = crypto.randomUUID(),
                      ids = new Map(
                        copy.blocks.map((b) => [b.id, crypto.randomUUID()]),
                      );
                    copy.blocks = copy.blocks.map((b) => ({
                      ...b,
                      id: ids.get(b.id),
                    }));
                    copy.workBlockId = ids.get(copy.workBlockId);
                    copy.id = id;
                    copy.name = `${current.name.slice(0, 75)} 복사`;
                    commit([...templates, copy]);
                    setSelected(id);
                  }}
                >
                  템플릿 복제
                </button>
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        "이 템플릿을 보관함에서 삭제할까요? 이미 날짜에 적용한 일정은 그대로 남습니다.",
                      )
                    )
                      commit(templates.filter((t) => t.id !== current.id));
                  }}
                >
                  템플릿 삭제
                </button>
              </div>
            </details>
            <div className="day-template-workspace">
              <TemplateDayClock
                key={current.id}
                blocks={timeline.filter(
                  (b) => Number.isFinite(b.start) && b.minutes > 0,
                )}
                selectedId={activityId}
                onSelect={setActivityId}
                onCreate={addActivity}
                onTimingChange={adjustTime}
                onRemove={removeBlock}
                readonly={readonly}
                onUndo={() => restore(false)}
                onRedo={() => restore(true)}
                canUndo={history.current.past.length > 0}
                canRedo={history.current.future.length > 0}
              />
              <div className="day-template-inspector">
                {activity ? (
                  <article
                    className="template-activity-editor"
                    aria-label="선택한 활동 편집"
                  >
                    <header>
                      <h3>{activity.title || "새 활동"}</h3>
                      <span>
                        {resolved && templateTimeLabel(resolved.start)}–
                        {resolved &&
                          templateTimeLabel(resolved.start + resolved.minutes)}
                      </span>
                    </header>
                    <label className="field">
                      <span>활동</span>
                      <input
                        aria-label="선택한 활동 이름"
                        value={activity.title}
                        maxLength={6000}
                        onChange={(e) =>
                          blockChange(activity.id, { title: e.target.value })
                        }
                      />
                    </label>
                    <div className="two-col">
                      <label className="field">
                        <span>종류</span>
                        <select
                          aria-label="선택한 활동 종류"
                          value={activity.kind}
                          onChange={(e) => {
                            const kind = e.target.value;
                            change({
                              ...(activity.id === current.workBlockId &&
                              kind !== "fixed"
                                ? { workBlockId: undefined }
                                : {}),
                              blocks: current.blocks.map((b) => ({
                                ...b,
                                ...(activity.id === current.workBlockId &&
                                kind !== "fixed"
                                  ? asClock(b)
                                  : {}),
                                ...(b.id === activity.id ? { kind } : {}),
                              })),
                            });
                          }}
                        >
                          {Object.entries(DAY_BLOCK_KINDS).map(
                            ([key, title]) => (
                              <option key={key} value={key}>
                                {title}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <label className="field">
                        <span>배치 기준</span>
                        <select
                          aria-label="선택한 활동 시각 기준"
                          value={activity.anchor || "clock"}
                          disabled={
                            !current.workBlockId ||
                            current.workBlockId === activity.id
                          }
                          onChange={(e) => {
                            const anchor = e.target.value,
                              work = timeline.find(
                                (b) => b.id === current.workBlockId,
                              );
                            // Changing the relation preserves the currently visible time.
                            blockChange(
                              activity.id,
                              anchor === "clock"
                                ? {
                                    anchor,
                                    time: timeAtOffset(
                                      ((resolved.start % 1440) + 1440) % 1440,
                                    ),
                                    offset: undefined,
                                  }
                                : {
                                    anchor,
                                    offset: Math.max(
                                      -1440,
                                      Math.min(
                                        1440,
                                        resolved.start -
                                          work.start -
                                          (anchor === "work-end"
                                            ? work.minutes
                                            : 0),
                                      ),
                                    ),
                                  },
                            );
                          }}
                        >
                          {Object.entries(anchorNames).map(([key, title]) => (
                            <option key={key} value={key}>
                              {title}
                            </option>
                          ))}
                        </select>
                      </label>
                      {activity.anchor && activity.anchor !== "clock" ? (
                        <label className="field">
                          <span>기준과의 간격(분)</span>
                          <input
                            aria-label="선택한 활동 기준 간격"
                            type="number"
                            min={-1440}
                            max={1440}
                            value={activity.offset ?? 0}
                            onChange={(e) =>
                              blockChange(activity.id, {
                                offset: +e.target.value,
                              })
                            }
                          />
                        </label>
                      ) : (
                        <label className="field">
                          <span>시작 시각</span>
                          <input
                            aria-label="선택한 활동 시작 시각"
                            type="time"
                            value={activity.time}
                            onChange={(e) => {
                              if (e.target.value)
                                blockChange(activity.id, {
                                  time: e.target.value,
                                });
                            }}
                          />
                        </label>
                      )}
                      <label className="field">
                        <span>길이(분)</span>
                        <input
                          aria-label="선택한 활동 길이"
                          type="number"
                          min={5}
                          max={720}
                          value={activity.minutes}
                          onChange={(e) =>
                            blockChange(activity.id, {
                              minutes: +e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    {activity.id === current.workBlockId ? (
                      <p className="footnote">
                        기준 근무입니다. 출퇴근에 연결한 활동이 함께 움직입니다.
                      </p>
                    ) : (
                      activity.kind === "fixed" && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            change({
                              workBlockId: activity.id,
                              blocks: current.blocks.map((b) =>
                                b.id === activity.id ? asClock(b) : b,
                              ),
                            })
                          }
                        >
                          이 활동을 기준 근무로 설정
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() => removeBlock(activity.id)}
                    >
                      선택한 활동 삭제
                    </button>
                  </article>
                ) : (
                  <div className="template-activity-empty">
                    <h3>{current.name}</h3>
                    <p>원 위의 블록을 누르면 여기서 편집할 수 있어요.</p>
                    <button
                      type="button"
                      className="button outlined"
                      disabled={current.blocks.length >= 100}
                      onClick={() => addActivity()}
                    >
                      + 활동 추가
                    </button>
                  </div>
                )}
                <div className="template-agenda-heading">
                  <h3>
                    하루의 흐름 <small>{current.blocks.length}개 활동</small>
                  </h3>
                  {activity && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={current.blocks.length >= 100}
                      onClick={() => addActivity()}
                    >
                      + 활동 추가
                    </button>
                  )}
                </div>
                <div
                  className="template-agenda"
                  aria-label="하루 유형 활동 목록"
                >
                  {[...timeline]
                    .sort((a, b) => a.start - b.start)
                    .map((b) => (
                      <button
                        type="button"
                        key={b.id}
                        className="template-agenda-item"
                        aria-pressed={b.id === activityId}
                        onClick={() => setActivityId(b.id)}
                      >
                        <i style={templatePaint(b.id)} />
                        <span>
                          <strong>{b.title || "새 활동"}</strong>
                          <small>
                            {templateTimeLabel(b.start)}–
                            {templateTimeLabel(b.start + b.minutes)} ·{" "}
                            {b.minutes}분
                          </small>
                        </span>
                        <em>
                          {b.id === current.workBlockId
                            ? "기준 근무"
                            : anchorNames[b.anchor || "clock"]}
                        </em>
                      </button>
                    ))}
                </div>
              </div>
            </div>
            <p className="footnote">
              저장 전까지는 초안입니다. 템플릿 수정·삭제는 이미 날짜에 적용한
              시간표나 실행·평가 기록을 바꾸지 않습니다.
            </p>
          </>
        ) : (
          <p className="muted">
            빈 하루부터 만들거나 기존 시간표의 하루를 복사해 시작하세요. 전술
            실행과 평가 횟수는 복사하지 않습니다.
          </p>
        )}
      </fieldset>
    </section>
  );
}

export default function DayTemplateSession({
  cycle,
  week,
  Modal,
  onClose,
  onApplied,
  onLibrarySaved,
  onDirty,
}) {
  const [activeCycle, setActiveCycle] = useState(cycle),
    [templates, setTemplates] = useState(() =>
      structuredClone(cycle.plan.dayTemplates || []),
    );
  const [mode, setMode] = useState(templates.length ? "apply" : "library"),
    [templateId, setTemplateId] = useState(templates[0]?.id || ""),
    [date, setDate] = useState(
      week.today >= week.start && week.today <= addDays(week.start, 6)
        ? week.today
        : week.start,
    );
  const [workTime, setWorkTime] = useState(""),
    [workEnd, setWorkEnd] = useState(""),
    [removeKeys, setRemoveKeys] = useState([]),
    [acknowledged, setAcknowledged] = useState(false),
    [allowOverlap, setAllowOverlap] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [contexts, setContexts] = useState([]),
    [loading, setLoading] = useState(true),
    [contextError, setContextError] = useState("");
  const saved = activeCycle.plan.dayTemplates || [],
    template = saved.find((t) => t.id === templateId) || saved[0];
  const work = template?.blocks.find((b) => b.id === template.workBlockId);
  const libraryDirty = JSON.stringify(templates) !== JSON.stringify(saved);
  useEffect(() => {
    onDirty?.(libraryDirty);
    return () => onDirty?.(false);
  }, [libraryDirty, onDirty]);
  useEffect(() => {
    if (!libraryDirty) return;
    const guard = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [libraryDirty]);
  const dates = week.daily.map((d) => d.date),
    readonly = cycle.status === "complete" || date < week.today;
  const candidates = useMemo(
    () =>
      templateReplacementCandidates(
        activeCycle.plan,
        date,
        cycle.start_date,
        cycle.week_count,
        week.today,
      ),
    [activeCycle.plan, date, cycle.start_date, cycle.week_count, week.today],
  );
  useEffect(() => {
    setRemoveKeys(candidates.map((c) => c.key));
    setAcknowledged(false);
    setAllowOverlap(false);
  }, [candidates]);
  const generated = useMemo(
    () =>
      template
        ? instantiateDayTemplate(template, date, {
            startDate: cycle.start_date,
            weekCount: cycle.week_count,
            today: week.today,
            workTime: workTime || undefined,
            workMinutes: work
              ? workDuration(workTime || work.time, workEnd || endTime(work))
              : undefined,
          })
        : { blocks: [], issues: [], invalid: true },
    [
      template,
      date,
      workTime,
      workEnd,
      cycle.start_date,
      cycle.week_count,
      week.today,
    ],
  );
  const proposal = useMemo(() => {
    try {
      return {
        plan: planWithDayTemplate(
          activeCycle.plan,
          generated.blocks,
          removeKeys,
        ),
        error: "",
      };
    } catch (e) {
      return { plan: activeCycle.plan, error: e.message };
    }
  }, [activeCycle.plan, generated, removeKeys]);
  const needed = Array.from(
    new Set([
      week.number,
      ...generated.blocks.flatMap((b) => [b.week - 1, b.week, b.week + 1]),
    ]),
  )
    .filter((n) => n >= 1 && n <= cycle.week_count)
    .sort((a, b) => a - b)
    .join(",");
  useEffect(() => {
    let live = true;
    setLoading(true);
    setContextError("");
    Promise.all(
      needed
        .split(",")
        .map(Number)
        .map((n) => api(`/cycles/${cycle.id}/weeks/${n}`)),
    )
      .then((values) => {
        if (live) setContexts(values);
      })
      .catch((e) => {
        if (live) setContextError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [needed, cycle.id, activeCycle.version, week]);
  const executions = contexts.flatMap((w) =>
    w.state.occurrences.filter(hasScheduledTime).map((o) => ({
      ...o,
      title:
        w.state.tactics.find((t) => t.id === o.tacticId)?.title ||
        "배치한 전술 실행",
    })),
  );
  const conflicts = templateConflicts(
    proposal.plan,
    generated.blocks,
    executions,
    cycle.start_date,
    cycle.week_count,
  );
  const changed = generated.blocks.length > 0 || removeKeys.length > 0;
  const canApply =
    template &&
    !busy &&
    !readonly &&
    !loading &&
    !contextError &&
    !proposal.error &&
    !generated.invalid &&
    changed &&
    (!(removeKeys.length || generated.issues.length) || acknowledged) &&
    (!conflicts.length || allowOverlap);
  function close() {
    if (busy) return;
    if (
      libraryDirty &&
      !window.confirm("저장하지 않은 템플릿 변경을 버리고 닫을까요?")
    )
      return;
    onClose();
  }
  async function savePlan(plan) {
    return api(`/cycles/${activeCycle.id}`, {
      method: "PUT",
      body: {
        version: activeCycle.version,
        title: activeCycle.title,
        startDate: activeCycle.start_date,
        weekCount: activeCycle.week_count,
        plan,
      },
    });
  }
  async function saveLibrary() {
    setBusy(true);
    setMessage("");
    try {
      const fresh = await savePlan({
        ...activeCycle.plan,
        dayTemplates: templates,
        modelWeekMode: "day",
      });
      setActiveCycle(fresh);
      setTemplates(structuredClone(fresh.plan.dayTemplates || []));
      setTemplateId(fresh.plan.dayTemplates[0]?.id || "");
      setWorkTime("");
      setWorkEnd("");
      setMode("apply");
      onLibrarySaved(fresh);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!canApply) return;
    setBusy(true);
    setMessage("");
    try {
      onApplied(await savePlan(proposal.plan));
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="하루 템플릿으로 시간표 구성"
      className="day-template-modal"
      onClose={close}
    >
      <div
        role="group"
        aria-label="하루 템플릿 작업"
        className="day-template-actions"
      >
        <button
          type="button"
          className={`button ${mode === "apply" ? "" : "outlined"}`}
          aria-pressed={mode === "apply"}
          disabled={busy || libraryDirty}
          onClick={() => {
            setMode("apply");
            setMessage("");
          }}
        >
          날짜에 적용
        </button>
        <button
          type="button"
          className={`button ${mode === "library" ? "" : "outlined"}`}
          aria-pressed={mode === "library"}
          disabled={busy}
          onClick={() => {
            setMode("library");
            setMessage("");
          }}
        >
          템플릿 관리
        </button>
      </div>
      {mode === "library" ? (
        <>
          <DayTemplateLibrary
            templates={templates}
            onChange={setTemplates}
            sourceBlocks={modelWeekFor(activeCycle.plan, week.number)}
            sourceDates={dates}
            readonly={busy || cycle.status === "complete"}
          />
          <button
            type="button"
            className="button"
            disabled={busy || !libraryDirty || cycle.status === "complete"}
            onClick={saveLibrary}
          >
            템플릿 보관함 저장
          </button>
          <p className="footnote">
            템플릿 정의만 저장합니다. 날짜별 시간표는 ‘날짜에 적용’에서 따로
            검토하세요.
          </p>
        </>
      ) : (
        <>
          {!saved.length ? (
            <p>템플릿 관리에서 먼저 하루를 복사해주세요.</p>
          ) : (
            <>
              <div className="two-col">
                <label className="field">
                  <span>적용할 날짜</span>
                  <select
                    aria-label="템플릿 적용 날짜"
                    value={date}
                    disabled={busy}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setMessage("");
                    }}
                  >
                    {dates.map((value, i) => (
                      <option
                        key={value}
                        disabled={value < week.today}
                        value={value}
                      >
                        {labelDay(dates, i)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>하루 유형</span>
                  <select
                    aria-label="적용할 하루 템플릿"
                    value={template?.id || ""}
                    disabled={busy}
                    onChange={(e) => {
                      setTemplateId(e.target.value);
                      setWorkTime("");
                      setWorkEnd("");
                      setAcknowledged(false);
                      setAllowOverlap(false);
                      setMessage("");
                    }}
                  >
                    {saved.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {work && (
                <div className="two-col">
                  <label className="field">
                    <span>실제 출근 시각 · {work.title}</span>
                    <input
                      aria-label="실제 출근 시각"
                      type="time"
                      disabled={busy}
                      value={workTime || work.time}
                      onChange={(e) => {
                        setWorkTime(e.target.value);
                        setAllowOverlap(false);
                        setAcknowledged(false);
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>실제 퇴근 시각</span>
                    <input
                      aria-label="실제 퇴근 시각"
                      type="time"
                      disabled={busy}
                      value={workEnd || endTime(work)}
                      onChange={(e) => {
                        setWorkEnd(e.target.value);
                        setAllowOverlap(false);
                        setAcknowledged(false);
                      }}
                    />
                  </label>
                </div>
              )}
              <p className="footnote">
                00~03시는 선택한 평가일의 다음 날 새벽입니다. 연결된 활동만 근무
                시각을 따라 움직이고, 고정 약속은 그대로 둡니다. 다음 날짜·인접
                주로 넘어가는 활동도 아래에 표시됩니다.
              </p>
              <details open className="day-template-review">
                <summary>
                  교체할 기존 생활 블록 · {removeKeys.length}개 선택
                </summary>
                <p>
                  선택한 블록은 새 템플릿으로 교체됩니다. 확정된 근무나 별도
                  약속을 유지하려면 선택을 해제하세요. 이미 배치한 전술·완료
                  기록은 교체 대상이 아닙니다.
                </p>
                {candidates.length ? (
                  candidates.map((c) => (
                    <label key={c.key}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={removeKeys.includes(c.key)}
                        onChange={(e) => {
                          setRemoveKeys((old) =>
                            e.target.checked
                              ? [...old, c.key]
                              : old.filter((key) => key !== c.key),
                          );
                          setAcknowledged(false);
                          setAllowOverlap(false);
                        }}
                      />
                      {c.date} · {c.block.time} · {c.block.title} (
                      {c.block.minutes}분)
                    </label>
                  ))
                ) : (
                  <p>교체할 기존 생활 블록이 없습니다.</p>
                )}
              </details>
              <section
                className="day-template-review"
                aria-label="템플릿 적용 미리보기"
              >
                <h3>추가할 시간표 · {generated.blocks.length}개</h3>
                {generated.blocks.map((item) => (
                  <p key={item.block.id}>
                    {item.date} · {item.block.time}
                    {+item.block.time.slice(0, 2) < 4
                      ? " (다음 날 새벽)"
                      : ""}{" "}
                    · {item.block.title} · {item.block.minutes}분 · {item.week}
                    주차
                  </p>
                ))}
                {generated.issues.map((issue, i) => (
                  <p key={i} role="alert">
                    {issue.title}: {issue.message}
                  </p>
                ))}
                {!generated.blocks.length && !generated.issues.length && (
                  <p>
                    이 유형에는 생활 블록이 없습니다. 선택한 기존 생활 블록만
                    비웁니다.
                  </p>
                )}
              </section>
              {loading && (
                <p role="status">관련 주의 실행 일정을 확인하는 중…</p>
              )}
              {contextError && (
                <p role="alert">
                  {contextError} 창을 닫고 다시 열어 최신 일정을 확인해주세요.
                </p>
              )}
              {proposal.error && <p role="alert">{proposal.error}</p>}
              {conflicts.length > 0 && (
                <section
                  className="day-template-conflicts"
                  aria-label="템플릿 일정 겹침"
                >
                  <h3>겹치는 일정</h3>
                  {conflicts.map((c) => (
                    <p key={c.key}>
                      {c.date} · {c.title} ↔ {c.other}
                    </p>
                  ))}
                  <label>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={allowOverlap}
                      onChange={(e) => setAllowOverlap(e.target.checked)}
                    />
                    겹침을 확인했으며 함께 배치합니다.
                  </label>
                </section>
              )}
              {(removeKeys.length > 0 || generated.issues.length > 0) && (
                <label className="day-template-consent">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  교체할 블록과 추가되지 않는 항목을 확인했습니다.
                </label>
              )}
              <p className="footnote">
                기본 모범 주간과 다른 날짜는 유지합니다. 인접 주에 추가·교체되는
                연결 활동도 한 번에 저장합니다. 전술 횟수·점수·완료 기록은
                바꾸지 않습니다.
              </p>
              <button
                type="button"
                className="button"
                disabled={!canApply}
                onClick={apply}
              >
                {busy ? "적용 중…" : `${date}에 템플릿 적용`}
              </button>
            </>
          )}
        </>
      )}
      {message && (
        <p className="day-template-error" role="alert">
          {message}
        </p>
      )}
    </Modal>
  );
}

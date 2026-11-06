import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import CalendarMergePlanner from "./CalendarMergePlanner.jsx";
import { ModelWeekEditor } from "./PlanningWidgets.jsx";
import { calendarWeekState } from "../../shared/week-replanning.js";
import { addDays, hasScheduledTime } from "../../shared/domain.js";
import {
  modelWeekFor,
  timetableForWeek,
  withWeekModel,
} from "../../shared/planning.js";
import {
  parseCalendarFile,
  calendarImportConflicts,
} from "../../shared/calendar-file.js";
import "./calendar-merge.css";

const eventTime = (event) => {
  const clock = (time) =>
    new Date(time + 9 * 3600000).toISOString().slice(5, 16).replace("T", " ");
  return event.allDay
    ? `${clock(event.start).slice(0, 5)} · 종일`
    : `${clock(event.start)} ~ ${clock(event.end)}`;
};

export default function CalendarImport({
  cycle,
  week,
  Modal,
  onBusy,
  onDirty,
  onApplied,
}) {
  const [source, setSource] = useState("file");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState(null);
  const [draft, setDraft] = useState(null);
  const [message, setMessage] = useState("");
  const [filename, setFilename] = useState("");
  const [allowOverlap, setAllowOverlap] = useState(false);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  const dates = Array.from({ length: 7 }, (_, index) =>
    addDays(week.start, index),
  );
  const existing = modelWeekFor(cycle.plan, week.number);
  const changed =
    draft !== null && JSON.stringify(draft) !== JSON.stringify(existing);
  useEffect(() => {
    onDirty?.(changed);
    return () => onDirty?.(false);
  }, [changed, onDirty]);
  const updateDraft = (blocks) => {
    setDraft(blocks);
    setAllowOverlap(false);
  };
  const isNew = (event) =>
    event.blocks.length &&
    event.blocks.some((b) => !existing.some((old) => old.id === b.id));
  const chosen = (events || []).filter((event) =>
    event.blocks.some((b) => draft?.some((d) => d.id === b.id)),
  );
  const executionState = calendarWeekState(week.state);
  const conflicts = [
    ...new Set(
      calendarImportConflicts(
        draft || [],
        timetableForWeek(cycle.plan, week.number).filter((b) => b.day < 0),
        executionState.occurrences,
        dates,
      ),
    ),
  ];
  const overLimit = (draft?.length || 0) > 100;
  const readonly =
    cycle.status === "complete" || addDays(week.start, 6) < week.today;

  async function readFile(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    setMessage("");
    setAllowOverlap(false);
    if (
      files.length > 10 ||
      files.some((file) => !/\.ics$/i.test(file.name)) ||
      files.reduce((sum, file) => sum + file.size, 0) > 1024 * 1024
    ) {
      setMessage(
        "합계 1MB 이하의 .ics 파일을 최대 10개 선택해주세요. 캘린더 아카이브(.icbu)는 지원하지 않습니다.",
      );
      return;
    }
    setBusy(true);
    try {
      const results = await Promise.all(
        files.map(async (file) =>
          parseCalendarFile(await file.text(), week.start),
        ),
      );
      const incoming = results.flat();
      setEvents([
        ...new Map(
          [...(events || []), ...incoming].map((event) => [event.key, event]),
        ).values(),
      ]);
      const merged = new Map(
        (draft || existing).map((block) => [block.id, block]),
      );
      for (const event of incoming)
        for (const block of event.blocks)
          if (!merged.has(block.id)) merged.set(block.id, block);
      setDraft([...merged.values()]);
      setFilename(files.map((file) => file.name).join(", "));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function applyFile() {
    if (
      readonly ||
      busy ||
      !changed ||
      overLimit ||
      (conflicts.length && !allowOverlap)
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const changed = await api(`/cycles/${cycle.id}`, {
        method: "PUT",
        body: {
          version: cycle.version,
          title: cycle.title,
          startDate: cycle.start_date,
          weekCount: cycle.week_count,
          plan: withWeekModel(cycle.plan, week.number, draft),
        },
      });
      onApplied(changed, { merged: true, blocks: draft.length });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="calendar-import">
      <p className="muted">
        {week.number}주차 · {week.start}~{addDays(week.start, 6)} · 한국 시간
        04시 기준
      </p>
      <div
        className="calendar-import-sources"
        role="group"
        aria-label="캘린더 가져오기 방식"
      >
        <button
          type="button"
          className={`button ${source === "file" ? "" : "outlined"}`}
          aria-pressed={source === "file"}
          disabled={busy}
          onClick={() => setSource("file")}
        >
          캘린더 파일(.ics)
        </button>
        <button
          type="button"
          className={`button ${source === "icloud" ? "" : "outlined"}`}
          aria-pressed={source === "icloud"}
          disabled={busy || changed}
          title={
            changed
              ? "병합 초안을 저장하거나 창을 닫아 취소한 뒤 연결 방식을 변경하세요."
              : undefined
          }
          onClick={() => setSource("icloud")}
        >
          iCloud 연결
        </button>
      </div>
      {source === "icloud" ? (
        <CalendarMergePlanner
          cycle={cycle}
          week={week.number}
          onBusy={setBusy}
          onApplied={onApplied}
        />
      ) : (
        <>
          <p>
            맥북 캘린더 왼쪽에서 가져올 캘린더를 선택한 뒤{" "}
            <strong>파일 → 내보내기 → 내보내기</strong>로 .ics 파일을
            저장하세요. ‘나의 Mac’ 일정도 가져올 수 있습니다.{" "}
            <a
              href="https://support.apple.com/guide/calendar/icl1023/mac"
              target="_blank"
              rel="noopener noreferrer"
            >
              Apple 내보내기 안내
            </a>
          </p>
          <p>
            기존 시간표와 가져온 일정을 병합 초안에 모두 올립니다. 필요 없는
            블록을 삭제하고 시간을 조정한 뒤 저장하세요. 원본 캘린더는 변경되지
            않습니다.
          </p>
          <label className="field">
            <span>캘린더 파일(.ics)</span>
            <input
              type="file"
              multiple
              aria-label="캘린더 파일(.ics)"
              accept=".ics,text/calendar"
              disabled={busy}
              onChange={readFile}
            />
          </label>
          {message && (
            <p className="calendar-merge-message" role="alert">
              {message}
            </p>
          )}
          {busy && !events && (
            <p role="status">선택한 주의 일정을 읽고 있어요…</p>
          )}
          {events && (
            <>
              <p className="muted">
                {filename} · 해당 주 일정 {events.length}개 · 초안{" "}
                {draft.length}개 블록
              </p>
              <p className="footnote">
                종일 일정도 초안에 포함하며, 자정을 넘기는 일정은 04시 경계에서
                나뉘어 보입니다. 전술·실행·평가와 다른 주차 시간표는 유지됩니다.
                같은 블록은 중복 추가하지 않습니다.
              </p>
              <div className="week-model-actions">
                <button
                  type="button"
                  className="button outlined"
                  disabled={busy || readonly}
                  onClick={() =>
                    updateDraft(
                      draft.filter(
                        (b) => !existing.some((old) => old.id === b.id),
                      ),
                    )
                  }
                >
                  기존 생활 블록 제외
                </button>
                <button
                  type="button"
                  className="button outlined"
                  disabled={busy || readonly}
                  onClick={() =>
                    updateDraft([
                      ...new Map(
                        [...existing, ...events.flatMap((e) => e.blocks)].map(
                          (b) => [b.id, b],
                        ),
                      ).values(),
                    ])
                  }
                >
                  병합 초안 다시 만들기
                </button>
              </div>
              {events.length ? (
                <div
                  className="calendar-import-events"
                  role="group"
                  aria-label="가져올 일정 선택"
                >
                  {events.map((event) => (
                    <label key={event.key} className="calendar-import-event">
                      <input
                        type="checkbox"
                        disabled={busy || readonly || !event.blocks.length}
                        checked={chosen.includes(event)}
                        onChange={(e) => {
                          const ids = new Set(event.blocks.map((b) => b.id));
                          updateDraft(
                            e.target.checked
                              ? [
                                  ...draft.filter((b) => !ids.has(b.id)),
                                  ...event.blocks,
                                ]
                              : draft.filter((b) => !ids.has(b.id)),
                          );
                        }}
                      />
                      <span>
                        <strong>{event.title}</strong>
                        <small>{eventTime(event)}</small>
                        {event.warning ? (
                          <small>{event.warning}</small>
                        ) : !isNew(event) ? (
                          <small>이미 가져온 일정</small>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p>
                  이 파일에는 선택한 주의 일정이 없습니다. 주차나 파일을
                  확인해주세요.
                </p>
              )}
              <section aria-label="병합 시간표 초안">
                <h3>병합 시간표 초안</h3>
                <p className="muted">
                  블록 선택 후 Delete/Backspace로 삭제하고 ⌘Z/Ctrl+Z로
                  되돌리세요. 더블클릭으로 수정할 수 있고 화면의 삭제 버튼도
                  사용할 수 있습니다.
                </p>
                <ModelWeekEditor
                  blocks={draft}
                  onChange={updateDraft}
                  Modal={Modal}
                  readonly={busy || readonly}
                  dates={dates}
                  wrap={false}
                  initialCreationKind="fixed"
                  executionBlocks={[
                    ...timetableForWeek(cycle.plan, week.number)
                      .filter((b) => b.day < 0)
                      .map((b) => ({
                        ...b,
                        id: `carry-${b.id}`,
                        background: true,
                        locked: true,
                      })),
                    ...executionState.occurrences
                      .filter(hasScheduledTime)
                      .map((o) => ({
                        ...o,
                        day: dates.indexOf(o.date),
                        kind: "actual",
                        locked: true,
                        title:
                          executionState.tactics.find(
                            (t) => t.id === o.tacticId,
                          )?.title || "배치한 실행",
                      })),
                  ]}
                />
              </section>
              {conflicts.length > 0 && (
                <div
                  className="calendar-merge-message"
                  role="region"
                  aria-label="가져오기 겹침 검토"
                >
                  <p>
                    병합 초안 또는 배치한 실행과 겹침: {conflicts.join(" · ")}
                  </p>
                  <label className="account-deletion-consent">
                    <input
                      type="checkbox"
                      checked={allowOverlap}
                      disabled={busy}
                      onChange={(e) => setAllowOverlap(e.target.checked)}
                    />
                    겹침을 확인했으며 기존 일정과 함께 배치합니다.
                  </label>
                </div>
              )}
              {overLimit && (
                <p role="alert">
                  시간표는 100개 블록까지 저장할 수 있어요. 가져올 일정을
                  줄여주세요.
                </p>
              )}
              <button
                type="button"
                className="button"
                disabled={
                  readonly ||
                  busy ||
                  !changed ||
                  overLimit ||
                  (conflicts.length > 0 && !allowOverlap)
                }
                onClick={applyFile}
              >
                {busy
                  ? "저장 중…"
                  : `병합한 시간표 저장 (${draft.length}개 블록)`}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

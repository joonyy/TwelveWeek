import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import CalendarMergePlanner from "./CalendarMergePlanner.jsx";
import { WeekCalendar } from "./PlanningWidgets.jsx";
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

export default function CalendarImport({ cycle, week, onBusy, onApplied }) {
  const [source, setSource] = useState("file");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState(null);
  const [selected, setSelected] = useState([]);
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
  const isNew = (event) =>
    event.blocks.length &&
    event.blocks.some((b) => !existing.some((old) => old.id === b.id));
  const chosen = (events || []).filter((event) => selected.includes(event.key));
  const newBlocks = chosen
    .flatMap((event) => event.blocks)
    .filter((block) => !existing.some((old) => old.id === block.id));
  const conflicts = [
    ...new Set(
      calendarImportConflicts(
        newBlocks,
        timetableForWeek(cycle.plan, week.number),
        week.state.occurrences,
        dates,
      ),
    ),
  ];
  const overLimit = existing.length + newBlocks.length > 100;
  const readonly =
    cycle.status === "complete" || addDays(week.start, 6) < week.today;

  async function readFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setEvents(null);
    setSelected([]);
    setMessage("");
    setAllowOverlap(false);
    setFilename(file.name);
    if (!/\.ics$/i.test(file.name) || file.size > 1024 * 1024) {
      setMessage(
        "1MB 이하의 .ics 파일을 선택해주세요. 캘린더 아카이브(.icbu)는 지원하지 않습니다.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await parseCalendarFile(await file.text(), week.start);
      setEvents(result);
      setSelected(
        result
          .filter((event) => !event.allDay && isNew(event))
          .map((event) => event.key),
      );
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
      !newBlocks.length ||
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
          plan: withWeekModel(cycle.plan, week.number, [
            ...existing,
            ...newBlocks,
          ]),
        },
      });
      onApplied(changed, { imported: chosen.length, blocks: newBlocks.length });
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
          disabled={busy}
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
          <label className="field">
            <span>캘린더 파일(.ics)</span>
            <input
              type="file"
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
                {filename} · 해당 주 일정 {events.length}개 · 선택{" "}
                {chosen.length}개
              </p>
              <p className="footnote">
                선택한 일정은 이 주의 근무·고정 일정 블록으로 추가됩니다. 기존
                시간표와 전술·실행·평가 기록은 유지됩니다. 종일 일정은 직접
                선택하세요. 같은 파일에서 이미 가져온 블록은 건너뜁니다.
              </p>
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
                        disabled={busy || !isNew(event)}
                        checked={selected.includes(event.key)}
                        onChange={(e) => {
                          setSelected((old) =>
                            e.target.checked
                              ? [...old, event.key]
                              : old.filter((key) => key !== event.key),
                          );
                          setAllowOverlap(false);
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
              <WeekCalendar
                label="가져온 일정과 이번 주 시간표 비교"
                dates={dates}
                wrap={false}
                readonly
                blocks={[
                  ...timetableForWeek(cycle.plan, week.number).map((b) => ({
                    ...b,
                    id: `existing-${b.id}-${b.day}`,
                    locked: true,
                  })),
                  ...week.state.occurrences
                    .filter(hasScheduledTime)
                    .map((o) => ({
                      ...o,
                      id: `execution-${o.id}`,
                      day: dates.indexOf(o.date),
                      title:
                        week.state.tactics.find((t) => t.id === o.tacticId)
                          ?.title || "배치한 실행",
                      kind: "actual",
                      locked: true,
                    })),
                  ...newBlocks.map((b) => ({
                    ...b,
                    id: `import-${b.id}`,
                    kind: "strategy",
                    locked: true,
                  })),
                ]}
              />
              {conflicts.length > 0 && (
                <div
                  className="calendar-merge-message"
                  role="region"
                  aria-label="가져오기 겹침 검토"
                >
                  <p>
                    기존 시간표 또는 선택한 일정과 겹침: {conflicts.join(" · ")}
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
                  !newBlocks.length ||
                  overLimit ||
                  (conflicts.length > 0 && !allowOverlap)
                }
                onClick={applyFile}
              >
                {busy
                  ? "저장 중…"
                  : `선택한 일정 ${chosen.length}개를 ${week.number}주차에 추가`}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

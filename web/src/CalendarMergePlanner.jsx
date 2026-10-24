import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { WeekCalendar } from "./PlanningWidgets.jsx";
import { addDays, occurrenceLabel } from "../../shared/domain.js";
import {
  appleCalendarBlocks,
  placementConflicts,
  linkedPlacement,
} from "../../shared/calendar-plan.js";
import "./calendar-merge.css";

const clock = (iso) =>
  new Date(+new Date(iso) + 9 * 3600000).toISOString().slice(11, 16);
const eventLabel = (e) =>
  `[${e.calendarName}] ${e.title} · ${new Date(+new Date(e.start) + 9 * 3600000).toISOString().slice(5, 10)} ${clock(e.start)}~${clock(e.end)}`;

export default function CalendarMergePlanner({
  cycle,
  week,
  onBusy,
  onApplied,
}) {
  const [config, setConfig] = useState(null),
    [calendars, setCalendars] = useState([]),
    [sources, setSources] = useState([]),
    [target, setTarget] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [context, setContext] = useState(null),
    [placements, setPlacements] = useState([]),
    [selected, setSelected] = useState(""),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const prefix = `/calendar/cycles/${cycle.id}`;
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  const initializeCalendars = (list) => {
    setCalendars(list);
    setSources(list.map((c) => c.id));
    setTarget(
      list.find((c) => !c.readOnly && c.name === "학습")?.id ||
        list.find((c) => !c.readOnly)?.id ||
        "",
    );
  };
  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const c = await api("/calendar/apple");
        if (!current) return;
        setConfig(c);
        setUsername(c.username);
        if (c.connected) {
          const list = await api("/calendar/apple/calendars");
          if (current) initializeCalendars(list);
        }
      } catch (e) {
        if (current) setMessage(e.message);
      }
    })();
    return () => {
      current = false;
    };
  }, []);
  async function work(fn) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  const selection = () => ({
    version: cycle.version,
    week,
    calendars: [...new Set([...sources, target])].filter(Boolean),
    target,
  });
  const update = (id, changes) => {
    setPreview(null);
    setPlacements((p) =>
      p.map((x) => (x.occurrenceId === id ? { ...x, ...changes } : x)),
    );
  };
  async function connect(e) {
    e.preventDefault();
    await work(async () => {
      try {
        const response = await api("/calendar/apple", {
          method: "PUT",
          body: { username, password },
        });
        setConfig({ ...config, connected: true, username: response.username });
        initializeCalendars(response.calendars);
      } finally {
        setPassword("");
      }
    });
  }
  async function load() {
    await work(async () => {
      const c = await api(`${prefix}/context`, {
        method: "POST",
        body: selection(),
      });
      setContext(c);
      setPreview(null);
      setPlacements((old) =>
        c.state.occurrences.map((o) => {
          const previous = old.find((p) => p.occurrenceId === o.id);
          if (
            previous &&
            (previous.action !== "link" ||
              c.events.some((e) => e.id === previous.linkId))
          )
            return previous;
          const link = c.events.find((e) => e.id === o.calendarLink?.eventId);
          return {
            occurrenceId: o.id,
            date: o.date,
            time: o.time,
            minutes: o.minutes,
            action: link ? "link" : "skip",
            linkId: link?.id,
            allowOverlap: false,
          };
        }),
      );
      setSelected(c.state.occurrences[0]?.id || "");
    });
  }
  const conflicts = context
    ? placementConflicts(placements, context.events)
    : {};
  const label = (id) => {
    const o = context?.state.occurrences.find((o) => o.id === id);
    const t = context?.state.tactics.find((t) => t.id === o?.tacticId);
    return `${t?.title || "실행 항목"} · ${o ? occurrenceLabel(o, context.state.occurrences) : "실행"}`;
  };
  function place(id, change) {
    const o = context.state.occurrences.find((o) => o.id === id);
    if (o.completed) {
      setMessage("완료한 실행의 배치는 바꾸지 않습니다.");
      return;
    }
    const date = addDays(context.range.date, change.day);
    if (o.requiredDate && date !== o.requiredDate) {
      setMessage("매일 전술은 해당 날짜에 배치해주세요.");
      return;
    }
    const p = placements.find((p) => p.occurrenceId === id);
    setMessage("");
    update(id, {
      date,
      time: change.time,
      ...(change.minutes ? { minutes: change.minutes } : {}),
      action: p.action === "skip" ? "create" : p.action,
    });
  }
  async function review() {
    await work(async () => {
      const p = await api(`${prefix}/preview`, {
        method: "POST",
        body: {
          ...selection(),
          weekVersion: context.weekVersion,
          fingerprint: context.fingerprint,
          placements,
        },
      });
      setPreview(p);
    });
  }
  async function apply() {
    await work(async () => {
      const result = await api(`${prefix}/previews/${preview.id}/apply`, {
        method: "POST",
        body: { confirmed: true },
      });
      if (!result.ok) {
        setMessage(
          `일부 반영 후 중단됐어요. 처리된 항목 ${result.applied.length}개. ${result.message} 기존 일정을 다시 불러와 연결 상태를 확인해주세요.`,
        );
        setPreview(null);
        setContext(null);
        return;
      }
      onApplied(result.cycle, result);
    });
  }
  const invalidated = () => {
    setContext(null);
    setPreview(null);
  };
  const conflictCount = Object.values(conflicts).filter((c) => c.length).length;
  const appleBlocks = context
    ? appleCalendarBlocks(
        context.events.map((e) => {
          const links = placements.filter(
            (p) => p.action === "link" && p.linkId === e.id,
          );
          return {
            ...e,
            title: links.length
              ? `${e.title} · 연결: ${links.map((p) => label(p.occurrenceId)).join(", ")}`
              : e.title,
          };
        }),
        context.range,
      ).map((b) => {
        const links = placements.filter(
          (p) => p.action === "link" && p.linkId === b.eventId,
        );
        return {
          ...b,
          kind: links.some((p) => conflicts[p.occurrenceId]?.length)
            ? "calendar-conflict"
            : links.length
              ? "strategy"
              : "fixed",
        };
      })
    : [];
  return (
    <div className="calendar-merge">
      <p>
        {week}주차의 실행을 실제 일정과 비교합니다. 한국 시간 · 하루 경계 04:00.
      </p>
      <p className="muted">
        iCloud에 동기화된 캘린더를 연결합니다. 불러오기와 검토만으로 기존 일정은
        바뀌지 않습니다.
      </p>
      {message && (
        <p className="calendar-merge-message" role="alert">
          {message}
        </p>
      )}
      {!config ? (
        <p>연결 상태를 확인하는 중…</p>
      ) : !config.connected ? (
        <form onSubmit={connect} className="calendar-connection">
          <label className="field">
            <span>Apple 계정 이메일</span>
            <input
              type="email"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>앱 전용 암호</span>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="xxxx-xxxx-xxxx-xxxx"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          <p>
            <a
              href="https://support.apple.com/ko-kr/102654"
              target="_blank"
              rel="noreferrer"
            >
              Apple의 앱 전용 암호 생성 안내
            </a>
          </p>
          {!config.canConnect && (
            <p>캘린더 연결을 위한 서버 설정이 필요합니다.</p>
          )}
          <button className="button" disabled={busy || !config.canConnect}>
            iCloud 캘린더 연결
          </button>
        </form>
      ) : (
        <>
          <fieldset
            disabled={busy || !!preview}
            className="calendar-source-settings"
          >
            <legend>연결된 계정 · {config.username}</legend>
            <div
              className="calendar-source-list"
              role="group"
              aria-label="비교할 캘린더"
            >
              {calendars.map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    checked={sources.includes(c.id) || target === c.id}
                    disabled={target === c.id}
                    onChange={(e) => {
                      setSources((s) =>
                        e.target.checked
                          ? [...s, c.id]
                          : s.filter((id) => id !== c.id),
                      );
                      invalidated();
                    }}
                  />
                  {c.name}
                  {c.readOnly ? " · 읽기 전용" : ""}
                </label>
              ))}
            </div>
            <label className="field">
              <span>새 일정을 넣을 캘린더</span>
              <select
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  invalidated();
                }}
              >
                <option value="">캘린더 선택</option>
                {calendars
                  .filter((c) => !c.readOnly)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="calendar-source-actions">
              <button
                type="button"
                className="button"
                disabled={!target || !calendars.length}
                onClick={load}
              >
                {busy ? "불러오는 중…" : "기존 일정 불러오기"}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  work(async () => {
                    await api("/calendar/apple", { method: "DELETE" });
                    setConfig({ ...config, connected: false });
                    setCalendars([]);
                    setContext(null);
                    setPreview(null);
                    setPlacements([]);
                  })
                }
              >
                연결 해제
              </button>
            </div>
          </fieldset>
          {context && (
            <>
              <div className="calendar-merge-overview">
                <strong>
                  기존 일정 {context.events.length}개 · 겹침 있는 실행{" "}
                  {conflictCount}개
                </strong>
                <span>
                  회색: Apple 일정 · 초록: 배치·연결 초안 · 붉은색: 검토할 겹침
                </span>
              </div>
              <fieldset
                disabled={busy || !!preview}
                className="calendar-placement-fields"
              >
                <label className="field">
                  <span>캘린더에서 배치할 실행</span>
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {context.state.occurrences.map((o) => (
                      <option key={o.id} value={o.id}>
                        {label(o.id)}
                      </option>
                    ))}
                  </select>
                  <small>
                    실행을 고른 뒤 빈 시간대를 클릭·드래그하세요. 아래
                    입력란에서도 배치할 수 있어요.
                  </small>
                </label>
                <WeekCalendar
                  label="Apple 일정과 주간 계획 비교 캘린더"
                  dates={Array.from({ length: 7 }, (_, i) =>
                    addDays(context.range.date, i),
                  )}
                  wrap={false}
                  readonly={busy || !!preview}
                  blocks={[
                    ...appleBlocks,
                    ...placements
                      .filter(
                        (p) =>
                          p.action === "create" &&
                          p.date &&
                          /^\d{2}:\d{2}$/.test(p.time) &&
                          p.minutes >= 5,
                      )
                      .map((p) => ({
                        id: p.occurrenceId,
                        day: Math.round(
                          (Date.parse(p.date) -
                            Date.parse(context.range.date)) /
                            86400000,
                        ),
                        time: p.time,
                        minutes: p.minutes,
                        title: label(p.occurrenceId),
                        kind: conflicts[p.occurrenceId]?.length
                          ? "calendar-conflict"
                          : "strategy",
                        locked: context.state.occurrences.find(
                          (o) => o.id === p.occurrenceId,
                        )?.completed,
                      })),
                  ]}
                  onCreate={(change) => {
                    if (selected) place(selected, change);
                  }}
                  onEdit={(p) => setSelected(p.id)}
                  onMove={(p, change) => place(p.id, change)}
                  onResize={(p, change) => place(p.id, change)}
                />
                <div className="calendar-placement-list">
                  {context.state.tactics.map((t) => (
                    <section
                      key={t.id}
                      className="calendar-placement-tactic"
                      aria-label={`${t.title} 시간 배치`}
                    >
                      <h3>
                        <small>{t.goalTitle}</small>
                        {t.title}
                      </h3>
                      {placements
                        .filter(
                          (p) =>
                            context.state.occurrences.find(
                              (o) => o.id === p.occurrenceId,
                            )?.tacticId === t.id,
                        )
                        .map((p) => {
                          const o = context.state.occurrences.find(
                            (o) => o.id === p.occurrenceId,
                          );
                          const conflict = conflicts[p.occurrenceId] || [];
                          return (
                            <div
                              key={p.occurrenceId}
                              className={`calendar-placement ${conflict.length ? "has-conflict" : ""}`}
                              aria-label={label(p.occurrenceId)}
                            >
                              <strong>
                                {occurrenceLabel(o, context.state.occurrences)}
                                {o.completed ? " · 완료 기록 유지" : ""}
                              </strong>
                              <div className="calendar-placement-inputs">
                                <label className="field">
                                  <span>반영 방식</span>
                                  <select
                                    value={p.action}
                                    onChange={(e) =>
                                      update(p.occurrenceId, {
                                        action: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="skip">
                                      이번 반영에서 제외
                                    </option>
                                    <option value="create">
                                      새 일정 만들기
                                    </option>
                                    <option value="link">
                                      기존 일정에 연결
                                    </option>
                                  </select>
                                </label>
                                <label className="field">
                                  <span>실행 날짜</span>
                                  <select
                                    value={p.date || ""}
                                    disabled={!!o.requiredDate || o.completed}
                                    onChange={(e) =>
                                      update(p.occurrenceId, {
                                        date: e.target.value || null,
                                      })
                                    }
                                  >
                                    <option value="">날짜 선택</option>
                                    {Array.from({ length: 7 }, (_, i) =>
                                      addDays(context.range.date, i),
                                    ).map((d) => (
                                      <option key={d} value={d}>
                                        {d}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="field">
                                  <span>시작 시각</span>
                                  <input
                                    type="time"
                                    value={p.time}
                                    disabled={o.completed}
                                    onChange={(e) =>
                                      update(p.occurrenceId, {
                                        time: e.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label className="field">
                                  <span>길이(분)</span>
                                  <input
                                    type="number"
                                    min="5"
                                    max="720"
                                    step="5"
                                    value={p.minutes}
                                    disabled={o.completed}
                                    onChange={(e) =>
                                      update(p.occurrenceId, {
                                        minutes: +e.target.value,
                                      })
                                    }
                                  />
                                </label>
                              </div>
                              {p.action === "link" && (
                                <label className="field">
                                  <span>연결할 기존 일정</span>
                                  <select
                                    value={p.linkId || ""}
                                    onChange={(e) => {
                                      const event = context.events.find(
                                        (x) => x.id === e.target.value,
                                      );
                                      const changes = {
                                        linkId: e.target.value,
                                      };
                                      if (event && !o.completed) {
                                        const linked = linkedPlacement(
                                          event,
                                          context.range,
                                          o.requiredDate,
                                          p.minutes,
                                        );
                                        if (linked)
                                          Object.assign(changes, linked);
                                        else
                                          setMessage(
                                            "해당 날짜에는 이 일정 안에 실행을 배치할 수 없어요.",
                                          );
                                      }
                                      update(p.occurrenceId, changes);
                                    }}
                                  >
                                    <option value="">연결할 일정 선택</option>
                                    {context.events.map((e) => (
                                      <option key={e.id} value={e.id}>
                                        {eventLabel(e)}
                                      </option>
                                    ))}
                                  </select>
                                  <small>
                                    기존 일정의 제목·시간을 유지하고 이 실행을
                                    연결합니다. 여러 실행을 같은 일정에 연결해도
                                    완료 체크는 각각 유지됩니다.
                                  </small>
                                </label>
                              )}
                              {conflict.length > 0 && (
                                <div className="calendar-conflict-review">
                                  <strong>겹치는 시간 확인</strong>
                                  <ul>
                                    {conflict.map((c) => (
                                      <li key={`${c.source}-${c.id}`}>
                                        {c.source === "apple"
                                          ? `Apple · ${c.title}`
                                          : `계획 · ${label(c.id)}`}
                                      </li>
                                    ))}
                                  </ul>
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={p.allowOverlap}
                                      onChange={(e) =>
                                        update(p.occurrenceId, {
                                          allowOverlap: e.target.checked,
                                        })
                                      }
                                    />
                                    겹침을 확인했고 그대로 적용
                                  </label>
                                </div>
                              )}
                              {p.action === "skip" && (
                                <small className="muted">
                                  이번 캘린더 반영에서만 제외합니다. 전술 횟수와
                                  점수 기준은 유지됩니다.
                                </small>
                              )}
                            </div>
                          );
                        })}
                    </section>
                  ))}
                </div>
              </fieldset>
              <p className="muted">
                연결은 기존 일정을 변경하지 않습니다. 새 일정은 선택한 캘린더에
                생성합니다. 이후 앱에서 시간을 옮기는 것만으로 Apple Calendar가
                자동 변경되지는 않습니다.
              </p>
              {preview ? (
                <section
                  className="calendar-final-review"
                  aria-label="캘린더 적용 검토"
                >
                  <h3>적용 전 최종 확인</h3>
                  <p>
                    새 일정 {preview.create}개 → {preview.target.name} · 기존
                    일정 연결 {preview.link}개
                  </p>
                  <ul>
                    {preview.placements
                      .filter((p) => p.action !== "skip")
                      .map((p) => (
                        <li key={p.occurrenceId}>
                          {label(p.occurrenceId)} · {p.date} {p.time} ·{" "}
                          {p.minutes}분 ·{" "}
                          {p.action === "link"
                            ? "기존 일정에 연결"
                            : "새 일정 생성"}
                          {p.allowOverlap ? " · 겹침 허용" : ""}
                        </li>
                      ))}
                  </ul>
                  <div className="calendar-source-actions">
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={apply}
                    >
                      {busy ? "적용 중…" : "검토한 내용 Apple Calendar에 적용"}
                    </button>
                    <button
                      type="button"
                      className="button light"
                      disabled={busy}
                      onClick={() => setPreview(null)}
                    >
                      배치 다시 수정
                    </button>
                  </div>
                </section>
              ) : (
                <button
                  type="button"
                  className="button"
                  disabled={
                    busy || !placements.some((p) => p.action !== "skip")
                  }
                  onClick={review}
                >
                  {busy ? "비교 중…" : "적용 전 검토"}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

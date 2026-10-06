import React, { useEffect, useRef, useState } from "react";
import { Plus, X, List, AlignLeft, Clock3, Check, Trash2 } from "lucide-react";
import {
  COMMITMENT_AREAS,
  newCommitment,
  calendarFragments,
  calendarLanes,
  timeAtOffset,
} from "../../shared/planning.js";
import "./planning.css";

const days = ["월", "화", "수", "목", "금", "토", "일"];
const kinds = { strategy: "전략", buffer: "버퍼", breakout: "브레이크아웃" };
const hourHeight = 56;
const uid = () => crypto.randomUUID();

export function ListInput({
  label,
  value,
  onChange,
  placeholder = "떠오르는 내용을 한 가지씩 적어보세요.",
}) {
  const inputs = useRef([]),
    items = value.split("\n");
  function update(next, focus) {
    onChange(next.join("\n"));
    if (focus !== undefined)
      requestAnimationFrame(() => inputs.current[focus]?.focus());
  }
  return (
    <div className="list-input" role="group" aria-label={label}>
      <ol>
        {items.map((item, i) => (
          <li key={i}>
            <span className="list-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <input
              aria-label={`${label} ${i + 1}`}
              ref={(el) => {
                inputs.current[i] = el;
              }}
              value={item}
              placeholder={placeholder}
              onChange={(e) =>
                update(items.map((s, j) => (j === i ? e.target.value : s)))
              }
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text/plain");
                if (!pasted.includes("\n")) return;
                e.preventDefault();
                const el = e.currentTarget;
                const merged =
                  item.slice(0, el.selectionStart) +
                  pasted.replaceAll("\r\n", "\n") +
                  item.slice(el.selectionEnd);
                update([
                  ...items.slice(0, i),
                  ...merged.split("\n"),
                  ...items.slice(i + 1),
                ]);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  update(
                    [...items.slice(0, i + 1), "", ...items.slice(i + 1)],
                    i + 1,
                  );
                }
                if (e.key === "Backspace" && !item && items.length > 1) {
                  e.preventDefault();
                  update(
                    items.filter((_, j) => j !== i),
                    Math.max(0, i - 1),
                  );
                }
              }}
            />
            <button
              className="icon-button"
              type="button"
              aria-label={`${label} ${i + 1} 삭제`}
              onClick={() =>
                update(
                  items.length > 1 ? items.filter((_, j) => j !== i) : [""],
                  Math.max(0, i - 1),
                )
              }
            >
              <X size={15} />
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="text-button"
        onClick={() => update([...items, ""], items.length)}
      >
        <Plus size={15} />
        항목 추가
      </button>
      <small className="list-keyboard-hint">
        Enter로 다음 항목을 이어 쓰세요.
      </small>
    </div>
  );
}
export function VisionEditor({
  label,
  value,
  mode,
  onChange,
  onMode,
  placeholder,
}) {
  return (
    <section className="vision-editor" aria-label={label}>
      <header>
        <h3>{label}</h3>
        <div
          className="format-switch"
          role="group"
          aria-label={`${label} 입력 방식`}
        >
          <button
            type="button"
            aria-pressed={mode === "list"}
            onClick={() => onMode("list")}
          >
            <List size={14} />
            목록
          </button>
          <button
            type="button"
            aria-pressed={mode === "text"}
            onClick={() => onMode("text")}
          >
            <AlignLeft size={14} />
            자유 서술
          </button>
        </div>
      </header>
      {mode === "list" ? (
        <ListInput
          label={label}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
        />
      ) : (
        <textarea
          aria-label={label}
          rows={6}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </section>
  );
}

export function WeekCalendar({
  blocks,
  onCreate,
  onEdit,
  onMove,
  dates,
  readonly = false,
  wrap = true,
  label = "모범 주간 캘린더",
}) {
  const scroll = useRef(null),
    [dragging, setDragging] = useState(null),
    selection = useRef(null),
    selectionFrame = useRef(null),
    suppressClick = useRef(false),
    [preview, setPreview] = useState(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 3 * hourHeight;
  }, []);
  useEffect(() => {
    function escape(e) {
      if (e.key === "Escape" && selection.current) {
        e.preventDefault();
        cancelSelection();
      }
    }
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancelSelection);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancelSelection);
      cancelAnimationFrame(selectionFrame.current);
    };
  }, []);
  useEffect(() => {
    if (readonly || !onCreate) cancelSelection();
  }, [readonly, onCreate]);

  function selectionRange(s) {
    const y = s.clientY - s.column.getBoundingClientRect().top;
    const end = Math.max(
      Math.max(0, s.anchor - 720),
      Math.min(
        Math.min(1440, s.anchor + 720),
        Math.round(((y / hourHeight) * 60) / 30) * 30,
      ),
    );
    return {
      day: s.day,
      start: Math.min(s.anchor, end),
      end: end === s.anchor ? s.anchor + 30 : Math.max(s.anchor, end),
    };
  }
  function cancelSelection() {
    const s = selection.current;
    selection.current = null;
    cancelAnimationFrame(selectionFrame.current);
    setPreview(null);
    if (s) {
      suppressClick.current = true;
      if (s.target.hasPointerCapture(s.pointerId))
        s.target.releasePointerCapture(s.pointerId);
    }
  }
  function scrollSelection(now) {
    const s = selection.current;
    if (!s) return;
    const elapsed = Math.min(32, now - (s.frameTime ?? now));
    s.frameTime = now;
    if (s.moved && scroll.current) {
      const viewport = scroll.current.getBoundingClientRect();
      const header = scroll.current.querySelector(".calendar-header");
      const top = Math.max(0, viewport.top + header.offsetHeight) + 36;
      const bottom = Math.min(window.innerHeight, viewport.bottom) - 36;
      const speed =
        s.clientY < top
          ? -Math.min(1, (top - s.clientY) / 36)
          : s.clientY > bottom
            ? Math.min(1, (s.clientY - bottom) / 36)
            : 0;
      if (speed) {
        scroll.current.scrollTop += speed * elapsed * 0.7;
        setPreview(selectionRange(s));
      }
    }
    selectionFrame.current = requestAnimationFrame(scrollSelection);
  }
  function startSelection(e, day) {
    // Touch keeps native scrolling and tap-to-create; mouse/pen can draw a range.
    if (readonly || !onCreate || e.button !== 0 || !e.isPrimary) return;
    const target = e.target.closest("button.calendar-slot");
    if (!target) return;
    suppressClick.current = false;
    if (e.pointerType === "touch") return;
    const column = e.currentTarget;
    selection.current = {
      day,
      column,
      target,
      pointerId: e.pointerId,
      anchor: Number(target.dataset.offset),
      startY: e.clientY,
      clientY: e.clientY,
      moved: false,
    };
    target.setPointerCapture(e.pointerId);
    selectionFrame.current = requestAnimationFrame(scrollSelection);
  }
  function moveSelection(e) {
    const s = selection.current;
    if (!s || s.pointerId !== e.pointerId) return;
    s.clientY = e.clientY;
    if (Math.abs(e.clientY - s.startY) >= 4) s.moved = true;
    if (s.moved) setPreview(selectionRange(s));
  }
  function finishSelection(e) {
    const s = selection.current;
    if (!s || s.pointerId !== e.pointerId) return;
    s.clientY = e.clientY;
    const range = selectionRange(s);
    cancelSelection();
    suppressClick.current = s.moved;
    if (s.moved)
      onCreate({
        day: range.day,
        time: timeAtOffset(range.start),
        minutes: range.end - range.start,
      });
  }
  const fragments = calendarLanes(calendarFragments(blocks, { wrap }));
  function drop(e, day) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/twelve-block") || dragging;
    if (!id || readonly || !onMove) return;
    const block = blocks.find((b) => b.id === id);
    if (!block || block.background || block.locked) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const offset = Math.min(
      1410,
      Math.max(0, Math.round(((y / hourHeight) * 60) / 30) * 30),
    );
    onMove(block, { day, time: timeAtOffset(offset) });
    setDragging(null);
  }
  return (
    <div
      className={`week-calendar ${preview ? "selecting" : ""}`}
      role="region"
      aria-label={label}
      onPointerDownCapture={() => {
        suppressClick.current = false;
      }}
      onClickCapture={(e) => {
        if (suppressClick.current && e.detail > 0) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      <div className="calendar-scroll" ref={scroll}>
        <div className="calendar-canvas">
          <div className="calendar-header">
            <div className="calendar-zone">
              KST<small>04:00 시작</small>
            </div>
            {days.map((d, i) => (
              <div key={d}>
                <strong>{d}</strong>
                {dates && (
                  <small>
                    {Number(dates[i].slice(5, 7))}.
                    {Number(dates[i].slice(8, 10))}
                  </small>
                )}
              </div>
            ))}
          </div>
          <div className="calendar-body" style={{ height: 24 * hourHeight }}>
            <div className="calendar-axis">
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} style={{ top: h * hourHeight }}>
                  {h >= 20 ? "다음 날 " : ""}
                  {timeAtOffset(h * 60)}
                </span>
              ))}
            </div>
            {days.map((d, day) => (
              <div
                key={d}
                className={`calendar-column ${day > 4 ? "weekend" : ""}`}
                data-day={day}
                onPointerDown={(e) => startSelection(e, day)}
                onPointerMove={moveSelection}
                onPointerUp={finishSelection}
                onPointerCancel={cancelSelection}
                onLostPointerCapture={() => {
                  if (selection.current) cancelSelection();
                }}
                onDragOver={(e) => {
                  if (onMove && !readonly) e.preventDefault();
                }}
                onDrop={(e) => drop(e, day)}
              >
                {Array.from({ length: 48 }, (_, i) =>
                  onCreate && !readonly ? (
                    <button
                      className="calendar-slot"
                      key={i}
                      type="button"
                      data-offset={i * 30}
                      aria-label={`${d}요일 ${timeAtOffset(i * 30)} 블록 추가`}
                      style={{
                        top: (i * hourHeight) / 2,
                        height: hourHeight / 2,
                      }}
                      onClick={() =>
                        onCreate({ day, time: timeAtOffset(i * 30) })
                      }
                    />
                  ) : (
                    <div
                      key={i}
                      className="calendar-slot passive"
                      style={{
                        top: (i * hourHeight) / 2,
                        height: hourHeight / 2,
                      }}
                    />
                  ),
                )}
                {preview?.day === day && (
                  <div
                    className="calendar-selection"
                    role="status"
                    aria-label="선택한 시간"
                    style={{
                      top: (preview.start / 60) * hourHeight,
                      height: ((preview.end - preview.start) / 60) * hourHeight,
                    }}
                  >
                    <strong>
                      {preview.start >= 1200 ? "다음 날 " : ""}
                      {timeAtOffset(preview.start)}–
                      {preview.start < 1200 && preview.end >= 1200
                        ? "다음 날 "
                        : ""}
                      {timeAtOffset(preview.end)}
                    </strong>
                    {preview.end - preview.start >= 60 && (
                      <small>
                        {preview.end - preview.start}분 · 놓아서 만들기
                      </small>
                    )}
                  </div>
                )}
                {fragments
                  .filter((b) => b.day === day)
                  .map((b) => {
                    const style = {
                      top: (b.start / 60) * hourHeight,
                      height: Math.max(
                        18,
                        ((b.end - b.start) / 60) * hourHeight - 2,
                      ),
                      left: `calc(${(b.lane / b.lanes) * 100}% + 3px)`,
                      width: `calc(${100 / b.lanes}% - 6px)`,
                    };
                    const labelText = `${b.title || kinds[b.kind] || "실행"} · ${days[blocks.find((x) => x.id === b.id)?.day ?? b.day]}요일 ${b.time} · ${b.minutes}분`;
                    return (
                      <button
                        key={`${b.id}-${b.part}`}
                        type="button"
                        className={`calendar-event ${b.kind || "actual"} ${b.background ? "reference" : ""} ${b.completed ? "done" : ""} ${b.part ? "continuation" : ""}`}
                        style={style}
                        aria-label={labelText}
                        title={`${labelText}${b.part ? " · 전날에서 이어짐" : ""}`}
                        disabled={readonly || b.locked || b.background}
                        draggable={
                          !readonly &&
                          !b.locked &&
                          !b.background &&
                          !!onMove &&
                          b.part === 0
                        }
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/twelve-block", b.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragging(b.id);
                        }}
                        onDragEnd={() => setDragging(null)}
                        onClick={() =>
                          onEdit?.(blocks.find((x) => x.id === b.id))
                        }
                      >
                        <strong>{b.title || kinds[b.kind] || "실행"}</strong>
                        <small>
                          {b.part
                            ? "전날에서 이어짐"
                            : `${b.time} · ${b.minutes}분`}
                          {b.background ? " · 모범 주간" : ""}
                        </small>
                        {b.completed && <Check size={13} />}
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="calendar-footer">
        <span>
          <Clock3 size={13} />
          아래로 스크롤하면 다음 날 새벽까지 볼 수 있어요.
        </span>
        {onMove && !readonly && <span>블록을 끌어 옮기거나 눌러 수정</span>}
        {onCreate && !readonly && (
          <span>빈칸을 드래그해 시간 선택 · Esc 취소</span>
        )}
      </div>
    </div>
  );
}

export function ModelWeekEditor({ blocks, onChange, Modal, readonly = false }) {
  const [edit, setEdit] = useState(null),
    [message, setMessage] = useState("");
  function create({ day = 0, time = "09:00", minutes = 180 } = {}) {
    setMessage("");
    setEdit({
      id: uid(),
      day,
      time,
      minutes,
      kind: "strategy",
      title: "",
    });
  }
  function save(e) {
    e.preventDefault();
    if (!edit.time || edit.minutes < 5 || edit.minutes > 720) {
      setMessage("시작 시각과 5~720분 사이의 길이를 확인해주세요.");
      return;
    }
    onChange(
      blocks.some((b) => b.id === edit.id)
        ? blocks.map((b) => (b.id === edit.id ? edit : b))
        : [...blocks, edit],
    );
    setEdit(null);
  }
  return (
    <>
      <div className="calendar-toolbar">
        <div className="calendar-legend">
          <span className="strategy">전략 · 중요한 일에 집중</span>
          <span className="buffer">버퍼 · 작은 일 모아 처리</span>
          <span className="breakout">브레이크아웃 · 재충전</span>
        </div>
        <button
          type="button"
          className="button light"
          onClick={() => create()}
          disabled={readonly}
        >
          <Plus size={16} />
          시간 블록 추가
        </button>
      </div>
      <p className="muted">
        빈 시간대를 누른 채 위아래로 드래그해보세요. 선택한 시간이 30분 단위로
        표시되고, 놓으면 활동을 입력할 수 있어요. 한 번 클릭하거나 추가 버튼을
        누르면 기본 3시간 블록으로 시작합니다.
      </p>
      <WeekCalendar
        blocks={blocks}
        onCreate={create}
        onEdit={setEdit}
        onMove={(b, change) =>
          onChange(blocks.map((x) => (x.id === b.id ? { ...x, ...change } : x)))
        }
        readonly={readonly}
      />
      {edit && (
        <Modal title="모범 주간 시간 블록" onClose={() => setEdit(null)}>
          <form onSubmit={save}>
            <label className="field">
              <span>할 활동</span>
              <input
                aria-label="할 활동"
                value={edit.title}
                placeholder="이 시간에 하고 싶은 활동"
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              />
            </label>
            <div className="two-col">
              <label className="field">
                <span>요일</span>
                <select
                  aria-label="블록 요일"
                  value={edit.day}
                  onChange={(e) => setEdit({ ...edit, day: +e.target.value })}
                >
                  {days.map((d, i) => (
                    <option key={d} value={i}>
                      {d}요일
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>블록 종류</span>
                <select
                  aria-label="블록 종류"
                  value={edit.kind}
                  onChange={(e) => setEdit({ ...edit, kind: e.target.value })}
                >
                  {Object.entries(kinds).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>시작 시각</span>
                <input
                  aria-label="블록 시작 시각"
                  type="time"
                  required
                  value={edit.time}
                  onChange={(e) => setEdit({ ...edit, time: e.target.value })}
                />
              </label>
              <label className="field">
                <span>길이(분)</span>
                <input
                  aria-label="블록 길이(분)"
                  type="number"
                  min={5}
                  max={720}
                  required
                  value={edit.minutes}
                  onChange={(e) =>
                    setEdit({ ...edit, minutes: +e.target.value })
                  }
                />
              </label>
            </div>
            <p className="footnote">
              00:00–03:59는 선택한 요일의 다음 날 새벽입니다. 04:00를 넘기는
              블록은 다음 요일 칸까지 이어집니다.
            </p>
            {message && <p role="alert">{message}</p>}
            <div className="block-dialog-actions">
              {blocks.some((b) => b.id === edit.id) && (
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => {
                    onChange(blocks.filter((b) => b.id !== edit.id));
                    setEdit(null);
                  }}
                >
                  <Trash2 size={15} />
                  블록 삭제
                </button>
              )}
              <button className="button" type="submit">
                블록 적용
                <Check size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

const responsibilityPrinciples = [
  "다시는 피해의식에 빠지지 않겠다고 다짐하라.",
  "자신을 가엾게 여기지 말라.",
  "새로운 일에 기꺼이 도전하라.",
  "책임감 있는 사람들과 어울려라.",
];
export function ResponsibilityEditor({ value, legacy, onChange, onLegacy }) {
  return (
    <div className="responsibility-editor">
      <div className="responsibility-guides">
        {responsibilityPrinciples.map((p, i) => (
          <article key={p}>
            <span>0{i + 1}</span>
            <p>{p}</p>
          </article>
        ))}
      </div>
      <blockquote>
        주위 환경을 통제할 수 없더라도,
        <br />그 환경에 어떻게 대응할지는 결정할 수 있다.
      </blockquote>
      <div className="bracket-box">
        <h3>책임감을 갖기 위한 노력</h3>
        <p className="muted">
          개인적 삶과 비즈니스에서 더 많은 책임감을 가지려면 어떤 노력을 하면
          좋을까요?
        </p>
        <div className="two-col">
          <section>
            <h4>개인 생활에서</h4>
            <ListInput
              label="개인 생활에서의 책임 실천"
              value={value.personal}
              onChange={(v) => onChange({ ...value, personal: v })}
            />
          </section>
          <section>
            <h4>일·비즈니스에서</h4>
            <ListInput
              label="일에서의 책임 실천"
              value={value.business}
              onChange={(v) => onChange({ ...value, business: v })}
            />
          </section>
        </div>
      </div>
      {legacy && (
        <details className="legacy-note">
          <summary>기존에 적어둔 생각</summary>
          <textarea
            aria-label="기존 책임 메모"
            rows={3}
            value={legacy}
            onChange={(e) => onLegacy(e.target.value)}
          />
        </details>
      )}
      <p className="footnote">
        정리본의 네 가지 태도와 작성 질문을 바탕으로 만든 안내입니다.
      </p>
    </div>
  );
}

const polar = (radius, angle) => ({
  x: 210 + radius * Math.cos((angle * Math.PI) / 180),
  y: 210 + radius * Math.sin((angle * Math.PI) / 180),
});
function wedge(start, end) {
  const a = polar(188, start),
    b = polar(188, end),
    c = polar(48, end),
    d = polar(48, start);
  return `M ${a.x} ${a.y} A 188 188 0 0 1 ${b.x} ${b.y} L ${c.x} ${c.y} A 48 48 0 0 0 ${d.x} ${d.y} Z`;
}
const wheelLabels = [
  ["배우자·연인", "과의 관계"],
  ["가족"],
  ["공동체"],
  ["건강"],
  ["사적인", "영역"],
  ["비즈니스"],
  ["종교"],
];
export function CommitmentWheel({
  entries,
  onChange,
  readonly = false,
  weekCount = 12,
}) {
  const [selected, setSelected] = useState("건강");
  const rows = entries.filter((c) => c.area === selected);
  const extras = entries.filter((c) => !COMMITMENT_AREAS.includes(c.area));
  const update = (id, key, value) =>
    onChange(entries.map((c) => (c.id === id ? { ...c, [key]: value } : c)));
  const fields = [
    ["promise", `${weekCount}주 목표 선언`],
    ["action", "핵심 활동"],
    ["cost", "헌신 비용"],
  ];
  return (
    <div className="commitment-practice">
      <div className="commitment-top">
        <div className="commitment-instructions">
          <span className="eyebrow">SEVEN AREAS OF COMMITMENT</span>
          <h3>
            어떤 영역에 <br />
            마음을 쓰고 싶나요?
          </h3>
          <ol>
            <li>각 영역에서 진정 의미 있는 목표를 열거하세요.</li>
            <li>목표 달성에 가장 도움이 될 핵심 활동을 찾으세요.</li>
            <li>매일 실행할 때 필요한 비용과 희생을 적으세요.</li>
            <li>
              그 비용을 감수하기로 한 핵심 활동에 <b>동그라미</b>를 표시하세요.
            </li>
          </ol>
          <p className="muted">
            삶의 태도를 정하는 공통 연습입니다. 실행 목표로 삼을 약속은 ‘목표와
            {weekCount}주 계획’에서 선택하세요.
          </p>
        </div>
        <div className="wheel-wrap">
          <svg
            viewBox="0 0 420 420"
            role="group"
            aria-label="헌신의 7영역 바퀴"
          >
            {COMMITMENT_AREAS.map((area, i) => {
              const start = -90 + (i * 360) / 7,
                end = start + 360 / 7,
                p = polar(123, (start + end) / 2);
              const populated = entries.some(
                (c) =>
                  c.area === area &&
                  (["promise", "action", "cost", "choice"].some((key) =>
                    c[key].trim(),
                  ) ||
                    c.accepted),
              );
              return (
                <g
                  key={area}
                  role="button"
                  tabIndex={0}
                  aria-label={`${area} 영역 선택`}
                  aria-pressed={selected === area}
                  className={`wheel-sector ${selected === area ? "selected" : ""} ${populated ? "populated" : ""}`}
                  onClick={() => setSelected(area)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(area);
                    }
                  }}
                >
                  <path d={wedge(start, end)} />
                  <text
                    x={p.x}
                    y={p.y - (wheelLabels[i].length - 1) * 9}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {wheelLabels[i].map((line, j) => (
                      <tspan key={line} x={p.x} dy={j ? 19 : 0}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                  {populated && (
                    <circle
                      cx={polar(167, (start + end) / 2).x}
                      cy={polar(167, (start + end) / 2).y}
                      r={3}
                    />
                  )}
                </g>
              );
            })}
            <circle cx="210" cy="210" r="47" className="wheel-center" />
            <text
              x="210"
              y="207"
              textAnchor="middle"
              className="wheel-center-label"
            >
              헌신
              <tspan x="210" dy="17">
                삶의 7영역
              </tspan>
            </text>
          </svg>
          <small>영역을 눌러 약속을 펼쳐보세요.</small>
        </div>
      </div>
      <div className="commitment-sheet">
        <header>
          <div>
            <span className="eyebrow">{selected}</span>
            <h3>{selected}에서의 헌신</h3>
          </div>
          <span className="circle-legend">
            <span>○</span>비용을 감수할 핵심 활동
          </span>
        </header>
        <div className="commitment-table">
          <div className="commitment-columns" aria-hidden="true">
            <span />
            <strong>{weekCount}주 목표 선언</strong>
            <strong>핵심 활동</strong>
            <strong>헌신 비용</strong>
            <span />
          </div>
          {rows.map((c, i) => (
            <div
              className={`commitment-entry ${c.accepted ? "accepted" : ""}`}
              key={c.id}
            >
              <span className="commitment-index">{i + 1}</span>
              {fields.map(([key, label]) => (
                <label
                  className={`commitment-cell ${key === "action" ? "core-activity" : ""}`}
                  key={key}
                >
                  <span>{label}</span>
                  <textarea
                    aria-label={`${selected} ${label} ${i + 1}`}
                    rows={3}
                    value={c[key]}
                    placeholder={
                      key === "promise"
                        ? "이 영역에서 이루고 싶은 것"
                        : key === "action"
                          ? "가장 도움이 될 구체적인 행동"
                          : "필요한 시간, 노력, 포기할 것"
                    }
                    onChange={(e) => update(c.id, key, e.target.value)}
                    disabled={readonly}
                  />
                  {key === "action" && (
                    <button
                      type="button"
                      className="commitment-circle"
                      aria-label={`${selected} 핵심 활동 ${i + 1} 비용 감수`}
                      aria-pressed={!!c.accepted}
                      onClick={() => update(c.id, "accepted", !c.accepted)}
                      disabled={readonly}
                    >
                      <span>{c.accepted ? "◯" : "○"}</span>
                      {c.accepted ? "감수하기로 선택" : "비용 감수 선택"}
                    </button>
                  )}
                </label>
              ))}
              <button
                className="icon-button"
                type="button"
                aria-label={`${selected} 약속 ${i + 1} 삭제`}
                onClick={() => onChange(entries.filter((x) => x.id !== c.id))}
                disabled={readonly}
              >
                <X size={15} />
              </button>
              {c.choice && (
                <label className="commitment-choice">
                  선택의 이유
                  <input
                    aria-label={`${selected} 선택의 이유 ${i + 1}`}
                    value={c.choice}
                    onChange={(e) => update(c.id, "choice", e.target.value)}
                    disabled={readonly}
                  />
                </label>
              )}
            </div>
          ))}
        </div>
        <button
          className="text-button"
          type="button"
          onClick={() => onChange([...entries, newCommitment(selected)])}
          disabled={readonly}
        >
          <Plus size={15} />
          약속 추가
        </button>
      </div>
      {extras.length > 0 && (
        <details className="legacy-note">
          <summary>이전에 작성한 다른 영역 ({extras.length})</summary>
          {extras.map((c) => (
            <div key={c.id} className="legacy-commitment">
              <label className="field">
                영역
                <input
                  value={c.area}
                  aria-label="기존 헌신 영역"
                  onChange={(e) => update(c.id, "area", e.target.value)}
                  disabled={readonly}
                />
              </label>
              {[...fields, ["choice", "선택의 이유"]].map(([key, label]) => (
                <label className="field" key={key}>
                  {label}
                  <textarea
                    aria-label={`기존 ${label}`}
                    rows={2}
                    value={c[key]}
                    onChange={(e) => update(c.id, key, e.target.value)}
                    disabled={readonly}
                  />
                </label>
              ))}
            </div>
          ))}
        </details>
      )}
      <p className="footnote">
        삶의 7영역을 살펴보는 헌신 바퀴입니다. 원의 크기와 색은 삶의 균형이나
        성취 점수를 나타내지 않습니다.
      </p>
    </div>
  );
}

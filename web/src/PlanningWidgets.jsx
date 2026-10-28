import React, { useEffect, useRef, useState } from "react";
import {
  Plus,
  X,
  List,
  AlignLeft,
  Clock3,
  Check,
  Trash2,
  Undo2,
  Redo2,
  Pencil,
} from "lucide-react";
import {
  COMMITMENT_AREAS,
  newCommitment,
  calendarFragments,
  calendarLanes,
  timeAtOffset,
  resizeCalendarBlock,
} from "../../shared/planning.js";
import "./planning.css";
import { hasScheduledTime } from "../../shared/domain.js";

const days = ["월", "화", "수", "목", "금", "토", "일"];
function executionPromiseLabel(occurrence, occurrences) {
  const same = occurrences.filter(
    (item) =>
      item.tacticId === occurrence.tacticId &&
      !!item.extra === !!occurrence.extra,
  );
  const number = same.findIndex((item) => item.id === occurrence.id) + 1;
  if (occurrence.extra) return `추가 실행 ${number}번`;
  const date = occurrence.requiredDate
    ? `${occurrence.requiredDate.slice(5).replace("-", ".")}의 약속`
    : `이번 주 약속 ${same.length}개 중 ${number}번`;
  return date;
}
const kinds = {
  strategy: "전략",
  buffer: "버퍼",
  breakout: "브레이크아웃",
  fixed: "근무·고정 일정",
};
const kindHints = {
  execution:
    "이번 주 전술의 한 회차를 배치합니다. 완료 여부와 주간 점수에 연결됩니다.",
  strategy:
    "핵심 활동에 집중할 시간을 예약합니다. 전술 완료나 점수에는 직접 반영되지 않습니다.",
  buffer: "연락·정리처럼 사소하지만 필요한 업무를 모아 처리하는 시간입니다.",
  breakout: "성과를 내는 일에서 벗어나 재충전하고 기분을 전환하는 시간입니다.",
  fixed:
    "근무나 약속처럼 이미 정해진 시간입니다. 남은 시간에 개인 작업을 배치하세요.",
};
const hourHeight = 56;
const uid = () => crypto.randomUUID();
export const EXECUTION_DRAG_TYPE = "text/twelve-execution";

export function ListInput({
  label,
  value,
  onChange,
  placeholder = "떠오르는 내용을 한 가지씩 적어보세요.",
}) {
  const inputs = useRef([]),
    items = value.split("\n");
  function update(next, focus, edit) {
    onChange(next.join("\n"), edit);
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
                update(
                  items.map((s, j) => (j === i ? e.target.value : s)),
                  undefined,
                  { index: i, remove: 1, insert: 1 },
                )
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
                update(
                  [
                    ...items.slice(0, i),
                    ...merged.split("\n"),
                    ...items.slice(i + 1),
                  ],
                  undefined,
                  { index: i, remove: 1, insert: merged.split("\n").length },
                );
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  update(
                    [...items.slice(0, i + 1), "", ...items.slice(i + 1)],
                    i + 1,
                    { index: i + 1, remove: 0, insert: 1 },
                  );
                }
                if (e.key === "Backspace" && !item && items.length > 1) {
                  e.preventDefault();
                  update(
                    items.filter((_, j) => j !== i),
                    Math.max(0, i - 1),
                    { index: i, remove: 1, insert: 0 },
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
                  {
                    index: i,
                    remove: 1,
                    insert: items.length > 1 ? 0 : 1,
                    preserve: false,
                  },
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
        onClick={() =>
          update([...items, ""], items.length, {
            index: items.length,
            remove: 0,
            insert: 1,
          })
        }
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
  linkable = false,
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
      {linkable && mode === "text" && (
        <small className="list-keyboard-hint">
          목표와 연결할 내용을 줄바꿈으로 나눠 적어주세요.
        </small>
      )}
    </section>
  );
}

export function WeekCalendar({
  blocks,
  onCreate,
  onEdit,
  onSelect,
  selectedId,
  onMove,
  onResize,
  onPlace,
  dragItem,
  dates,
  readonly = false,
  wrap = true,
  label = "모범 주간 캘린더",
  referenceLabel = "모범 주간",
}) {
  const scroll = useRef(null),
    [dragging, setDragging] = useState(null),
    dragAnchor = useRef(null),
    selection = useRef(null),
    selectionFrame = useRef(null),
    resize = useRef(null),
    suppressClick = useRef(false),
    [preview, setPreview] = useState(null),
    [resizePreview, setResizePreview] = useState(null),
    [dropPreview, setDropPreview] = useState(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 3 * hourHeight;
  }, []);
  useEffect(() => {
    function escape(e) {
      if (e.key === "Escape" && selection.current) {
        e.preventDefault();
        cancelSelection();
      } else if (e.key === "Escape" && resize.current) {
        e.preventDefault();
        cancelResize();
      }
    }
    function cancel() {
      cancelSelection();
      cancelResize();
      dragAnchor.current = null;
      setDragging(null);
      setDropPreview(null);
    }
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
      cancelAnimationFrame(selectionFrame.current);
    };
  }, []);
  useEffect(() => {
    if (readonly || !onCreate) cancelSelection();
  }, [readonly, onCreate]);
  useEffect(() => {
    if (readonly || !onResize) cancelResize();
  }, [readonly, onResize]);
  useEffect(() => {
    if (!dragItem && !dragging) setDropPreview(null);
  }, [dragItem, dragging]);

  function resizedBlock(r) {
    const delta =
      Math.round(
        ((r.clientY -
          r.anchorY +
          r.columnTop -
          r.column.getBoundingClientRect().top) /
          hourHeight) *
          2,
      ) * 30;
    return {
      ...r.block,
      ...resizeCalendarBlock(r.block, r.edge, delta, { wrap }),
    };
  }
  function cancelResize() {
    const r = resize.current;
    resize.current = null;
    cancelAnimationFrame(selectionFrame.current);
    setResizePreview(null);
    if (r) {
      suppressClick.current = true;
      if (r.column.hasPointerCapture(r.pointerId))
        r.column.releasePointerCapture(r.pointerId);
    }
  }
  function startResize(e, block, edge) {
    if (readonly || !onResize || e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(block);
    const column = e.currentTarget.closest(".calendar-column");
    resize.current = {
      block,
      edge,
      column,
      columnTop: column.getBoundingClientRect().top,
      pointerId: e.pointerId,
      anchorY: e.clientY,
      clientY: e.clientY,
      moved: false,
    };
    column.setPointerCapture(e.pointerId);
    setResizePreview(block);
    selectionFrame.current = requestAnimationFrame(scrollSelection);
  }
  function moveResize(e) {
    const r = resize.current;
    if (!r || r.pointerId !== e.pointerId) return;
    r.clientY = e.clientY;
    if (Math.abs(r.clientY - r.anchorY) >= 4) r.moved = true;
    setResizePreview(resizedBlock(r));
  }
  function finishResize(e) {
    const r = resize.current;
    if (!r || r.pointerId !== e.pointerId) return;
    r.clientY = e.clientY;
    const next = resizedBlock(r);
    cancelResize();
    if (next.time !== r.block.time || next.minutes !== r.block.minutes)
      onResize(r.block, { time: next.time, minutes: next.minutes });
  }

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
    const s = selection.current || resize.current;
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
        const amount = speed * elapsed * 0.7;
        if (scroll.current.scrollHeight > scroll.current.clientHeight + 1)
          scroll.current.scrollTop += amount;
        else window.scrollBy(0, amount);
        if (resize.current) setResizePreview(resizedBlock(s));
        else setPreview(selectionRange(s));
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
  const visibleBlocks = blocks.map((b) =>
    resizePreview?.id === b.id ? resizePreview : b,
  );
  const fragments = calendarLanes(calendarFragments(visibleBlocks, { wrap }));
  function dropOffset(e) {
    const anchor = e.dataTransfer.types.includes(EXECUTION_DRAG_TYPE)
      ? 0
      : dragAnchor.current?.minutes || 0;
    return Math.min(
      1410,
      Math.max(
        0,
        Math.round(
          (((e.clientY - e.currentTarget.getBoundingClientRect().top) /
            hourHeight) *
            60 -
            anchor) /
            30,
        ) * 30,
      ),
    );
  }
  function dragOver(e, day) {
    if (readonly) return;
    const external = e.dataTransfer.types.includes(EXECUTION_DRAG_TYPE);
    if (
      !(external
        ? onPlace
        : onMove && e.dataTransfer.types.includes("text/twelve-block"))
    )
      return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const block = external ? dragItem : blocks.find((b) => b.id === dragging);
    const start = dropOffset(e);
    setDropPreview({
      day,
      start,
      end: Math.min(1440, start + (block?.minutes || 60)),
      title: block?.title || "실행",
    });
    if (scroll.current) {
      const viewport = scroll.current.getBoundingClientRect();
      if (e.clientY > viewport.bottom - 30) scroll.current.scrollTop += 18;
      else if (e.clientY < viewport.top + 90) scroll.current.scrollTop -= 18;
    }
  }
  function drop(e, day) {
    e.preventDefault();
    setDropPreview(null);
    const occurrenceId = e.dataTransfer.getData(EXECUTION_DRAG_TYPE);
    if (occurrenceId && onPlace && !readonly) {
      onPlace(occurrenceId, { day, time: timeAtOffset(dropOffset(e)) });
      return;
    }
    const id = e.dataTransfer.getData("text/twelve-block") || dragging;
    if (!id || readonly || !onMove) return;
    const block = blocks.find((b) => b.id === id);
    if (!block || block.background || block.locked) return;
    const offset = dropOffset(e);
    onMove(block, { day, time: timeAtOffset(offset) });
    dragAnchor.current = null;
    setDragging(null);
  }
  return (
    <div
      className={`week-calendar ${preview ? "selecting" : ""} ${resizePreview ? "resizing" : ""}`}
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
                onPointerMove={(e) =>
                  resize.current ? moveResize(e) : moveSelection(e)
                }
                onPointerUp={(e) =>
                  resize.current ? finishResize(e) : finishSelection(e)
                }
                onPointerCancel={() => {
                  cancelSelection();
                  cancelResize();
                }}
                onLostPointerCapture={() => {
                  if (selection.current) cancelSelection();
                  if (resize.current) cancelResize();
                }}
                onDragOver={(e) => dragOver(e, day)}
                onDragLeave={(e) => {
                  if (
                    !(e.relatedTarget instanceof Node) ||
                    !e.currentTarget.contains(e.relatedTarget)
                  )
                    setDropPreview(null);
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
                {dropPreview?.day === day && (
                  <div
                    className="calendar-selection calendar-drop-preview"
                    role="status"
                    style={{
                      top: (dropPreview.start / 60) * hourHeight,
                      height:
                        ((dropPreview.end - dropPreview.start) / 60) *
                        hourHeight,
                    }}
                  >
                    <strong>{dropPreview.title}</strong>
                    <small>
                      {dropPreview.start >= 1200 ? "다음 날 " : ""}
                      {timeAtOffset(dropPreview.start)} · 놓아서 배치
                    </small>
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
                    const originalDay =
                      blocks.find((x) => x.id === b.id)?.day ?? b.day;
                    const labelText = `${b.title || kinds[b.kind] || "실행"} · ${originalDay < 0 ? "전주 " : ""}${days[(originalDay + 7) % 7]}요일 ${b.time} · ${b.minutes}분`;
                    return (
                      <div
                        key={`${b.id}-${b.part}`}
                        className={`calendar-event-shell ${b.background ? "reference" : ""}`}
                        data-block-id={b.id}
                        data-part={b.part}
                        style={style}
                      >
                        <button
                          type="button"
                          className={`calendar-event ${b.kind || "actual"} ${b.background ? "reference" : ""} ${b.completed ? "done" : ""} ${b.part ? "continuation" : ""}`}
                          aria-label={labelText}
                          aria-pressed={
                            onSelect ? selectedId === b.id : undefined
                          }
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
                            if (resize.current) {
                              e.preventDefault();
                              return;
                            }
                            e.dataTransfer.setData("text/twelve-block", b.id);
                            e.dataTransfer.effectAllowed = "move";
                            onSelect?.(blocks.find((x) => x.id === b.id));
                            setDragging(b.id);
                          }}
                          onPointerDown={(e) => {
                            if (e.button === 0 && e.isPrimary) {
                              // Preserve the grabbed point, including when the
                              // block is taller than the visible scroll area.
                              dragAnchor.current = {
                                minutes:
                                  ((e.clientY -
                                    e.currentTarget.getBoundingClientRect()
                                      .top) /
                                    hourHeight) *
                                  60,
                              };
                            }
                          }}
                          onDragEnd={() => {
                            dragAnchor.current = null;
                            setDragging(null);
                            setDropPreview(null);
                          }}
                          onFocus={() =>
                            onSelect?.(blocks.find((x) => x.id === b.id))
                          }
                          onClick={(e) => {
                            const block = blocks.find((x) => x.id === b.id);
                            onSelect?.(block);
                            if (!onSelect || e.detail === 0) onEdit?.(block);
                          }}
                          onDoubleClick={() => {
                            if (onSelect)
                              onEdit?.(blocks.find((x) => x.id === b.id));
                          }}
                        >
                          <strong>{b.title || kinds[b.kind] || "실행"}</strong>
                          <small>
                            {b.part
                              ? "전날에서 이어짐"
                              : `${b.time} · ${b.minutes}분`}
                            {b.background ? ` · ${referenceLabel}` : ""}
                          </small>
                          {b.completed && <Check size={13} />}
                        </button>
                        {!readonly &&
                          !b.locked &&
                          !b.background &&
                          onResize &&
                          ["start", "end"].map((edge) => {
                            const original = blocks.find((x) => x.id === b.id);
                            const hasContinuation = fragments.some(
                              (x) => x.id === b.id && x.part === 1,
                            );
                            if (
                              (edge === "start" && b.part !== 0) ||
                              (edge === "end" &&
                                b.part === 0 &&
                                hasContinuation)
                            )
                              return null;
                            return (
                              <button
                                key={edge}
                                type="button"
                                className={`calendar-resize-handle ${edge}`}
                                aria-label={`${b.title || "실행"} ${edge === "start" ? "시작" : "종료"} 시간 조절`}
                                title="드래그로 30분씩 조절 · 방향키로 조절 · Esc 취소"
                                onPointerDown={(e) =>
                                  startResize(e, original, edge)
                                }
                                onFocus={() => onSelect?.(original)}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                onKeyDown={(e) => {
                                  if (
                                    e.key === "ArrowUp" ||
                                    e.key === "ArrowDown"
                                  ) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onResize(
                                      original,
                                      resizeCalendarBlock(
                                        original,
                                        edge,
                                        e.key === "ArrowUp" ? -30 : 30,
                                        { wrap },
                                      ),
                                    );
                                  }
                                }}
                              />
                            );
                          })}
                      </div>
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
        {onMove && !readonly && (
          <span>
            {onSelect
              ? "클릭해 선택 · 더블클릭 또는 Enter로 편집"
              : "블록을 끌어 옮기거나 눌러 수정"}
          </span>
        )}
        {onResize && !readonly && (
          <span>위·아래 손잡이로 시간 조절 · Esc 취소</span>
        )}
        {onCreate && !readonly && (
          <span>빈칸을 드래그해 시간 선택 · Esc 취소</span>
        )}
      </div>
    </div>
  );
}

export function ModelWeekEditor({
  blocks,
  onChange,
  Modal,
  readonly = false,
  wrap = true,
  initialCreationKind,
  tactics = [],
  occurrences = [],
  dates = [],
  executionBlocks = [],
  onPlaceExecution,
  onAddExecution,
  onEditExecution,
}) {
  const [edit, setEdit] = useState(null),
    [message, setMessage] = useState(""),
    [selectedId, setSelectedId] = useState(null),
    [copiedBlock, setCopiedBlock] = useState(null),
    [pasteTarget, setPasteTarget] = useState(null),
    [creationKind, setCreationKind] = useState(
      () =>
        initialCreationKind ||
        (onPlaceExecution && occurrences.some((o) => !o.completed)
          ? "execution"
          : "strategy"),
    ),
    [, setHistoryVersion] = useState(0);
  const editor = useRef(null);
  const history = useRef({ undo: [], redo: [], expected: blocks });
  useEffect(() => {
    // A parent reset/replacement starts a new history; never restore another week's draft.
    if (history.current.expected !== blocks) {
      history.current = { undo: [], redo: [], expected: blocks };
      setSelectedId(null);
      setHistoryVersion((v) => v + 1);
    }
  }, [blocks]);
  const selectedBlock = blocks.find((b) => b.id === selectedId);
  const selectedExecution = executionBlocks.find(
    (b) => `execution-${b.id}` === selectedId,
  );
  function commitBlocks(next, selected = selectedId) {
    if (readonly || JSON.stringify(next) === JSON.stringify(blocks)) return;
    const h = history.current;
    h.undo.push({ blocks: structuredClone(blocks), selectedId });
    h.undo = h.undo.slice(-50);
    h.redo = [];
    h.expected = next;
    setSelectedId(selected);
    setHistoryVersion((v) => v + 1);
    onChange(next);
  }
  function restore(direction) {
    if (readonly || edit) return;
    const h = history.current,
      target = h[direction].pop();
    if (!target) return;
    h[direction === "undo" ? "redo" : "undo"].push({
      blocks: structuredClone(blocks),
      selectedId,
    });
    h.expected = target.blocks;
    setSelectedId(target.selectedId);
    setMessage("");
    setHistoryVersion((v) => v + 1);
    onChange(target.blocks);
    editor.current?.focus({ preventScroll: true });
  }
  function removeBlock(id) {
    if (readonly || !blocks.some((b) => b.id === id)) return;
    commitBlocks(
      blocks.filter((b) => b.id !== id),
      null,
    );
    setMessage("블록을 삭제했어요. ⌘Z 또는 Ctrl+Z로 되돌릴 수 있어요.");
    editor.current?.focus({ preventScroll: true });
  }
  function editSelected() {
    setMessage("");
    if (selectedBlock) setEdit(selectedBlock);
    else if (selectedExecution) onEditExecution?.(selectedExecution.id);
  }
  function copySelected() {
    const source = selectedBlock || selectedExecution;
    if (!source) return false;
    setCopiedBlock({
      kind: selectedExecution ? "execution" : source.kind,
      title: source.title,
      tacticId: selectedExecution?.tacticId,
      day: source.day,
      time: source.time,
      minutes: source.minutes,
    });
    setPasteTarget(null);
    setMessage(`${source.title} 복사됨 · 붙여넣을 빈 시간을 선택하세요.`);
    return true;
  }
  async function pasteCopied() {
    if (readonly || !copiedBlock) return;
    if (!pasteTarget) {
      setMessage("먼저 붙여넣을 빈 시간을 선택하세요.");
      return;
    }
    if (copiedBlock.kind === "execution") {
      const tactic = tactics.find((t) => t.id === copiedBlock.tacticId);
      if (!tactic || !onAddExecution) {
        setMessage("복사한 전술을 이번 주에서 찾을 수 없어요.");
        return;
      }
      if (tactic.kind === "daily") {
        setMessage(
          "매일 전술은 하루 한 회차로 고정되어 복제할 수 없어요. 해당 날짜의 기존 회차를 배치하세요.",
        );
        return;
      }
      const saved = await onAddExecution(tactic, {
        ...pasteTarget,
        minutes: copiedBlock.minutes,
      });
      if (!saved) {
        setMessage("전술 실행 복사가 취소되었거나 저장되지 않았어요.");
        return;
      }
    } else {
      const id = uid();
      commitBlocks(
        [
          ...blocks,
          {
            id,
            day: pasteTarget.day,
            time: pasteTarget.time,
            minutes: copiedBlock.minutes,
            kind: copiedBlock.kind,
            title: copiedBlock.title,
          },
        ],
        id,
      );
    }
    setPasteTarget(null);
    setMessage(
      `${copiedBlock.title} 붙여넣기 완료 · 다른 빈 시간을 선택하면 다시 붙여넣을 수 있어요.`,
    );
  }
  function chooseEmptyTime(change) {
    if (!copiedBlock) return create(change);
    setPasteTarget({ day: change.day, time: change.time });
    setMessage(
      `${days[change.day]}요일 ${change.time} 선택됨 · ⌘V / Ctrl+V 또는 붙여넣기 버튼을 누르세요.`,
    );
    editor.current?.focus({ preventScroll: true });
  }
  function shortcuts(e) {
    if (
      readonly ||
      edit ||
      e.defaultPrevented ||
      e.isComposing ||
      e.target.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
      )
    )
      return;
    const command = e.metaKey || e.ctrlKey;
    if (command && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "c") {
      if (copySelected()) {
        e.preventDefault();
        e.stopPropagation();
      }
    } else if (
      command &&
      !e.altKey &&
      !e.shiftKey &&
      e.key.toLowerCase() === "v" &&
      copiedBlock
    ) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) pasteCopied();
    } else if (command && !e.altKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) restore(e.shiftKey ? "redo" : "undo");
    } else if (
      command &&
      !e.altKey &&
      !e.shiftKey &&
      e.key.toLowerCase() === "y"
    ) {
      e.preventDefault();
      if (!e.repeat) restore("redo");
    } else if (
      !command &&
      !e.altKey &&
      !e.shiftKey &&
      (e.key === "Backspace" || e.key === "Delete") &&
      (selectedBlock || selectedExecution)
    ) {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (selectedBlock) removeBlock(selectedBlock.id);
      else
        setMessage(
          "전술 실행은 주간 약속을 유지하기 위해 삭제할 수 없어요. 더블클릭해 같은 주 안에서 일정을 변경하세요.",
        );
    } else if (
      e.key === "Enter" &&
      e.target === editor.current &&
      (selectedBlock || selectedExecution)
    ) {
      e.preventDefault();
      editSelected();
    } else if (e.key === "Escape") {
      setSelectedId(null);
      setCopiedBlock(null);
      setPasteTarget(null);
      setMessage("");
    }
  }
  function create({ day = 0, time = "09:00", minutes = 180 } = {}) {
    setMessage("");
    setEdit({
      id: uid(),
      day,
      time,
      minutes,
      kind: creationKind,
      title: "",
    });
  }
  async function save(e) {
    e.preventDefault();
    if (readonly) return;
    if (!edit.time || edit.minutes < 5 || edit.minutes > 720) {
      setMessage("시작 시각과 5~720분 사이의 길이를 확인해주세요.");
      return;
    }
    if (edit.kind === "execution") {
      if (edit.occurrenceId === "extra" && onAddExecution) {
        const tactic = tactics.find((t) => t.id === edit.tacticId);
        if (tactic && (await onAddExecution(tactic, edit))) setEdit(null);
        return;
      }
      const occurrence = occurrences.find(
        (o) => o.id === edit.occurrenceId && !o.completed,
      );
      if (!occurrence) {
        setMessage("배치할 전술과 실행 약속을 선택해주세요.");
        return;
      }
      if (
        occurrence.requiredDate &&
        occurrence.requiredDate !== dates[edit.day]
      ) {
        setMessage("매일 전술은 해당 평가일에만 배치할 수 있어요.");
        return;
      }
      const saved = await onPlaceExecution(occurrence.id, {
        day: edit.day,
        time: edit.time,
        minutes: edit.minutes,
      });
      if (saved) setEdit(null);
      else
        setMessage(
          "실행을 배치하지 못했어요. 입력 내용과 연결 상태를 확인해주세요.",
        );
      return;
    }
    const { tacticId, occurrenceId, ...block } = edit;
    commitBlocks(
      blocks.some((b) => b.id === edit.id)
        ? blocks.map((b) => (b.id === edit.id ? block : b))
        : [...blocks, block],
      edit.id,
    );
    setEdit(null);
  }
  const eligible = occurrences.filter(
    (o) => o.tacticId === edit?.tacticId && !o.completed,
  );
  const selectedTactic = tactics.find((t) => t.id === edit?.tacticId);
  function selectTactic(tacticId) {
    const choices = occurrences.filter(
      (o) => o.tacticId === tacticId && !o.completed,
    );
    const first =
      choices.find((o) => !hasScheduledTime(o)) ??
      choices.find((o) => o.requiredDate === dates[edit.day]) ??
      choices[0];
    setMessage("");
    setEdit({
      ...edit,
      tacticId,
      occurrenceId: first?.id ?? "",
      day: first?.requiredDate ? dates.indexOf(first.requiredDate) : edit.day,
    });
  }
  function setDay(day) {
    setMessage("");
    const required =
      selectedTactic?.kind === "daily"
        ? eligible.find((o) => o.requiredDate === dates[day])
        : undefined;
    setEdit({
      ...edit,
      day,
      ...(selectedTactic?.kind === "daily"
        ? { occurrenceId: required?.id ?? "" }
        : {}),
    });
  }
  function changeBlock(block, change) {
    if (block.executionId)
      return onPlaceExecution?.(block.executionId, {
        day: block.day,
        time: block.time,
        minutes: block.minutes,
        ...change,
      });
    commitBlocks(
      blocks.map((b) => (b.id === block.id ? { ...b, ...change } : b)),
      block.id,
    );
  }
  return (
    <>
      <div
        ref={editor}
        className="model-calendar-editor"
        tabIndex={-1}
        onKeyDown={shortcuts}
      >
        <div className="calendar-toolbar">
          <div
            className="calendar-kind-picker"
            role="group"
            aria-label="새 시간 블록 종류"
          >
            <span>새 블록 종류</span>
            {Object.entries({
              fixed: kinds.fixed,
              strategy: kinds.strategy,
              buffer: kinds.buffer,
              breakout: kinds.breakout,
              ...(onPlaceExecution ? { execution: "전술 실행" } : {}),
            }).map(([kind, title]) => (
              <button
                key={kind}
                type="button"
                className={`calendar-kind-button ${kind}`}
                aria-label={`새 블록 종류: ${title}`}
                aria-pressed={creationKind === kind}
                title={kindHints[kind]}
                disabled={readonly}
                onClick={() => setCreationKind(kind)}
              >
                <span aria-hidden="true" />
                {title}
              </button>
            ))}
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
          만들 블록의 종류를 고른 뒤 빈 시간대를 클릭하거나 드래그하세요.
          드래그한 시간이 30분 단위로 표시되고, 놓으면 선택한 종류로 입력창이
          열립니다. 근무 변경은 기존 블록을 더블클릭해 수정하세요.
          {onPlaceExecution && (
            <>
              {" "}
              전략은 시간 확보용이고, 전술 실행은 완료·주간 점수에 연결됩니다.
            </>
          )}
        </p>
        <div
          className="calendar-selection-toolbar"
          role="group"
          aria-label="선택한 시간 블록"
        >
          <span>
            {selectedBlock?.title ||
              selectedExecution?.title ||
              "블록을 클릭해 선택하세요"}
          </span>
          <button
            type="button"
            className="text-button"
            onClick={editSelected}
            disabled={readonly || (!selectedBlock && !selectedExecution)}
          >
            <Pencil size={14} />
            상세 편집
          </button>
          <button
            type="button"
            className="text-button danger"
            onClick={() => removeBlock(selectedId)}
            disabled={readonly || !selectedBlock}
          >
            <Trash2 size={14} />
            삭제
          </button>
          <button
            type="button"
            className="text-button"
            aria-label="시간표 실행 취소"
            title="⌘Z / Ctrl+Z"
            onClick={() => restore("undo")}
            disabled={readonly || !history.current.undo.length}
          >
            <Undo2 size={14} />
            실행 취소
          </button>
          <button
            type="button"
            className="text-button"
            aria-label="시간표 다시 실행"
            title="⇧⌘Z / Ctrl+Shift+Z"
            onClick={() => restore("redo")}
            disabled={readonly || !history.current.redo.length}
          >
            <Redo2 size={14} />
            다시 실행
          </button>
        </div>
        <p className="calendar-shortcuts">
          클릭해 선택 · ⌫ / Delete로 삭제 · ⌘Z / Ctrl+Z로 실행 취소 · 더블클릭
          또는 Enter로 상세 편집 · ⌘C / Ctrl+C로 복사
        </p>
        {copiedBlock && (
          <div
            className="calendar-paste-toolbar"
            role="group"
            aria-label="복사한 시간 블록"
          >
            <span>
              {copiedBlock.title} ·{" "}
              {pasteTarget
                ? `${days[pasteTarget.day]}요일 ${pasteTarget.time}에 붙여넣기`
                : "붙여넣을 빈 시간을 선택하세요"}
            </span>
            <button
              type="button"
              className="button light"
              disabled={readonly || !pasteTarget}
              onClick={pasteCopied}
            >
              붙여넣기
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setCopiedBlock(null);
                setPasteTarget(null);
                setMessage("");
              }}
            >
              복사 해제
            </button>
          </div>
        )}
        {message && !edit && (
          <p className="calendar-edit-message" role="status">
            {message}
          </p>
        )}
        <WeekCalendar
          blocks={[
            ...blocks,
            ...executionBlocks.map((b) => ({
              ...b,
              id: `execution-${b.id}`,
              executionId: b.id,
            })),
          ]}
          wrap={wrap}
          dates={dates.length === 7 ? dates : undefined}
          onCreate={chooseEmptyTime}
          onSelect={(b) => {
            setSelectedId(b.id);
            setMessage("");
          }}
          selectedId={selectedId}
          onEdit={(b) =>
            b.executionId ? onEditExecution?.(b.executionId) : setEdit(b)
          }
          onMove={changeBlock}
          onResize={changeBlock}
          readonly={readonly}
        />
      </div>
      {edit && (
        <Modal title="모범 주간 시간 블록" onClose={() => setEdit(null)}>
          <form onSubmit={save}>
            <label className="field calendar-block-kind">
              <span>블록 종류</span>
              <select
                aria-label="블록 종류"
                value={edit.kind}
                disabled={readonly}
                onChange={(e) => {
                  setEdit({ ...edit, kind: e.target.value });
                  setMessage("");
                }}
              >
                {onPlaceExecution && !blocks.some((b) => b.id === edit.id) && (
                  <option value="execution">전술 실행</option>
                )}
                {Object.entries(kinds).map(([kind, title]) => (
                  <option key={kind} value={kind}>
                    {title}
                  </option>
                ))}
              </select>
              <small>{kindHints[edit.kind]}</small>
            </label>
            {edit.kind === "execution" && (
              <div className="execution-block-choice">
                <label className="field">
                  <span>전술 선택</span>
                  <select
                    aria-label="배치할 전술"
                    value={edit.tacticId || ""}
                    required
                    disabled={readonly}
                    onChange={(e) => selectTactic(e.target.value)}
                  >
                    <option value="">이번 주 전술을 선택하세요</option>
                    {tactics.map((t) => (
                      <option
                        key={t.id}
                        value={t.id}
                        disabled={
                          !(
                            onAddExecution &&
                            t.kind !== "daily" &&
                            occurrences.filter((o) => o.tacticId === t.id)
                              .length < 50
                          ) &&
                          !occurrences.some(
                            (o) => o.tacticId === t.id && !o.completed,
                          )
                        }
                      >
                        {t.goalTitle} / {t.title}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedTactic && (
                  <>
                    <p className="muted">
                      완료 기준: {selectedTactic.condition}
                    </p>
                    <label className="field">
                      <span>배치할 실행 약속</span>
                      <select
                        aria-label="배치할 실행 약속"
                        value={edit.occurrenceId || ""}
                        required
                        disabled={readonly}
                        onChange={(e) => {
                          if (e.target.value === "extra") {
                            setEdit({ ...edit, occurrenceId: "extra" });
                            return;
                          }
                          const o = eligible.find(
                            (x) => x.id === e.target.value,
                          );
                          setEdit({
                            ...edit,
                            occurrenceId: o?.id ?? "",
                            day: o?.requiredDate
                              ? dates.indexOf(o.requiredDate)
                              : edit.day,
                          });
                        }}
                      >
                        <option value="">
                          시간을 정할 실행 약속을 선택하세요
                        </option>
                        {eligible.map((o) => (
                          <option key={o.id} value={o.id}>
                            {executionPromiseLabel(o, occurrences)} ·{" "}
                            {hasScheduledTime(o)
                              ? `${o.date} ${o.time}${+o.time.slice(0, 2) < 4 ? "(다음 날 새벽)" : ""} 일정 이동`
                              : "아직 시간 미정"}
                          </option>
                        ))}
                        {onAddExecution &&
                          selectedTactic.kind !== "daily" &&
                          occurrences.filter(
                            (o) => o.tacticId === selectedTactic.id,
                          ).length < 50 && (
                            <option value="extra">이번 주 1회 더 추가</option>
                          )}
                      </select>
                      <small>
                        같은 전술의 이번 주 약속 중 하나에 시간을 정합니다.
                        숫자는 구분용이며 배치 순서는 자유롭습니다.
                      </small>
                    </label>
                    {edit.occurrenceId === "extra" && (
                      <p className="footnote">
                        추가 실행을 배치합니다. 최소 약속{" "}
                        {selectedTactic.plannedCount}회와 평가 기준은 그대로
                        유지됩니다.
                      </p>
                    )}
                  </>
                )}
                <p className="footnote">
                  블록 적용 시 선택한 약속의 실제 실행 일정이 바로 저장됩니다.
                  ‘일정 이동’을 고르면 기존 약속의 시간을 바꿉니다.
                </p>
              </div>
            )}
            {edit.kind !== "execution" && (
              <label className="field">
                <span>할 활동</span>
                <input
                  aria-label="할 활동"
                  value={edit.title}
                  placeholder="이 시간에 하고 싶은 활동"
                  onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                />
              </label>
            )}
            <div className="two-col">
              <label className="field">
                <span>요일</span>
                <select
                  aria-label="블록 요일"
                  value={edit.day}
                  onChange={(e) => setDay(+e.target.value)}
                >
                  {days.map((d, i) => (
                    <option key={d} value={i}>
                      {d}요일
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
                    removeBlock(edit.id);
                    setEdit(null);
                  }}
                >
                  <Trash2 size={15} />
                  블록 삭제
                </button>
              )}
              <button className="button" type="submit" disabled={readonly}>
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
              placeholder="내가 선택할 수 있는 대응이나 바꿀 행동을 적어보세요."
              value={value.personal}
              onChange={(v) => onChange({ ...value, personal: v })}
            />
          </section>
          <section>
            <h4>일·비즈니스에서</h4>
            <ListInput
              label="일에서의 책임 실천"
              placeholder="내 책임 범위 안에서 실천할 구체적인 노력을 적어보세요."
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
          <p className="commitment-selection-hint">
            {readonly
              ? "비용을 감수하기로 선택한 활동은 동그라미로 표시됩니다."
              : "활동 아래 버튼으로 선택·해제하세요. 여러 활동을 선택할 수 있어요."}
          </p>
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
                  <small>
                    {
                      {
                        promise: "이 영역에서 스스로 중요하게 여기는 약속",
                        action: "목표 달성에 가장 크게 기여할 행동",
                        cost: "그 행동에 필요한 시간·노력·포기할 것",
                      }[key]
                    }
                  </small>
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
                      <span aria-hidden="true">
                        {c.accepted ? <Check size={16} /> : "○"}
                      </span>
                      {c.accepted
                        ? "감수하기로 선택 · 해제"
                        : "이 활동의 비용 감수하기"}
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

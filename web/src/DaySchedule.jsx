import React, { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Trash2, Undo2, Redo2 } from "lucide-react";
import {
  calendarFragments,
  calendarLanes,
  timeAtOffset,
  calendarOffset,
  resizeCalendarBlock,
} from "../../shared/planning.js";
import { evaluationDate } from "../../shared/domain.js";

import "./day-schedule.css";

const colorKey = (block) =>
  block.background
    ? `model:${block.title || block.id}`
    : `tactic:${block.tacticId || block.id}`;
function blockPaint(block) {
  let hash = 0;
  for (const character of colorKey(block))
    hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
  const hue = hash % 360;
  return {
    "--block-color": `hsl(${hue} 43% 57%)`,
    "--block-border": `hsl(${hue} 40% 36%)`,
  };
}

const point = (radius, minutes) => {
  const angle = (minutes / 1440) * Math.PI * 2 - Math.PI / 2;
  return [200 + radius * Math.cos(angle), 200 + radius * Math.sin(angle)];
};
function arc(start, end, inner, outer) {
  const finish = Math.min(end, start + 1439.99);
  const a = point(outer, start),
    b = point(outer, finish),
    c = point(inner, finish),
    d = point(inner, start);
  const large = finish - start > 720 ? 1 : 0;
  return `M ${a} A ${outer} ${outer} 0 ${large} 1 ${b} L ${c} A ${inner} ${inner} 0 ${large} 0 ${d} Z`;
}
export default function DaySchedule({
  blocks,
  day,
  date,
  readonly,
  onCreate,
  onEdit,
  onEditModel,
  onMove,
  onResize,
  onRemove,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  referenceLabel = "모범 주간",
  timetableSource,
}) {
  const [now, setNow] = useState(Date.now),
    [hovered, setHovered] = useState(null),
    [range, setRange] = useState(null),
    [selectedId, setSelectedId] = useState(null),
    [moving, setMoving] = useState(null);
  const selection = useRef(null),
    suppressClick = useRef(false),
    resizeClick = useRef(false),
    region = useRef(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const interval = setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  useEffect(() => {
    cancelSelection();
    setHovered(null);
    setSelectedId(null);
  }, [date]);
  useEffect(() => {
    if (readonly) cancelSelection();
  }, [readonly]);
  useEffect(() => {
    const cancel = (e) => {
      if (e.type === "blur" || e.key === "Escape") cancelSelection();
    };
    window.addEventListener("keydown", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  const currentMinutes =
    calendarOffset(`${parts.hour}:${parts.minute}`) + Number(parts.second) / 60;
  const currentDay = evaluationDate(new Date(now)) === date;
  function cancelSelection() {
    const s = selection.current;
    selection.current = null;
    setRange(null);
    setMoving(null);
    if (s) {
      suppressClick.current = true;
      if (s.svg.hasPointerCapture(s.pointerId))
        s.svg.releasePointerCapture(s.pointerId);
    }
  }
  function pointerOffset(e, svg) {
    const box = svg.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 400 - 200,
      y = ((e.clientY - box.top) / box.height) * 400 - 200;
    return (
      (((Math.atan2(y, x) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) /
        (Math.PI * 2)) *
      1440
    );
  }
  function selectedRange(e, s) {
    const offset = pointerOffset(e, s.svg);
    let delta = offset - s.anchor;
    if (delta > 720) delta -= 1440;
    if (delta < -720) delta += 1440;
    const end = Math.max(
      0,
      Math.min(1440, s.anchor + Math.round(delta / 30) * 30),
    );
    return {
      start: Math.min(s.anchor, end),
      end:
        end === s.anchor
          ? Math.min(1440, s.anchor + 30)
          : Math.max(s.anchor, end),
    };
  }
  function startSelection(e) {
    suppressClick.current = false;
    const handle = e.target.closest(".daily-clock-resize");
    resizeClick.current = !!handle;
    const actual = e.target.closest(".daily-clock-block.actual[role='button']");
    const slot = e.target.closest(".daily-clock-slot");
    if (
      readonly ||
      (!slot && !actual && !handle) ||
      (handle && !onResize) ||
      e.button !== 0 ||
      !e.isPrimary
    )
      return;
    e.preventDefault();
    setHovered(null);
    const target = handle || actual;
    const block = target && blocks.find((b) => b.id === target.dataset.id);
    if (block) {
      setSelectedId(block.id);
      target.focus({ preventScroll: true });
    } else setSelectedId(null);
    selection.current = {
      block,
      edge: handle?.dataset.edge,
      svg: e.currentTarget,
      pointerId: e.pointerId,
      anchor: block ? pointerOffset(e, e.currentTarget) : +slot.dataset.offset,
      lastOffset: pointerOffset(e, e.currentTarget),
      delta: 0,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function moveSelection(e) {
    const s = selection.current;
    if (!s || e.pointerId !== s.pointerId) return;
    if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) >= 4)
      s.moved = true;
    if (s.moved && s.block && (s.edge ? onResize : onMove)) {
      const offset = pointerOffset(e, s.svg);
      let delta = offset - s.lastOffset;
      if (delta > 720) delta -= 1440;
      if (delta < -720) delta += 1440;
      s.delta += delta;
      s.lastOffset = offset;
      if (s.edge) {
        s.change = resizeCalendarBlock(
          s.block,
          s.edge,
          Math.round(s.delta / 30) * 30,
          { wrap: false },
        );
        setMoving({ ...s.block, ...s.change });
        return;
      }
      const start = Math.max(
        0,
        Math.min(
          7 * 1440 - 30,
          s.block.day * 1440 +
            calendarOffset(s.block.time) +
            Math.round(s.delta / 30) * 30,
        ),
      );
      s.change = {
        day: Math.floor(start / 1440),
        time: timeAtOffset(start % 1440),
      };
      setMoving({ ...s.block, ...s.change });
    } else if (s.moved && !s.block) setRange(selectedRange(e, s));
  }
  function finishSelection(e) {
    const s = selection.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const selected = selectedRange(e, s);
    cancelSelection();
    suppressClick.current = s.moved;
    if (s.block) {
      if (s.edge) {
        if (
          s.moved &&
          s.change &&
          (s.change.time !== s.block.time ||
            s.change.minutes !== s.block.minutes)
        )
          applyResize(s.block, s.change, s.edge);
      } else if (
        s.moved &&
        s.change &&
        (s.change.day !== s.block.day || s.change.time !== s.block.time)
      )
        onMove?.(s.block, s.change);
    } else if (s.moved)
      onCreate({
        time: timeAtOffset(selected.start),
        minutes: selected.end - selected.start,
      });
    else onCreate({ time: timeAtOffset(s.anchor) });
    // Pointer-up is handled here; do not also activate the underlying slot.
    suppressClick.current = true;
  }
  const fragments = calendarLanes(
    calendarFragments(
      blocks.map((b) => (moving?.id === b.id ? moving : b)),
      { wrap: false },
    ),
  ).filter((b) => b.day === day);
  const reference = fragments.filter((b) => b.background);
  const selectedBlock = blocks.find(
    (b) => b.id === selectedId && !b.background,
  );
  const hoverBlock =
    fragments.find((b) => `${b.id}-${b.part}` === hovered) ??
    fragments.find((b) => b.id === selectedId);
  const colorLegend = [
    ...new Map(fragments.map((b) => [colorKey(b), b])).values(),
  ];
  function activate(e, action) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action();
    }
  }
  async function applyResize(block, change, edge) {
    await onResize?.(block, change);
    // Saving temporarily disables the handles. Restore focus so the next
    // arrow key or Cmd/Ctrl+Z still belongs to this day's clock.
    requestAnimationFrame(() => {
      if (region.current?.dataset.date !== date) return;
      const handle = region.current.querySelector(
        `.daily-clock-resize[data-id="${block.id}"][data-edge="${edge}"]`,
      );
      (handle || region.current).focus({ preventScroll: true });
    });
  }
  async function restorePlacement(action) {
    await action?.();
    if (region.current?.dataset.date === date)
      region.current.focus({ preventScroll: true });
  }
  async function removeSelected() {
    if (!selectedBlock || readonly || selectedBlock.locked || !onRemove) return;
    const saved = await onRemove(selectedBlock);
    if (saved) {
      setSelectedId(null);
      region.current?.focus({ preventScroll: true });
    }
  }
  function shortcuts(e) {
    if (
      readonly ||
      e.defaultPrevented ||
      e.isComposing ||
      e.target.closest(
        "input,textarea,select,[contenteditable]:not([contenteditable='false'])",
      )
    )
      return;
    const command = e.metaKey || e.ctrlKey;
    if (command && !e.altKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) restorePlacement(e.shiftKey ? onRedo : onUndo);
    } else if (command && !e.altKey && e.key.toLowerCase() === "y") {
      e.preventDefault();
      if (!e.repeat) restorePlacement(onRedo);
    } else if (
      !command &&
      !e.altKey &&
      !e.shiftKey &&
      (e.key === "Backspace" || e.key === "Delete")
    ) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) removeSelected();
    } else if (e.key === "Escape") {
      cancelSelection();
      setSelectedId(null);
    }
  }
  return (
    <section
      ref={region}
      tabIndex={-1}
      onKeyDown={shortcuts}
      className="panel daily-schedule"
      aria-label="하루 원형 시간표"
      data-date={date}
    >
      <header className="section-heading">
        <div>
          <h2>오늘의 시간을 배치하세요.</h2>
          <p className="muted">
            바깥쪽은 {referenceLabel}, 안쪽은 실제 실행입니다. 빈 시간대를
            누르거나 원을 따라 드래그해 배치하세요. 실행은 클릭해 선택하고,
            더블클릭해 수정하거나 끌어서 시간을 옮길 수 있어요.{" "}
            {timetableSource}
          </p>
        </div>
        <div className="week-model-actions">
          {onEditModel && (
            <button
              className="button outlined"
              type="button"
              disabled={readonly}
              onClick={onEditModel}
            >
              이번 주 시간표 조정
            </button>
          )}
          <button
            className="button outlined"
            type="button"
            disabled={readonly}
            onClick={() => onCreate({ time: "09:00" })}
          >
            <Plus size={16} />
            이날에 실행 배치
          </button>
        </div>
      </header>
      <div className="daily-selection-tools" aria-label="일간 실행 편집">
        <span>{selectedBlock?.title || "실행 블록을 선택하세요"}</span>
        <button
          type="button"
          className="text-button"
          disabled={readonly || !selectedBlock || selectedBlock.locked}
          onClick={() => onEdit(selectedBlock)}
        >
          <Pencil size={14} /> 상세 편집
        </button>
        <button
          type="button"
          className="text-button"
          disabled={
            readonly || !selectedBlock || selectedBlock.locked || !onRemove
          }
          onClick={removeSelected}
        >
          <Trash2 size={14} /> 시간 배치 해제
        </button>
        <button
          type="button"
          className="text-button"
          disabled={readonly || !canUndo}
          aria-label="실행 배치 취소"
          onClick={() => restorePlacement(onUndo)}
        >
          <Undo2 size={14} /> 실행 취소
        </button>
        <button
          type="button"
          className="text-button"
          disabled={readonly || !canRedo}
          aria-label="실행 배치 다시 실행"
          onClick={() => restorePlacement(onRedo)}
        >
          <Redo2 size={14} /> 다시 실행
        </button>
      </div>
      <p className="daily-shortcuts">
        클릭해 선택 · ⌫ / Delete로 시간 배치 해제 · ⌘Z / Ctrl+Z로 되돌리기 ·
        더블클릭 또는 Enter로 편집 · 드래그로 30분씩 이동 · 선택한 블록의
        위·아래 화살표를 드래그해 길이 조절
      </p>
      <p className="daily-shortcuts">
        시간 블록을 지워도 평가 날짜와 실행 약속은 남습니다. 아래 실행 목록에서
        다시 배치할 수 있어요.
      </p>
      <div className="daily-schedule-content">
        <svg
          className="daily-clock"
          data-editable={!readonly}
          viewBox="0 0 400 400"
          role="group"
          aria-label={`${date} 04시부터 다음 날 04시까지 시간표`}
          onPointerDown={startSelection}
          onPointerMove={moveSelection}
          onPointerUp={finishSelection}
          onDoubleClick={(e) => {
            // Pointer capture retargets the browser's double-click to this SVG.
            // The pointer-down selection identifies the intended execution.
            if (
              !resizeClick.current &&
              !readonly &&
              selectedBlock &&
              !selectedBlock.locked
            ) {
              e.preventDefault();
              onEdit(selectedBlock);
            }
          }}
          onPointerCancel={cancelSelection}
          onLostPointerCapture={() => {
            if (selection.current) cancelSelection();
          }}
          onClickCapture={(e) => {
            if (suppressClick.current && e.detail > 0) {
              e.preventDefault();
              e.stopPropagation();
              suppressClick.current = false;
            }
          }}
        >
          <circle
            cx="200"
            cy="200"
            r="163"
            fill="none"
            stroke="#eef1e8"
            strokeWidth="22"
          />
          {Array.from({ length: 48 }, (_, i) => (
            <path
              key={i}
              d={arc(i * 30, (i + 1) * 30, 99, 146)}
              className="daily-clock-slot"
              data-offset={i * 30}
              role={readonly ? undefined : "button"}
              tabIndex={readonly ? undefined : 0}
              aria-label={`${i >= 40 ? "다음 날 " : ""}${timeAtOffset(i * 30)} 실행 배치`}
              onClick={() =>
                !readonly && onCreate({ time: timeAtOffset(i * 30) })
              }
              onKeyDown={(e) =>
                !readonly &&
                activate(e, () => onCreate({ time: timeAtOffset(i * 30) }))
              }
            />
          ))}
          {fragments.map((b) => {
            const original = blocks.find((x) => x.id === b.id);
            const editable = !readonly && !b.locked && !b.background;
            const band = 47 / b.lanes;
            const outer = b.background ? 174 : 146 - band * b.lane;
            const inner = b.background ? 152 : outer - band + 1;
            const label = `${b.title} · ${b.part ? "04:00부터" : b.time} · ${b.minutes}분`;
            return (
              <path
                key={`${b.id}-${b.part}`}
                d={arc(b.start, b.end, inner, outer)}
                className={`daily-clock-block ${b.background ? "reference" : "actual"} ${b.completed ? "done" : ""} ${b.id === selectedId ? "selected" : ""} ${moving?.id === b.id ? "moving" : ""}`}
                data-id={b.id}
                style={blockPaint(b)}
                role={editable ? "button" : "img"}
                tabIndex={editable || b.background ? 0 : undefined}
                aria-pressed={editable ? b.id === selectedId : undefined}
                aria-label={`${label}${editable ? " 일정 선택" : b.background ? ` ${referenceLabel}` : b.completed ? " 완료" : " 실제 실행"}`}
                onClick={() =>
                  b.background
                    ? (setSelectedId(null), setHovered(`${b.id}-${b.part}`))
                    : setSelectedId(editable ? b.id : null)
                }
                onMouseEnter={() => {
                  if (!selection.current) setHovered(`${b.id}-${b.part}`);
                }}
                onMouseLeave={(e) => {
                  if (document.activeElement !== e.currentTarget)
                    setHovered(null);
                }}
                onFocus={() => {
                  setHovered(`${b.id}-${b.part}`);
                  setSelectedId(editable ? b.id : null);
                }}
                onBlur={() => setHovered(null)}
                onKeyDown={(e) => {
                  if (editable && e.key === "Enter") {
                    e.preventDefault();
                    onEdit(original);
                  } else if (editable && e.key === " ") {
                    e.preventDefault();
                    setSelectedId(b.id);
                  }
                }}
              >
                <title>
                  {label}
                  {b.background ? ` · ${referenceLabel}` : " · 실제 실행"}
                </title>
              </path>
            );
          })}
          {!readonly &&
            onResize &&
            fragments
              .filter((b) => b.id === selectedId && !b.background && !b.locked)
              .flatMap((b) => {
                const original = blocks.find((item) => item.id === b.id);
                const band = 47 / b.lanes,
                  outer = 146 - band * b.lane,
                  inner = outer - band + 1;
                return ["start", "end"].flatMap((edge) => {
                  // A continuation has no start edge; only the fragment containing
                  // the actual endpoint gets an end handle.
                  if (
                    (edge === "start" && b.part !== 0) ||
                    (edge === "end" &&
                      b.part === 0 &&
                      calendarOffset(b.time) + b.minutes > 1440)
                  )
                    return [];
                  const [x, y] = point(
                    edge === "start" ? inner - 4 : outer + 4,
                    edge === "start" ? b.start : b.end,
                  );
                  return (
                    <g
                      key={`${b.id}-${b.part}-${edge}`}
                      role="button"
                      tabIndex={0}
                      className="daily-clock-resize"
                      data-id={b.id}
                      data-edge={edge}
                      style={blockPaint(b)}
                      aria-label={`${b.title} ${edge === "start" ? "시작" : "종료"} 시간 조절`}
                      onFocus={() => setHovered(`${b.id}-${b.part}`)}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onKeyDown={(e) => {
                        if (
                          [
                            "ArrowUp",
                            "ArrowDown",
                            "ArrowLeft",
                            "ArrowRight",
                          ].includes(e.key)
                        ) {
                          e.preventDefault();
                          e.stopPropagation();
                          applyResize(
                            original,
                            resizeCalendarBlock(
                              original,
                              edge,
                              e.key === "ArrowUp" || e.key === "ArrowLeft"
                                ? -30
                                : 30,
                              { wrap: false },
                            ),
                            edge,
                          );
                        } else if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                        }
                      }}
                    >
                      <title>
                        {edge === "start" ? "시작" : "종료"} 시각 드래그 ·
                        반대쪽 시각 고정 · 방향키로 30분 조절 · Esc 취소
                      </title>
                      <circle
                        cx={x}
                        cy={y}
                        r="13"
                        className="daily-clock-resize-hit"
                      />
                      <g
                        transform={`translate(${x} ${y}) rotate(${edge === "start" ? 0 : 180})`}
                        aria-hidden="true"
                        className="daily-clock-resize-arrow"
                      >
                        <path
                          d="M 0 7 V -7 M -5 -2 L 0 -7 L 5 -2"
                          className="daily-clock-resize-arrow-outline"
                        />
                        <path d="M 0 7 V -7 M -5 -2 L 0 -7 L 5 -2" />
                      </g>
                    </g>
                  );
                });
              })}
          {range && (
            <path
              d={arc(range.start, range.end, 98, 148)}
              className="daily-clock-selection-arc"
            />
          )}
          {currentDay && (
            <g className="daily-clock-now" aria-label="현재 시간 위치">
              <line
                x1={point(88, currentMinutes)[0]}
                y1={point(88, currentMinutes)[1]}
                x2={point(177, currentMinutes)[0]}
                y2={point(177, currentMinutes)[1]}
              />
              <circle
                cx={point(148, currentMinutes)[0]}
                cy={point(148, currentMinutes)[1]}
                r="4"
              />
            </g>
          )}
          {Array.from({ length: 12 }, (_, i) => {
            const [x, y] = point(187, i * 120);
            return (
              <text
                key={i}
                x={x}
                y={y}
                className="daily-clock-hour"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {timeAtOffset(i * 120).slice(0, 2)}
              </text>
            );
          })}
          <text
            x="200"
            y="181"
            textAnchor="middle"
            className="daily-clock-eyebrow"
          >
            MY DAY
          </text>
          <text
            x="200"
            y="209"
            textAnchor="middle"
            className="daily-clock-date"
          >
            {date.slice(5).replace("-", ".")}
          </text>
          <text
            x="200"
            y="234"
            textAnchor="middle"
            className="daily-clock-note"
          >
            04:00 → 다음 날 04:00
          </text>
        </svg>
        <div className="daily-clock-guide">
          <div className="daily-live-clock" aria-label="현재 한국 시간">
            <small>
              {parts.year}.{parts.month}.{parts.day} · KST
            </small>
            <time dateTime={new Date(now).toISOString()}>
              {parts.hour}:{parts.minute}
              <span>:{parts.second}</span>
            </time>
          </div>
          {range && (
            <div
              className="daily-range-label"
              role="status"
              aria-label="선택한 시간"
            >
              {range.start >= 1200 ? "다음 날 " : ""}
              {timeAtOffset(range.start)}–{timeAtOffset(range.end)} ·{" "}
              {range.end - range.start}분 · 놓아서 배치
            </div>
          )}
          {moving && selection.current?.edge && (
            <div
              className="daily-range-label"
              role="status"
              aria-label="조절 중인 실행 시간"
            >
              {moving.time}–
              {timeAtOffset(calendarOffset(moving.time) + moving.minutes)} ·{" "}
              {moving.minutes}분 · 놓아서 저장
            </div>
          )}
          <div
            className="daily-block-detail"
            style={
              hoverBlock
                ? { borderLeftColor: blockPaint(hoverBlock)["--block-border"] }
                : undefined
            }
            role={hoverBlock ? "tooltip" : undefined}
            aria-label={hoverBlock ? "일정 상세" : undefined}
          >
            {hoverBlock ? (
              <>
                <small>
                  {hoverBlock.background ? referenceLabel : "실제 실행"}
                </small>
                <h3>{hoverBlock.title}</h3>
                <p>
                  {hoverBlock.start >= 1200 ? "다음 날 " : ""}
                  {timeAtOffset(hoverBlock.start)}–
                  {hoverBlock.start < 1200 && hoverBlock.end >= 1200
                    ? "다음 날 "
                    : ""}
                  {timeAtOffset(hoverBlock.end)} ·{" "}
                  {hoverBlock.end - hoverBlock.start}분
                </p>
              </>
            ) : (
              <p>
                원 위의 블록에 마우스를 올리면 활동과 시간이 크게 표시됩니다.
              </p>
            )}
          </div>

          <div className="daily-clock-legend">
            <span className="reference">{referenceLabel}</span>
            <span className="actual">실제 실행</span>
          </div>
          <div className="daily-block-colors" aria-label="블록별 색상">
            {colorLegend.map((b) => (
              <span key={colorKey(b)} title={b.title}>
                <i style={{ background: blockPaint(b)["--block-color"] }} />
                {b.title}
              </span>
            ))}
          </div>
          <p>
            배치와 수정은 주간 일정에 바로 반영됩니다. 실행 횟수와 완료 기준은
            그대로 유지됩니다.
          </p>
          {reference.length > 0 && (
            <details>
              <summary>
                이날의 {referenceLabel} {reference.length}개
              </summary>
              <ul>
                {reference.map((b) => (
                  <li key={`${b.id}-${b.part}`}>
                    <i
                      className="daily-block-swatch"
                      style={{ background: blockPaint(b)["--block-color"] }}
                    />
                    <span>
                      {b.part ? "04:00부터" : b.time} · {b.end - b.start}분
                    </span>
                    {b.title}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <small>00~03시는 선택한 평가일의 다음 날 새벽입니다.</small>
        </div>
      </div>
    </section>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { calendarLanes, timeAtOffset } from "../../shared/planning.js";
import { clockPoint as point, clockArc as arc } from "./clock-geometry.js";

const wrap = (value) => ((value % 1440) + 1440) % 1440;
export function templateTimeLabel(start) {
  const shift = Math.floor(start / 1440);
  const prefix =
    shift < 0
      ? "전날 "
      : shift > 0
        ? "다음 날 "
        : start >= 1200
          ? "다음 날 "
          : "";
  return `${prefix}${timeAtOffset(wrap(start))}`;
}
export const templatePaint = (id) => {
  let hash = 0;
  for (const c of id) hash = (Math.imul(hash, 31) + c.codePointAt(0)) >>> 0;
  return {
    "--activity-color": `hsl(${hash % 360} 34% 70%)`,
    "--activity-border": `hsl(${hash % 360} 34% 34%)`,
  };
};

export default function TemplateDayClock({
  blocks,
  selectedId,
  onSelect,
  onCreate,
  onTimingChange,
  onRemove,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  readonly,
}) {
  const [preview, setPreview] = useState(null),
    [range, setRange] = useState(null);
  const gesture = useRef(null),
    root = useRef(null),
    suppress = useRef(false);
  useEffect(
    () => () => {
      gesture.current = null;
    },
    [],
  );
  useEffect(() => {
    if (readonly) cancel();
  }, [readonly]);
  function cancel() {
    const s = gesture.current;
    gesture.current = null;
    if (s) suppress.current = true;
    setPreview(null);
    setRange(null);
    if (s?.svg.hasPointerCapture(s.pointerId))
      s.svg.releasePointerCapture(s.pointerId);
  }
  useEffect(() => {
    const stop = (e) => {
      if (e.type === "blur" || e.key === "Escape") cancel();
    };
    window.addEventListener("blur", stop);
    window.addEventListener("keydown", stop);
    return () => {
      window.removeEventListener("blur", stop);
      window.removeEventListener("keydown", stop);
    };
  }, []);
  const display = blocks.map((b) => (preview?.id === b.id ? preview : b));
  // Fold the continuation onto the top of the clock, but mark it explicitly as
  // the following morning. Stored starts and linked offsets never get folded.
  const fragments = calendarLanes(
    display.flatMap((b) => {
      const start = wrap(b.start),
        end = start + b.minutes;
      const first = {
        ...b,
        day: 0,
        start,
        end: Math.min(end, 1440),
        continuation: false,
      };
      return end > 1440
        ? [
            first,
            { ...b, day: 0, start: 0, end: end - 1440, continuation: true },
          ]
        : [first];
    }),
  );
  function offset(e, svg) {
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 400 - 200;
    const y = ((e.clientY - rect.top) / rect.height) * 400 - 200;
    return wrap(((Math.atan2(y, x) + Math.PI / 2) / (Math.PI * 2)) * 1440);
  }
  function down(e) {
    if (readonly || e.button !== 0 || !e.isPrimary) return;
    const target = e.target.closest("[data-block-id], [data-slot]");
    if (!target) return;
    e.preventDefault();
    suppress.current = false;
    const block = blocks.find((b) => b.id === target.dataset.blockId);
    onSelect(block?.id || null);
    target.focus({ preventScroll: true });
    const anchor = offset(e, e.currentTarget);
    gesture.current = {
      block,
      edge: target.dataset.edge,
      anchor,
      last: anchor,
      delta: 0,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      pointerId: e.pointerId,
      svg: e.currentTarget,
      slot: Number(target.dataset.slot),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function timing(block, edge, delta) {
    const start = block.start,
      end = start + block.minutes;
    if (edge === "start") {
      const next = Math.max(end - 720, Math.min(end - 5, start + delta));
      return { start: next, minutes: end - next };
    }
    if (edge === "end")
      return {
        start,
        minutes: Math.max(5, Math.min(720, block.minutes + delta)),
      };
    return { start: start + delta, minutes: block.minutes };
  }
  function move(e) {
    const s = gesture.current;
    if (!s || s.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) >= 4) s.moved = true;
    if (!s.moved) return;
    const current = offset(e, s.svg);
    let change = current - s.last;
    if (change > 720) change -= 1440;
    if (change < -720) change += 1440;
    s.delta += change;
    s.last = current;
    const delta = Math.round(s.delta / 30) * 30;
    if (s.block) {
      s.change = timing(s.block, s.edge, delta);
      setPreview({ ...s.block, ...s.change });
    } else {
      const end = Math.max(
        0,
        Math.min(1440, s.slot + Math.max(-720, Math.min(720, delta))),
      );
      s.change = {
        start: Math.min(s.slot, end),
        minutes: Math.max(30, Math.abs(end - s.slot)),
      };
      setRange(s.change);
    }
  }
  function up(e) {
    const s = gesture.current;
    if (!s || s.pointerId !== e.pointerId) return;
    cancel();
    suppress.current = true;
    if (s.block) {
      if (s.moved && s.change) onTimingChange(s.block.id, s.change);
    } else
      onCreate(s.moved && s.change ? s.change : { start: s.slot, minutes: 60 });
  }
  function keys(e) {
    if (readonly || e.defaultPrevented || e.isComposing) return;
    const command = e.metaKey || e.ctrlKey;
    if (command && ["z", "y"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat)
        (e.shiftKey || e.key.toLowerCase() === "y" ? onRedo : onUndo)();
    } else if (["Delete", "Backspace"].includes(e.key) && selectedId) {
      e.preventDefault();
      e.stopPropagation();
      onRemove(selectedId);
    } else if (e.key === "Escape") cancel();
  }
  return (
    <div className="template-clock-area" ref={root} onKeyDown={keys}>
      <svg
        className="template-day-clock"
        viewBox="0 0 400 400"
        role="group"
        aria-label="하루 유형 원형 시간표"
        data-editable={!readonly}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onLostPointerCapture={() => {
          if (gesture.current) cancel();
        }}
        onClickCapture={(e) => {
          if (suppress.current && e.detail > 0) {
            e.stopPropagation();
            suppress.current = false;
          }
        }}
      >
        {Array.from({ length: 48 }, (_, i) => (
          <path
            key={i}
            d={arc(i * 30, (i + 1) * 30, 95, 161)}
            className="template-clock-slot"
            data-slot={i * 30}
            role="button"
            tabIndex={readonly ? -1 : 0}
            aria-label={`${templateTimeLabel(i * 30)} 활동 추가`}
            onClick={() =>
              !readonly && onCreate({ start: i * 30, minutes: 60 })
            }
            onKeyDown={(e) => {
              if (!readonly && ["Enter", " "].includes(e.key)) {
                e.preventDefault();
                onCreate({ start: i * 30, minutes: 60 });
              }
            }}
          />
        ))}
        {fragments.map((b) => {
          const width = 66 / b.lanes,
            outer = 161 - width * b.lane,
            inner = outer - width + 1;
          const label = `${b.title || "새 활동"} · ${b.continuation ? "다음 아침 이어짐" : templateTimeLabel(display.find((x) => x.id === b.id).start)} · ${b.minutes}분`;
          return (
            <path
              key={`${b.id}-${b.continuation}`}
              d={arc(b.start, b.end, inner, outer)}
              className={`template-clock-block ${b.id === selectedId ? "selected" : ""} ${b.continuation ? "continuation" : ""}`}
              data-block-id={b.id}
              style={templatePaint(b.id)}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={b.id === selectedId}
              onClick={() => onSelect(b.id)}
              onFocus={() => onSelect(b.id)}
              onKeyDown={(e) => {
                if (["Enter", " "].includes(e.key)) {
                  e.preventDefault();
                  onSelect(b.id);
                } else if (
                  !readonly &&
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    e.key,
                  )
                ) {
                  e.preventDefault();
                  const original = blocks.find((x) => x.id === b.id);
                  onTimingChange(
                    b.id,
                    timing(
                      original,
                      null,
                      ["ArrowLeft", "ArrowUp"].includes(e.key) ? -30 : 30,
                    ),
                  );
                }
              }}
            >
              <title>{label}</title>
            </path>
          );
        })}
        {!readonly &&
          fragments
            .filter((b) => b.id === selectedId)
            .flatMap((b) => {
              const width = 66 / b.lanes,
                original = display.find((x) => x.id === b.id);
              return ["start", "end"]
                .filter((edge) =>
                  edge === "start"
                    ? !b.continuation
                    : b.continuation ||
                      wrap(original.start) + original.minutes <= 1440,
                )
                .map((edge) => {
                  const [x, y] = point(
                    edge === "start"
                      ? 161 - width * b.lane - width - 4
                      : 165 - width * b.lane,
                    edge === "start" ? b.start : b.end,
                  );
                  return (
                    <g
                      key={`${b.id}-${edge}`}
                      role="button"
                      tabIndex={0}
                      className="template-clock-handle"
                      data-block-id={b.id}
                      data-edge={edge}
                      style={templatePaint(b.id)}
                      aria-label={`${b.title || "새 활동"} ${edge === "start" ? "시작" : "종료"} 시간 조절`}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (
                          [
                            "ArrowLeft",
                            "ArrowRight",
                            "ArrowUp",
                            "ArrowDown",
                          ].includes(e.key)
                        ) {
                          e.preventDefault();
                          e.stopPropagation();
                          onTimingChange(
                            b.id,
                            timing(
                              blocks.find((x) => x.id === b.id),
                              edge,
                              ["ArrowLeft", "ArrowUp"].includes(e.key)
                                ? -30
                                : 30,
                            ),
                          );
                        }
                      }}
                    >
                      <circle cx={x} cy={y} r="12" />
                      <path
                        d={`M ${x - 4} ${y - 2} L ${x} ${y - 6} L ${x + 4} ${y - 2} M ${x} ${y - 6} V ${y + 6} M ${x - 4} ${y + 2} L ${x} ${y + 6} L ${x + 4} ${y + 2}`}
                      />
                    </g>
                  );
                });
            })}
        {range && (
          <path
            d={arc(range.start, range.start + range.minutes, 94, 162)}
            className="template-clock-range"
          />
        )}
        {Array.from({ length: 12 }, (_, i) => {
          const [x, y] = point(181, i * 120);
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="template-clock-hour"
            >
              {timeAtOffset(i * 120).slice(0, 2)}
            </text>
          );
        })}
        <text
          x="200"
          y="185"
          textAnchor="middle"
          className="template-clock-eyebrow"
        >
          MY DAY
        </text>
        <text
          x="200"
          y="212"
          textAnchor="middle"
          className="template-clock-center"
        >
          하루 유형
        </text>
        <text
          x="200"
          y="235"
          textAnchor="middle"
          className="template-clock-note"
        >
          04:00 → 다음 날 04:00
        </text>
      </svg>
      <div className="template-clock-feedback" role="status">
        {preview || range
          ? `${templateTimeLabel((preview || range).start)}–${templateTimeLabel((preview || range).start + (preview || range).minutes)} · ${(preview || range).minutes}분`
          : "빈 곳을 누르거나 드래그해 활동을 추가하세요."}
      </div>
      <div className="template-clock-tools">
        <button
          type="button"
          className="text-button"
          disabled={readonly || !canUndo}
          onClick={onUndo}
        >
          실행 취소
        </button>
        <button
          type="button"
          className="text-button"
          disabled={readonly || !canRedo}
          onClick={onRedo}
        >
          다시 실행
        </button>
      </div>
      <p className="footnote">
        블록을 끌어 이동 · 양끝 화살표로 길이 조절 · 방향키 30분 · ⌫ 삭제 · ⌘Z
        되돌리기
        <br />
        점선 블록은 04시를 넘어 다음 아침까지 이어지는 구간입니다.
      </p>
    </div>
  );
}

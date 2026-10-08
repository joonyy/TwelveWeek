import React from "react";
import { Link2, ChevronDown, ArrowUpRight, X } from "lucide-react";
import {
  VISION_AREAS,
  visionChoices,
  linkedVisions,
} from "../../shared/vision-links.js";
import "./vision-links.css";

export function VisionReference({ plan, onEdit }) {
  const choices = visionChoices(plan);
  return (
    <aside className="vision-reference panel" aria-label="목표 작성용 3년 비전">
      <span className="eyebrow">MY THREE-YEAR VISION</span>
      <h3>3년 뒤의 나</h3>
      <p>이번 목표가 아래의 어떤 모습에 가까워지게 하나요?</p>
      {VISION_AREAS.map(({ key, label }) => (
        <section key={key} aria-label={`3년 ${label} 비전 참고`}>
          <h4>{label}</h4>
          <ol>
            {choices
              .filter((item) => item.area === key)
              .map((item) => (
                <li key={item.id}>
                  <span>{String(item.number).padStart(2, "0")}</span>
                  <p>{item.text}</p>
                </li>
              ))}
          </ol>
          {!choices.some((item) => item.area === key) && (
            <p className="vision-reference-empty">아직 적은 비전이 없어요.</p>
          )}
        </section>
      ))}
      <button type="button" className="text-button" onClick={onEdit}>
        3년 비전 수정 <ArrowUpRight size={14} />
      </button>
    </aside>
  );
}

export function GoalVisionSummary({ plan, goal }) {
  const links = linkedVisions(plan, goal);
  return (
    <div className="goal-vision-summary" aria-label="연결된 3년 비전">
      {links.length ? (
        links.map((item) => (
          <span
            className={`vision-link-chip ${item.missing ? "missing" : ""}`}
            key={item.id}
          >
            <small>
              {item.label}
              {item.missing ? " · 연결 검토" : ""}
            </small>
            {item.text}
          </span>
        ))
      ) : (
        <p className="muted">연결된 3년 비전이 없어요.</p>
      )}
    </div>
  );
}

export function GoalVisionLinks({ plan, goal, number, onChange }) {
  const choices = visionChoices(plan);
  const links = goal.visionLinks ?? [];
  const missing = linkedVisions(plan, goal).filter((item) => item.missing);
  const toggle = (item, selected) =>
    onChange(
      selected
        ? [...links, { area: item.area, itemId: item.id, text: item.text }]
        : links.filter(
            (link) => link.itemId !== item.id || link.area !== item.area,
          ),
    );
  return (
    <div className="goal-vision-links">
      <GoalVisionSummary plan={plan} goal={goal} />
      <details className="vision-link-picker">
        <summary aria-label={`목표 ${number}의 3년 비전 연결 선택`}>
          <Link2 size={14} />
          {links.length
            ? `비전 연결 ${links.length}개 · 변경`
            : "3년 비전 연결 선택"}
          <ChevronDown size={14} />
        </summary>
        <div className="vision-link-options">
          <p>
            이 목표와 이어지는 항목을 선택하세요. 여러 개를 연결할 수 있어요.
          </p>
          {VISION_AREAS.map(({ key, label }) => {
            const items = choices.filter((item) => item.area === key);
            return items.length ? (
              <fieldset key={key}>
                <legend>{label}</legend>
                {items.map((item) => (
                  <label className="vision-link-option" key={item.id}>
                    <input
                      type="checkbox"
                      checked={links.some(
                        (link) => link.area === key && link.itemId === item.id,
                      )}
                      onChange={(e) => toggle(item, e.target.checked)}
                    />
                    <span>{item.text}</span>
                  </label>
                ))}
              </fieldset>
            ) : null;
          })}
          {!choices.length && (
            <p>
              비전 화면에서 3년 뒤의 모습을 먼저 적어주세요. 연결 없이 목표를
              작성해도 괜찮아요.
            </p>
          )}
          {missing.length > 0 && (
            <div className="vision-link-missing" role="note">
              <p>
                현재 비전에서 찾을 수 없는 항목입니다. 연결을 해제하거나 다른
                항목을 선택해주세요.
              </p>
              {missing.map((item) => (
                <div key={item.id}>
                  <span>
                    {item.label} · {item.text}
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`${item.text} 연결 해제`}
                    onClick={() => toggle(item, false)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

import React, { useMemo, useState } from "react";
import { Shuffle, Sprout } from "lucide-react";
import "./life-attitude.css";

const written = (value) => typeof value === "string" && value.trim().length > 0;
const choose = (items) => items[Math.floor(Math.random() * items.length)];

export default function LifeAttitude({ plan }) {
  const reminders = useMemo(() => {
    const items = [];
    for (const [key, source, value] of [
      ["personal", "책임 · 개인 생활", plan.responsibilityActions?.personal],
      ["business", "책임 · 일·비즈니스", plan.responsibilityActions?.business],
      ["legacy", "책임 · 적어둔 생각", plan.responsibility],
    ]) {
      if (written(value))
        value
          .split("\n")
          .filter(written)
          .forEach((text, index) => {
            items.push({
              id: `responsibility-${key}-${index}`,
              source,
              text,
              details: [],
            });
          });
    }
    for (const [index, entry] of (plan.pastCommitments ?? []).entries()) {
      const text = [entry.promise, entry.action, entry.benefit].find(written);
      if (text)
        items.push({
          id: `past-${index}`,
          source: "지켜냈던 약속",
          text,
          details: [
            ["그때의 행동", entry.action],
            ["얻었던 변화", entry.benefit],
          ].filter(([, value]) => written(value) && value !== text),
        });
    }
    for (const entry of plan.commitments ?? []) {
      const text = [entry.promise, entry.action, entry.cost, entry.choice].find(
        written,
      );
      if (entry.accepted && text)
        items.push({
          id: `commitment-${entry.id}`,
          source: `헌신 · ${entry.area}`,
          text,
          details: [
            ["핵심 활동", entry.action],
            ["감수하기로 한 비용", entry.cost],
            ["선택의 이유", entry.choice],
          ].filter(([, value]) => written(value) && value !== text),
        });
    }
    return items;
  }, [
    plan.responsibilityActions,
    plan.responsibility,
    plan.pastCommitments,
    plan.commitments,
  ]);
  const [selection, setSelection] = useState(() => {
    const first = choose(reminders);
    return {
      id: first?.id,
      remaining: reminders
        .filter((item) => item.id !== first?.id)
        .map((item) => item.id),
    };
  });
  const current =
    reminders.find((item) => item.id === selection.id) ?? reminders[0];
  if (!current) return null;
  function next() {
    // Draw without replacement so every promise can be recalled before repeats.
    let options = reminders.filter(
      (item) => item.id !== current.id && selection.remaining.includes(item.id),
    );
    if (!options.length)
      options = reminders.filter((item) => item.id !== current.id);
    const item = choose(options);
    if (item)
      setSelection({
        id: item.id,
        remaining: options
          .filter((option) => option.id !== item.id)
          .map((option) => option.id),
      });
  }
  return (
    <section className="life-attitude" aria-label="나의 삶의 태도">
      <header>
        <span className="attitude-heading">
          <Sprout size={17} />
          나의 삶의 태도
        </span>
        {reminders.length > 1 && (
          <button type="button" className="text-button" onClick={next}>
            <Shuffle size={14} />
            다른 약속 보기
          </button>
        )}
      </header>
      <article key={current.id} aria-live="polite" aria-atomic="true">
        <span className="attitude-source">{current.source}</span>
        <blockquote className="attitude-message">{current.text}</blockquote>
        {current.details.length > 0 && (
          <details className="attitude-context">
            <summary>함께 적어둔 내용</summary>
            <dl>
              {current.details.map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </React.Fragment>
              ))}
            </dl>
          </details>
        )}
      </article>
    </section>
  );
}

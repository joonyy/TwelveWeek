import React, { useEffect, useState } from "react";
import { BookOpen, Download } from "lucide-react";
import { api } from "./api.js";
import { calendarInstant } from "../../shared/domain.js";
import "./reading-notes.css";

export function ReadingRecordModal({
  Modal,
  occurrence,
  tactic,
  today,
  busy,
  completeOnSave,
  onClose,
  onSave,
  onDelete,
}) {
  const [record, setRecord] = useState(
    () =>
      occurrence.readingRecord ?? {
        book: tactic.readingBook || "",
        chapter: "",
        thought: "",
      },
  );
  const [time, setTime] = useState(occurrence.time);
  const update = (key, value) => setRecord((old) => ({ ...old, [key]: value }));
  return (
    <Modal title="독서 기록" onClose={onClose}>
      <p className="muted">
        {tactic.title} · 책과 단원, 동의한 점·의문·내 생활과 연결되는 생각 중
        하나를 남기세요.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(
            record,
            completeOnSave && occurrence.date !== today
              ? calendarInstant(occurrence.date, time).toISOString()
              : undefined,
            completeOnSave,
          );
        }}
      >
        <label className="field">
          <span>책 이름</span>
          <input
            aria-label="독서 기록 책 이름"
            value={record.book}
            maxLength={300}
            required
            onChange={(e) => update("book", e.target.value)}
          />
        </label>
        <label className="field">
          <span>읽은 단원</span>
          <input
            aria-label="읽은 단원"
            placeholder="예: 1장 · 두 번째 뇌의 가능성"
            value={record.chapter}
            maxLength={300}
            required
            onChange={(e) => update("chapter", e.target.value)}
          />
        </label>
        <label className="field">
          <span>한 줄 생각</span>
          <textarea
            aria-label="한 줄 생각"
            placeholder="이 단원에서 내게 남은 생각은?"
            value={record.thought}
            rows={3}
            maxLength={2000}
            required
            onChange={(e) => update("thought", e.target.value)}
          />
        </label>
        {completeOnSave && occurrence.date !== today && (
          <label className="field">
            <span>{occurrence.date} 평가일의 실제 실행 시각 · 한국 시간</span>
            <input
              aria-label="독서 실제 실행 시각"
              type="time"
              value={time}
              required
              onChange={(e) => setTime(e.target.value)}
            />
            <small>00~03시는 해당 평가일의 다음 날 새벽입니다.</small>
          </label>
        )}
        <p className="footnote">
          기록은 이 실행에 저장되며, 책별로 모아 Markdown으로 내려받을 수
          있어요.
        </p>
        <button className="button" disabled={busy}>
          {completeOnSave ? "기록하고 실행 완료" : "독서 기록 저장"}
        </button>
        {onDelete && occurrence.readingRecord && !occurrence.completed && (
          <button
            type="button"
            className="text-button reading-delete"
            disabled={busy}
            onClick={onDelete}
          >
            독서 기록 지우기
          </button>
        )}
      </form>
    </Modal>
  );
}

export function ReadingNotebook({
  cycleId,
  version,
  readingTactics = [],
  onError,
}) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api(`/cycles/${cycleId}/reading-notes`)
      .then((data) => {
        if (!cancelled) setRecords(data.records);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cycleId, version]);
  const books = [...new Set(records.map((r) => r.book))];
  const download = async () => {
    try {
      const blob = await api(`/cycles/${cycleId}/reading-notes.md`, {
        blob: true,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "twelveweek-reading-notes.md";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      onError(e.message);
    }
  };
  // Saved records remain discoverable after the source tactic is removed from
  // future plans. A user with neither reading tactics nor records sees no box.
  if (!readingTactics.length && !records.length) return null;
  return (
    <details className="reading-notebook">
      <summary>
        <BookOpen size={16} /> 독서 기록 모음
        {records.length > 0 && <span> · {records.length}개 기록</span>}
      </summary>
      <p className="muted">
        독서 전술을 실행하며 남긴 책·읽은 단원·한 줄 생각을 책별로 모읍니다.
      </p>
      {readingTactics.length > 0 && (
        <p className="reading-notebook-context">
          연결된 독서 전술:{" "}
          {[
            ...new Set(
              readingTactics.map((t) => `${t.title} (${t.readingBook.trim()})`),
            ),
          ].join(" · ")}
        </p>
      )}
      <button
        type="button"
        className="button outlined"
        onClick={download}
        disabled={loading || !records.length}
      >
        <Download size={14} /> 독서 기록 Markdown 내보내기
      </button>
      {loading ? (
        <p className="muted">기록을 불러오는 중…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : books.length ? (
        books.map((book) => (
          <section key={book} aria-label={`${book} 독서 기록`}>
            <h3>{book}</h3>
            {records
              .filter((r) => r.book === book)
              .map((r) => (
                <article key={`${r.week}-${r.occurrenceId}`}>
                  <strong>{r.chapter}</strong>
                  <small>
                    {r.week}주차 · {r.date || "날짜 미정"} ·{" "}
                    {r.completed ? "실행 완료" : "기록 초안"}
                  </small>
                  <p>{r.thought}</p>
                </article>
              ))}
          </section>
        ))
      ) : (
        <p className="muted">
          아직 저장한 한 줄 생각이 없어요. ‘일간 실행’에서 책이 연결된 전술의
          ‘독서 기록 남기기’를 눌러 책·단원·한 줄 생각을 작성하세요.
        </p>
      )}
    </details>
  );
}

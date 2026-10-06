import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Check,
  ChevronLeft,
  ChevronRight,
  LogOut,
  BookOpen,
  CalendarDays,
  Target,
  Sprout,
  X,
  Download,
  Save,
  CircleHelp,
  Trash2,
  Clock3,
  Flag,
} from "lucide-react";
import { api, token } from "./api.js";
import {
  DEFAULT_START,
  DEFAULT_WEEK_COUNT,
  MAX_WEEK_COUNT,
  addDays,
  currentWeek,
  weekStart,
  percentage,
  PRINCIPLES,
  calendarInstant,
  weekGoals,
} from "../../shared/domain.js";
import {
  newGoal,
  newTactic,
  editablePlan,
  hasGoalContent,
  planWithinWeeks,
} from "../../shared/planning.js";
import {
  VisionEditor,
  ModelWeekEditor,
  ResponsibilityEditor,
  CommitmentWheel,
  WeekCalendar,
} from "./PlanningWidgets.jsx";
import "./style.css";

const uid = () => crypto.randomUUID();
const cycleWeeks = (cycle) => cycle.week_count ?? DEFAULT_WEEK_COUNT;
const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
const shortDate = (d) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
const range = (start, end) => `${shortDate(start)} — ${shortDate(end)}`;
function Field({ label, hint, area = false, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      {hint && <small>{hint}</small>}
      {area ? (
        <textarea aria-label={label} rows={3} {...props} />
      ) : (
        <input aria-label={label} {...props} />
      )}
    </label>
  );
}
function Button({ children, variant = "", ...props }) {
  return (
    <button className={`button ${variant}`} {...props}>
      {children}
    </button>
  );
}
function Guide({ ids }) {
  return (
    <aside className="guide">
      <Sprout size={19} />
      <div>
        {ids.map((id) => {
          const p = PRINCIPLES.find((x) => x.id === id);
          return (
            <p key={id}>
              <strong>{p.name}</strong> {p.text}
            </p>
          );
        })}
      </div>
    </aside>
  );
}
function Modal({ title, children, onClose }) {
  const container = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const initial = container.current?.querySelector(
      "input:not(:disabled), textarea:not(:disabled), button",
    );
    initial?.focus();
    const trap = (e) => {
      if (e.key !== "Tab") return;
      const elements = [
        ...container.current.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ),
      ];
      const first = elements[0],
        last = elements.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    container.current?.addEventListener("keydown", trap);
    const element = container.current;
    return () => {
      element?.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const fn = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={container}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="닫기" onClick={onClose}>
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function App() {
  const [profile, setProfile] = useState(null),
    [ready, setReady] = useState(false),
    [cycle, setCycle] = useState(null),
    [view, setView] = useState("plan"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [principles, setPrinciples] = useState(false),
    [editing, setEditing] = useState(false);
  useEffect(() => {
    const leave = (e) => {
      if (editing) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [editing]);
  const navigate = (fn) => {
    if (
      editing &&
      !window.confirm("저장하지 않은 변경이 있어요. 변경을 버리고 이동할까요?")
    )
      return;
    setEditing(false);
    fn();
  };
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [cycle?.id, view]);
  async function run(fn) {
    setError("");
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
      if (e.status === 401) {
        localStorage.removeItem("twelve.token");
        setProfile(null);
        setCycle(null);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    (async () => {
      if (token())
        await run(async () => setProfile((await api("/me")).profile));
      setReady(true);
    })();
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(id);
  }, [notice]);
  const open = async (id) =>
    run(async () => {
      const c = await api(`/cycles/${id}`);
      setCycle(c);
      setView(c.status === "draft" ? "plan" : "week");
    });
  const logout = () =>
    run(async () => {
      await api("/sessions/current", { method: "DELETE" });
      localStorage.removeItem("twelve.token");
      setProfile(null);
      setCycle(null);
    });
  if (!ready) return <div className="loading">나의 12주를 불러오는 중…</div>;
  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <a
            href="#"
            className="brand"
            onClick={(e) => {
              e.preventDefault();
              navigate(() => setCycle(null));
            }}
          >
            <span className="brand-mark">
              12<span>W</span>
            </span>
            <span>
              TWELVE WEEK<small>작은 실행, 분명한 방향</small>
            </span>
          </a>
          {profile && (
            <>
              <div className="profile">
                <span className="avatar">{profile.name.slice(0, 1)}</span>
                <div>
                  <strong>{profile.name}</strong>
                  <small>나의 실행 공간</small>
                </div>
              </div>
              <nav>
                <button
                  className={!cycle ? "selected" : ""}
                  onClick={() => navigate(() => setCycle(null))}
                >
                  <BookOpen size={18} />
                  나의 12주
                </button>
                {cycle && (
                  <>
                    <button
                      className={view === "plan" ? "selected" : ""}
                      onClick={() => navigate(() => setView("plan"))}
                    >
                      <Target size={18} />
                      비전과 {cycleWeeks(cycle)}주 계획
                    </button>
                    <button
                      disabled={cycle.status === "draft"}
                      className={view === "week" ? "selected" : ""}
                      onClick={() => navigate(() => setView("week"))}
                    >
                      <CalendarDays size={18} />
                      실행과 평가
                    </button>
                  </>
                )}
              </nav>
            </>
          )}
          <div className="sidebar-bottom">
            <button
              className="principles-link"
              onClick={() => setPrinciples(true)}
            >
              <Sprout size={17} />
              길을 잡아주는 8요소
              <ArrowUpRight size={16} />
            </button>
            <p>
              결과는 목표에서.
              <br />
              변화는 오늘의 실행에서.
            </p>
            {profile && (
              <button className="logout" onClick={() => navigate(logout)}>
                <LogOut size={15} />
                유저 전환
              </button>
            )}
          </div>
        </aside>
        <main>
          <div className="topline">
            <span>
              {profile
                ? "YOUR NEXT TWELVE WEEKS"
                : "A SPACE FOR YOUR COMMITMENT"}
            </span>
            <span className="timezone">
              <span className="status-dot" />
              한국 시간 · 하루 마감 04:00
            </span>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
              <button onClick={() => setError("")} aria-label="오류 닫기">
                <X size={16} />
              </button>
            </div>
          )}
          {!profile ? (
            <Entry onLogin={setProfile} run={run} busy={busy} />
          ) : !cycle ? (
            <CycleList
              open={open}
              run={run}
              busy={busy}
              onCreated={(c) => {
                setCycle(c);
                setView("plan");
              }}
            />
          ) : view === "plan" ? (
            <Planner
              key={cycle.id}
              cycle={cycle}
              setCycle={setCycle}
              setView={setView}
              run={run}
              busy={busy}
              notify={setNotice}
              onDirty={setEditing}
            />
          ) : (
            <Execution
              key={cycle.id}
              cycle={cycle}
              setCycle={setCycle}
              run={run}
              busy={busy}
              notify={setNotice}
              onDirty={setEditing}
            />
          )}
        </main>
      </div>
      {notice && (
        <div role="status" className="toast">
          <Check size={18} />
          {notice}
        </div>
      )}
      {busy && <div className="busy-line" />}
      {principles && (
        <Modal
          title="12주 프로그램의 8요소"
          onClose={() => setPrinciples(false)}
        >
          <p className="muted">
            작성할 때, 실행할 때, 돌아볼 때. 필요한 순간에 다시 만나는
            기준입니다.
          </p>
          <div className="principle-grid">
            {PRINCIPLES.map((p) => (
              <article key={p.id}>
                <small>
                  {p.type === "사고" ? "사고방식의 3원리" : "행동방식의 5원칙"}
                </small>
                <h3>{p.name}</h3>
                <p>{p.text}</p>
              </article>
            ))}
          </div>
          <p className="footnote">
            『위대한 12주』의 개념과 개인 정리본을 바탕으로 만든 적용
            안내입니다. 원문 인용은 아닙니다.
          </p>
        </Modal>
      )}
    </>
  );
}

function Entry({ onLogin, run, busy }) {
  const [profiles, setProfiles] = useState([]),
    [name, setName] = useState("");
  useEffect(() => {
    run(async () => setProfiles(await api("/profiles")));
  }, []);
  const enter = (profile) =>
    run(async () => {
      const session = await api("/sessions", {
        method: "POST",
        body: { profileId: profile.id },
      });
      localStorage.setItem("twelve.token", session.token);
      onLogin(session.profile);
    });
  const create = (e) => {
    e.preventDefault();
    run(async () => {
      const p = await api("/profiles", { method: "POST", body: { name } });
      setProfiles((prev) => [...prev, p]);
      setName("");
      const s = await api("/sessions", {
        method: "POST",
        body: { profileId: p.id },
      });
      localStorage.setItem("twelve.token", s.token);
      onLogin(s.profile);
    });
  };
  return (
    <div className="entry">
      <div className="entry-copy">
        <span className="eyebrow">ONE SEASON. ONE DIRECTION.</span>
        <h1>
          다음 12주,
          <br />
          어떤 변화를
          <br />
          <em>만들고 싶나요?</em>
        </h1>
        <p>
          원하는 삶을 그리고, 이번 주의 행동으로 옮기세요.
          <br />
          실행의 흔적이 쌓이는 나만의 공간입니다.
        </p>
        <div className="entry-art" aria-hidden="true">
          <span>12</span>
          <div>
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <small>WEEKS OF POSSIBILITY</small>
        </div>
      </div>
      <section className="entry-card">
        <span className="pill">START YOUR SESSION</span>
        <h2>유저를 선택하세요.</h2>
        <p className="muted">내 이름으로 들어가 이어서 시작합니다.</p>
        {profiles.length > 0 && (
          <div className="profile-list">
            {profiles.map((p) => (
              <button disabled={busy} key={p.id} onClick={() => enter(p)}>
                <span className="avatar">{p.name.slice(0, 1)}</span>
                <strong>{p.name}</strong>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>
        )}
        <form onSubmit={create}>
          <Field
            label="새 유저 이름"
            placeholder="어떤 이름으로 시작할까요?"
            maxLength={32}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button disabled={busy || !name.trim()} type="submit">
            나의 공간 만들기
            <ArrowRight size={18} />
          </Button>
        </form>
        <p className="footnote">
          신뢰하는 사람끼리 사용하는 프로필 선택 방식입니다. 비밀번호 없이
          이름을 선택하며, 이 기기에서는 기본 365일 동안 유지됩니다.
        </p>
      </section>
    </div>
  );
}

function CycleList({ open, run, busy, onCreated }) {
  const [list, setList] = useState([]),
    [creating, setCreating] = useState(false),
    [title, setTitle] = useState("나의 첫 12주"),
    [start, setStart] = useState(DEFAULT_START),
    [weekCount, setWeekCount] = useState(DEFAULT_WEEK_COUNT);
  useEffect(() => {
    run(async () => setList(await api("/cycles")));
  }, []);
  const create = (e) => {
    e.preventDefault();
    run(async () => {
      onCreated(
        await api("/cycles", {
          method: "POST",
          body: { title, startDate: start, weekCount },
        }),
      );
    });
  };
  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">MY SEASONS</span>
          <h1>나의 12주</h1>
          <p>크게 그리되, 실행할 수 있는 약속부터 시작하세요.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={18} />새 12주 만들기
        </Button>
      </header>
      <Guide ids={["vision", "moment"]} />
      <div className="cycles">
        {list.map((c) => (
          <button className="cycle-card" key={c.id} onClick={() => open(c.id)}>
            <span className={`pill ${c.status}`}>
              {
                { draft: "작성 중", active: "실행 중", complete: "마침" }[
                  c.status
                ]
              }
            </span>
            <h2>{c.title}</h2>
            <p>
              {c.start_date} — {addDays(c.start_date, cycleWeeks(c) * 7 - 1)} ·{" "}
              {cycleWeeks(c)}주 실행
            </p>
            <div className="mini-weeks">
              {Array.from({ length: cycleWeeks(c) }, (_, i) => (
                <i
                  key={i}
                  className={
                    c.status !== "draft" &&
                    i < currentWeek(c.start_date, new Date(), cycleWeeks(c))
                      ? "filled"
                      : ""
                  }
                />
              ))}
            </div>
            <footer>
              <span>
                {c.status === "draft"
                  ? "비전과 계획 이어 쓰기"
                  : "실행과 평가 살펴보기"}
              </span>
              <ArrowUpRight size={20} />
            </footer>
          </button>
        ))}
        {!list.length && (
          <div className="empty-card">
            <Flag size={32} />
            <h2>아직 비어 있는 첫 번째 계절</h2>
            <p>
              완벽한 답이 없어도 괜찮습니다.
              <br />
              비전에서 출발해 실행 가능한 계획을 채워보세요.
            </p>
            <Button variant="light" onClick={() => setCreating(true)}>
              첫 12주 작성하기
              <ArrowRight size={17} />
            </Button>
          </div>
        )}
      </div>
      {creating && (
        <Modal title="새로운 12주" onClose={() => setCreating(false)}>
          <form onSubmit={create}>
            <Field
              label={`이번 ${weekCount}주의 이름`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={120}
            />
            <Field
              label="시작 월요일"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
            <WeekCountField value={weekCount} onChange={setWeekCount} />
            <p className="muted">
              실행 {weekCount}주 + 돌아보고 쉬어가는 {weekCount + 1}주차로
              구성됩니다. 기간은 1~12주 사이에서 선택할 수 있어요.
            </p>
            <Button disabled={busy}>
              비전부터 작성하기
              <ArrowRight size={18} />
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}

function WeekCountField({
  value,
  onChange,
  min = 1,
  max = MAX_WEEK_COUNT,
  disabled = false,
}) {
  return (
    <label className="field">
      <span>실행 주수</span>
      <select
        aria-label="실행 주수"
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        disabled={disabled}
      >
        {Array.from({ length: max - min + 1 }, (_, i) => i + min).map(
          (weeks) => (
            <option key={weeks} value={weeks}>
              {weeks}주
            </option>
          ),
        )}
      </select>
    </label>
  );
}

function Planner({ cycle, setCycle, setView, run, busy, notify, onDirty }) {
  const [data, setData] = useState(() =>
      editablePlan(cycle.plan, {
        draft: cycle.status === "draft",
        weekCount: cycleWeeks(cycle),
      }),
    ),
    [title, setTitle] = useState(cycle.title),
    [start, setStart] = useState(cycle.start_date),
    [weekCount, setWeekCount] = useState(cycleWeeks(cycle)),
    [tab, setTab] = useState(0),
    [dirty, setDirty] = useState(false),
    [starting, setStarting] = useState(false);
  const tabs = ["비전", `목표와 ${weekCount}주 계획`, "모범 주간", "삶의 태도"];
  const validStart = /^\d{4}-\d{2}-\d{2}$/.test(start);
  const minimumWeeks =
    cycle.status === "active"
      ? Math.min(cycleWeeks(cycle), Math.max(1, currentWeek(cycle.start_date)))
      : 1;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty]);
  const change = (key, value) => {
    setData((p) => ({ ...p, [key]: value }));
    setDirty(true);
  };
  useEffect(() => {
    const listener = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);
  async function save() {
    const c = await api(`/cycles/${cycle.id}`, {
      method: "PUT",
      body: {
        title,
        startDate: start,
        weekCount,
        plan: data,
        version: cycle.version,
      },
    });
    setCycle(c);
    setDirty(false);
    notify("계획을 저장했어요.");
    return c;
  }
  const activate = () =>
    run(async () => {
      const c = dirty ? await save() : cycle;
      const active = await api(`/cycles/${c.id}/start`, {
        method: "POST",
        body: { version: c.version },
      });
      setCycle(active);
      setView("week");
      notify(`${cycleWeeks(active)}주 실행 공간을 열었어요.`);
    });
  const goalChange = (id, key, value) =>
    change(
      "goals",
      data.goals.map((g) => (g.id === id ? { ...g, [key]: value } : g)),
    );
  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">DESIGN YOUR SEASON</span>
          <h1>
            방향을 정하고,
            <br className="mobile-only" /> 실행을 작게 만드세요.
          </h1>
          <p>
            비전 → {weekCount}주 목표 → 목표별 전술. 작성 중인 생각도 저장할 수
            있어요.
          </p>
        </div>
        <div className="save-area">
          <span>{dirty ? "저장하지 않은 변경" : "저장된 계획"}</span>
          <Button
            disabled={busy || cycle.status === "complete"}
            onClick={() => run(save)}
          >
            <Save size={17} />
            저장
          </Button>
        </div>
      </header>
      <div className="cycle-meta">
        <Field
          label={`${weekCount}주 이름`}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          disabled={cycle.status === "complete"}
        />
        <Field
          label="시작 월요일"
          type="date"
          value={start}
          disabled={cycle.status !== "draft"}
          onChange={(e) => {
            setStart(e.target.value);
            setDirty(true);
          }}
        />
        <WeekCountField
          value={weekCount}
          min={minimumWeeks}
          max={cycle.status === "draft" ? MAX_WEEK_COUNT : cycleWeeks(cycle)}
          disabled={cycle.status === "complete"}
          onChange={(count) => {
            setWeekCount(count);
            setData((p) => planWithinWeeks(p, count));
            setDirty(true);
          }}
        />
        <div>
          <small>실행 기간</small>
          <strong>
            {validStart
              ? range(start, addDays(start, weekCount * 7 - 1))
              : "시작일을 선택해주세요."}
          </strong>
          <small>
            {validStart &&
              `${weekCount + 1}주차 ${range(addDays(start, weekCount * 7), addDays(start, weekCount * 7 + 6))} · 회고와 회복`}
          </small>
        </div>
      </div>
      {weekCount < cycleWeeks(cycle) && (
        <div className="info-note">
          실행 기간을 {cycleWeeks(cycle)}주에서 {weekCount}주로 줄입니다.
          제외되는 미래 주차의 전술은 이번 실행 기간과 집계에 포함되지 않습니다.
          목표와 활동 내용은 유지되므로 실행 주차를 다시 확인해주세요.
        </div>
      )}
      {cycle.status === "active" && (
        <div className="info-note">
          계획을 바꾸면 아직 시작하지 않은 주에 반영됩니다. 이번 주와 지난주의
          전술·횟수·점수 기준은 보존됩니다.
        </div>
      )}
      <div className="tabs" role="tablist">
        {tabs.map((t, i) => (
          <button
            role="tab"
            aria-selected={tab === i}
            key={t}
            onClick={() => setTab(i)}
          >
            <span>0{i + 1}</span>
            {t}
          </button>
        ))}
      </div>
      <fieldset disabled={cycle.status === "complete"} className="plan-fields">
        {tab === 0 && (
          <>
            <Guide ids={["vision"]} />
            <section className="panel">
              <SectionTitle
                number="01"
                title="원대한 장기 비전"
                description="지금 가능한 것부터 검열하지 말고, 살고 싶은 삶을 최대한 펼쳐보세요."
              />
              <VisionEditor
                label="장기 비전"
                value={data.longVision}
                mode={data.visionModes.longVision}
                onChange={(v) => change("longVision", v)}
                onMode={(mode) =>
                  change("visionModes", {
                    ...data.visionModes,
                    longVision: mode,
                  })
                }
                placeholder="가지고 싶고, 하고 싶고, 되고 싶은 모습을 자유롭게 적어보세요."
              />
            </section>
            <section className="panel">
              <SectionTitle
                number="02"
                title="3년 뒤의 나"
                description="장기 비전에 가까워진 모습을 개인 생활과 일의 관점에서 구체화하세요."
              />
              <div className="two-col">
                <VisionEditor
                  label="개인 생활의 비전"
                  value={data.personalVision}
                  mode={data.visionModes.personalVision}
                  onChange={(v) => change("personalVision", v)}
                  onMode={(mode) =>
                    change("visionModes", {
                      ...data.visionModes,
                      personalVision: mode,
                    })
                  }
                />
                <VisionEditor
                  label="커리어의 비전"
                  value={data.careerVision}
                  mode={data.visionModes.careerVision}
                  onChange={(v) => change("careerVision", v)}
                  onMode={(mode) =>
                    change("visionModes", {
                      ...data.visionModes,
                      careerVision: mode,
                    })
                  }
                />
              </div>
            </section>
          </>
        )}
        {tab === 1 && (
          <>
            <Guide ids={["plan", "commitment"]} />
            <SectionTitle
              number="03–07"
              title={`${weekCount}주 목표와 목표별 계획`}
              description={`프로젝트와 가치관에서 후보를 찾고, 이번 ${weekCount}주에 실제로 변화를 만들 목표를 선택하세요. 목표마다 전술·장애물·지표를 따로 작성합니다.`}
            />
            {data.goals.map((g, index) => (
              <section className="panel goal-panel" key={g.id}>
                <header className="section-heading">
                  <span className="eyebrow">
                    GOAL {String(index + 1).padStart(2, "0")}
                  </span>
                  <button
                    className="text-button danger"
                    onClick={() => {
                      if (
                        window.confirm(
                          "이 목표를 계획에서 삭제할까요? 이미 시작한 주의 기준은 유지됩니다.",
                        )
                      )
                        change(
                          "goals",
                          data.goals.filter((x) => x.id !== g.id),
                        );
                    }}
                  >
                    <Trash2 size={14} />
                    목표 삭제
                  </button>
                </header>
                <Field
                  label={`03. ${weekCount}주 목표`}
                  placeholder={`${weekCount}주 뒤 어떤 결과에 도달할 것인가요?`}
                  value={g.title}
                  onChange={(e) => goalChange(g.id, "title", e.target.value)}
                />
                <div className="two-col">
                  <Field
                    label="성공 기준"
                    hint="달성 여부를 알 수 있는 구체적인 결과와 기준"
                    area
                    value={g.success}
                    onChange={(e) =>
                      goalChange(g.id, "success", e.target.value)
                    }
                  />
                  <Field
                    label="04. 성취했을 때 얻는 변화"
                    hint="왜 이 목표에 시간과 노력을 쓰고 싶은가요?"
                    area
                    value={g.benefit}
                    onChange={(e) =>
                      goalChange(g.id, "benefit", e.target.value)
                    }
                  />
                </div>
                <div className="subheading">
                  <h3>05. {weekCount}주 계획</h3>
                  <p>
                    전술은 주차로 배치하세요. 한 번의 실행은 완료 여부를 명확히
                    판단할 수 있어야 합니다.
                  </p>
                </div>
                {g.tactics.map((t, ti) => (
                  <TacticEditor
                    key={t.id}
                    tactic={t}
                    index={ti}
                    weekCount={weekCount}
                    onChange={(v) =>
                      goalChange(
                        g.id,
                        "tactics",
                        g.tactics.map((x) => (x.id === t.id ? v : x)),
                      )
                    }
                    onRemove={() =>
                      goalChange(
                        g.id,
                        "tactics",
                        g.tactics.filter((x) => x.id !== t.id),
                      )
                    }
                  />
                ))}
                <Button
                  variant="light"
                  onClick={() =>
                    goalChange(g.id, "tactics", [
                      ...g.tactics,
                      newTactic(weekCount),
                    ])
                  }
                >
                  <Plus size={16} />
                  전술 추가
                </Button>
                <div className="subheading">
                  <h3>06. 예상 장애물과 대응</h3>
                  <p>
                    막연한 의지 대신, 실행을 막을 상황과 선택할 행동을 미리
                    연결해보세요.
                  </p>
                </div>
                {g.difficulties.map((d) => (
                  <div className="obstacle" key={d.id}>
                    <label className="field">
                      <span>연결할 전술</span>
                      <select
                        value={d.tacticId}
                        onChange={(e) =>
                          goalChange(
                            g.id,
                            "difficulties",
                            g.difficulties.map((x) =>
                              x.id === d.id
                                ? { ...d, tacticId: e.target.value }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="">목표 전체</option>
                        {g.tactics.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title || "이름 없는 전술"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="two-col">
                      {[
                        ["obstacle", "예상되는 어려움"],
                        ["response", "그때 취할 대응"],
                      ].map(([key, label]) => (
                        <Field
                          key={key}
                          label={label}
                          area
                          value={d[key]}
                          onChange={(e) =>
                            goalChange(
                              g.id,
                              "difficulties",
                              g.difficulties.map((x) =>
                                x.id === d.id
                                  ? { ...d, [key]: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      ))}
                    </div>
                    <button
                      className="text-button"
                      onClick={() =>
                        goalChange(
                          g.id,
                          "difficulties",
                          g.difficulties.filter((x) => x.id !== d.id),
                        )
                      }
                    >
                      장애물 삭제
                    </button>
                  </div>
                ))}
                <Button
                  variant="light"
                  onClick={() =>
                    goalChange(g.id, "difficulties", [
                      ...g.difficulties,
                      { id: uid(), tacticId: "", obstacle: "", response: "" },
                    ])
                  }
                >
                  <Plus size={16} />
                  장애물과 대응 추가
                </Button>
                <div className="subheading">
                  <h3>07. 선행지표와 후행지표</h3>
                  <p>
                    실행 점수는 행동의 이행률입니다. 결과가 변했는지는 별도의
                    지표로 확인하세요.
                  </p>
                </div>
                <div className="two-col">
                  <Field
                    label="선행지표 · 내가 실행할 행동"
                    placeholder="예: 매주 러닝 3회"
                    area
                    value={g.leading}
                    onChange={(e) =>
                      goalChange(g.id, "leading", e.target.value)
                    }
                  />
                  <Field
                    label="후행지표 · 나타난 결과"
                    placeholder="예: 체중 변화, 완성된 결과물"
                    area
                    value={g.lagging}
                    onChange={(e) =>
                      goalChange(g.id, "lagging", e.target.value)
                    }
                  />
                </div>
                <Field
                  label="측정 방법과 확인 주기"
                  value={g.measurement}
                  onChange={(e) =>
                    goalChange(g.id, "measurement", e.target.value)
                  }
                />
              </section>
            ))}
            <Button
              variant="outlined"
              onClick={() =>
                change("goals", [...data.goals, newGoal(weekCount)])
              }
            >
              <Plus size={18} />
              {weekCount}주 목표 추가
            </Button>
          </>
        )}
        {tab === 2 && (
          <>
            <Guide ids={["time", "process"]} />
            <section className="panel">
              <SectionTitle
                number="08"
                title="모범 주간"
                description="월요일부터 일요일까지, 가장 생산적인 한 주를 캘린더에 그려보세요. 중요한 활동과 작은 업무, 재충전 시간을 함께 배치합니다."
              />
              <ModelWeekEditor
                blocks={data.modelWeek}
                onChange={(v) => change("modelWeek", v)}
                Modal={Modal}
                readonly={cycle.status === "complete"}
              />
            </section>
          </>
        )}
        {tab === 3 && (
          <>
            <Guide ids={["ownership", "commitment", "moment"]} />
            <section className="panel">
              <SectionTitle
                number="09"
                title="책임을 실천하는 태도"
                description="정리본의 네 가지 태도를 떠올리며, 개인 생활과 일에서 실천할 노력을 적어보세요."
              />
              <ResponsibilityEditor
                value={data.responsibilityActions}
                legacy={data.responsibility}
                onChange={(v) => change("responsibilityActions", v)}
                onLegacy={(v) => change("responsibility", v)}
              />
            </section>
            <section className="panel">
              <SectionTitle
                number="10"
                title="지켜냈던 두 번의 약속"
                description="과거에 헌신했던 경험에서, 실행할 때 도움이 되었던 조건을 찾아보세요."
              />
              {data.pastCommitments.map((p, i) => (
                <div key={i} className="past-promise">
                  <span className="eyebrow">EXPERIENCE 0{i + 1}</span>
                  <div className="three-col">
                    {[
                      ["promise", "어떤 약속이었나요?"],
                      ["action", "어떻게 행동했나요?"],
                      ["benefit", "무엇을 얻었나요?"],
                    ].map(([key, label]) => (
                      <Field
                        area
                        key={key}
                        label={label}
                        value={p[key]}
                        onChange={(e) =>
                          change(
                            "pastCommitments",
                            data.pastCommitments.map((x, j) =>
                              j === i ? { ...p, [key]: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
            <section className="panel">
              <SectionTitle
                number="11"
                title="삶의 영역별 헌신"
                description="원하는 것뿐 아니라 필요한 행동과 비용까지 바라보고, 지금 감당할 약속을 선택하세요."
              />
              <CommitmentWheel
                weekCount={weekCount}
                entries={data.commitments}
                onChange={(v) => change("commitments", v)}
                readonly={cycle.status === "complete"}
              />
            </section>
          </>
        )}
      </fieldset>
      <footer className="plan-footer">
        <button
          className="text-button"
          disabled={tab === 0}
          onClick={() => setTab(tab - 1)}
        >
          <ChevronLeft size={18} />
          이전
        </button>
        <span>{tab + 1} / 4</span>
        {tab < 3 ? (
          <Button variant="light" onClick={() => setTab(tab + 1)}>
            다음
            <ChevronRight size={18} />
          </Button>
        ) : cycle.status === "draft" ? (
          <Button onClick={() => setStarting(true)}>
            {weekCount}주 착수
            <ArrowRight size={18} />
          </Button>
        ) : (
          <Button
            onClick={() =>
              run(async () => {
                if (dirty) await save();
                setView("week");
              })
            }
          >
            실행 화면으로
            <ArrowRight size={18} />
          </Button>
        )}
      </footer>
      {starting && (
        <Modal
          title={`이번 ${weekCount}주를 시작할까요?`}
          onClose={() => setStarting(false)}
        >
          <p>
            {data.goals.filter(hasGoalContent).length}개의 목표를{" "}
            {validStart
              ? range(start, addDays(start, weekCount * 7 - 1))
              : "시작일 선택 후"}{" "}
            동안 실행합니다.
          </p>
          <p className="muted">
            목표와 전술, 1회 완료 조건, 실행 주차가 필요합니다. 비워둔 목표 칸은
            실행에 포함되지 않습니다. 다른 항목은 사용하면서 보완할 수 있어요.
            시작 후에도 다음 주 이후의 계획은 수정할 수 있습니다.
          </p>
          <Button disabled={busy} onClick={activate}>
            저장하고 {weekCount}주 착수
            <ArrowRight size={18} />
          </Button>
        </Modal>
      )}
    </>
  );
}
function SectionTitle({ number, title, description }) {
  return (
    <header className="section-title">
      <span>{number}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}
function TacticEditor({ tactic: t, index, onChange, onRemove, weekCount }) {
  return (
    <div className="tactic-editor">
      <header>
        <strong>전술 {index + 1}</strong>
        <button
          className="icon-button"
          aria-label="전술 삭제"
          onClick={onRemove}
        >
          <X size={16} />
        </button>
      </header>
      <div className="two-col">
        <Field
          label="전술 이름"
          placeholder="예: 주 3회 5km 달리기"
          value={t.title}
          onChange={(e) => onChange({ ...t, title: e.target.value })}
        />
        <Field
          label="1회 완료 조건"
          placeholder="예: 5km를 끝까지 달렸을 때"
          value={t.condition}
          onChange={(e) => onChange({ ...t, condition: e.target.value })}
        />
      </div>
      <div className="tactic-options">
        <label className="field">
          <span>실행 방식</span>
          <select
            value={t.kind}
            onChange={(e) => onChange({ ...t, kind: e.target.value })}
          >
            <option value="weekly">주간 반복</option>
            <option value="daily">매일 1회</option>
            <option value="once">선택 주차마다 1회</option>
          </select>
        </label>
        {t.kind === "weekly" && (
          <Field
            label="주당 횟수"
            type="number"
            min={1}
            max={50}
            value={t.count}
            onChange={(e) => onChange({ ...t, count: +e.target.value })}
          />
        )}
      </div>
      <div className="field">
        <span>실행 주차</span>
        <div className="week-chips">
          {Array.from({ length: weekCount }, (_, i) => i + 1).map((w) => (
            <button
              key={w}
              aria-pressed={t.weeks.includes(w)}
              className={t.weeks.includes(w) ? "on" : ""}
              onClick={() =>
                onChange({
                  ...t,
                  weeks: t.weeks.includes(w)
                    ? t.weeks.filter((x) => x !== w)
                    : [...t.weeks, w].sort((a, b) => a - b),
                })
              }
            >
              {w}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Execution({ cycle, setCycle, run, busy, notify, onDirty }) {
  const weekCount = cycleWeeks(cycle),
    reviewNumber = weekCount + 1;
  const [number, setNumber] = useState(() =>
      Math.max(1, currentWeek(cycle.start_date, new Date(), weekCount)),
    ),
    [week, setWeek] = useState(null),
    [mode, setMode] = useState("day"),
    [day, setDay] = useState(""),
    [schedule, setSchedule] = useState(null),
    [complete, setComplete] = useState(null),
    [review, setReview] = useState(null),
    [reflectionDirty, setReflectionDirty] = useState(false);
  const reviewDirty =
    !!week && JSON.stringify(review) !== JSON.stringify(week.state.review);
  useEffect(() => {
    if (number === reviewNumber) return;
    onDirty(reviewDirty);
    return () => onDirty(false);
  }, [reviewDirty, number]);
  const chooseWeek = (n) => {
    if (
      (reviewDirty || reflectionDirty) &&
      !window.confirm("저장하지 않은 평가를 버리고 이동할까요?")
    )
      return;
    setNumber(n);
  };
  const prefix = `/cycles/${cycle.id}/weeks/${number}`;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [number, mode]);
  useEffect(() => {
    if (number > weekCount || !week) return;
    const refreshDate = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const fresh = await api(prefix);
        // Only refresh the date: retain revisions so another screen's edits still conflict.
        if (fresh.today !== week.today) {
          setWeek((previous) =>
            previous ? { ...previous, today: fresh.today } : previous,
          );
          if (day === week.today && fresh.today <= addDays(week.start, 6))
            setDay(fresh.today);
        }
      } catch {
        /* Regular user actions display connection/session errors. */
      }
    };
    const interval = setInterval(refreshDate, 60000);
    document.addEventListener("visibilitychange", refreshDate);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshDate);
    };
  }, [prefix, week?.today, day]);
  useEffect(() => {
    let live = true;
    setWeek(null);
    if (number <= weekCount)
      run(async () => {
        const w = await api(`/cycles/${cycle.id}/weeks/${number}`);
        if (live) {
          setWeek(w);
          setDay(
            w.today >= w.start && w.today <= addDays(w.start, 6)
              ? w.today
              : w.start,
          );
          setReview(structuredClone(w.state.review));
        }
      });
    return () => {
      live = false;
    };
  }, [number, cycle.version]);
  const apply = (w) => {
    setWeek(w);
    return w;
  };
  const download = () =>
    run(async () => {
      const blob = await api(`${prefix}/calendar.ics`, { blob: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${weekCount}주-${number}주차.ics`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("Apple 캘린더에서 내려받은 파일을 열어주세요.");
    });
  const toggle = (o) => {
    if (o.completed)
      return run(async () =>
        apply(
          await api(`${prefix}/occurrences/${o.id}/completion`, {
            method: "PUT",
            body: { version: week.version, completed: false },
          }),
        ),
      );
    if (o.date === week.today)
      return run(async () =>
        apply(
          await api(`${prefix}/occurrences/${o.id}/completion`, {
            method: "PUT",
            body: { version: week.version, completed: true },
          }),
        ),
      );
    setComplete(o);
  };
  const saveReview = () =>
    run(async () => {
      const w = await api(`${prefix}/review`, {
        method: "PUT",
        body: { ...review, version: week.version },
      });
      apply(w);
      notify("주간 평가를 저장했어요.");
    });
  const start = weekStart(cycle.start_date, number),
    today = week?.today;
  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">{cycle.title}</span>
          <h1>
            {number === reviewNumber ? (
              "잠시 멈추고, 다음을 바라보기."
            ) : (
              <>
                이번 주의 약속을
                <br className="mobile-only" /> 오늘의 실행으로.
              </>
            )}
          </h1>
          <p>
            {number === reviewNumber
              ? `${reviewNumber}주차는 점수 경쟁 없이 돌아보고 회복하는 시간입니다.`
              : "점수는 실행을 확인하고 다음 선택을 돕는 정보입니다."}
          </p>
        </div>
        <div className="week-switch">
          <button
            aria-label="이전 주"
            disabled={number === 1}
            onClick={() => chooseWeek(number - 1)}
          >
            <ChevronLeft size={20} />
          </button>
          <label>
            <select
              aria-label="주차 선택"
              value={number}
              onChange={(e) => chooseWeek(+e.target.value)}
            >
              {Array.from({ length: reviewNumber }, (_, i) => i + 1).map(
                (w) => (
                  <option key={w} value={w}>
                    {w}주차{w === reviewNumber ? " · 회고" : ""}
                  </option>
                ),
              )}
            </select>
            <small>{range(start, addDays(start, 6))}</small>
          </label>
          <button
            aria-label="다음 주"
            disabled={number === reviewNumber}
            onClick={() => chooseWeek(number + 1)}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </header>
      {number === reviewNumber ? (
        <RestWeek
          cycle={cycle}
          setCycle={setCycle}
          run={run}
          busy={busy}
          notify={notify}
          onDirty={(v) => {
            setReflectionDirty(v);
            onDirty(v);
          }}
        />
      ) : !week ? (
        <div className="loading">이번 주 계획을 불러오는 중…</div>
      ) : (
        <>
          <div className="stats">
            <article className="main-stat">
              <div>
                <small>
                  WEEK {String(number).padStart(2, "0")} · 주간 실행 점수
                </small>
                <strong>{percentage(week.score.score)}</strong>
              </div>
              <div
                className="score-ring"
                style={{ "--progress": `${(week.score.score || 0) * 3.6}deg` }}
              >
                <span>
                  {week.score.rows.filter((t) => t.complete).length}
                  <small>/ {week.score.rows.length} 전술 완료</small>
                </span>
              </div>
            </article>
            <article>
              <small>이번 주 실행</small>
              <strong>
                {week.state.occurrences.filter((o) => o.completed).length}
                <em> / {week.state.occurrences.length}회</em>
              </strong>
              <p>전술별 실행률을 같은 비중으로 평가</p>
            </article>
            <article>
              <small>아직 배치하지 않은 실행</small>
              <strong>
                {week.state.occurrences.filter((o) => !o.date).length}
                <em>회</em>
              </strong>
              <button
                className="text-button"
                onClick={() => setMode("schedule")}
              >
                모범 주간을 보며 배치
                <ArrowRight size={16} />
              </button>
            </article>
          </div>
          <div className="tabs execution-tabs">
            <button
              className={mode === "day" ? "active" : ""}
              onClick={() => setMode("day")}
            >
              <Check size={17} />
              일간 실행 · 10분
            </button>
            <button
              className={mode === "schedule" ? "active" : ""}
              onClick={() => setMode("schedule")}
            >
              <CalendarDays size={17} />
              주간 일정
            </button>
            <button
              className={mode === "review" ? "active" : ""}
              onClick={() => setMode("review")}
            >
              <BookOpen size={17} />
              주간 평가 · 30분
            </button>
          </div>
          {mode === "day" && (
            <>
              <Guide ids={["moment"]} />
              <div className="day-strip">
                {week.daily.map((d, i) => (
                  <button
                    key={d.date}
                    className={`${day === d.date ? "selected" : ""} ${d.date === today ? "today" : ""}`}
                    onClick={() => setDay(d.date)}
                  >
                    <small>
                      {weekdays[i]}
                      {d.date === today ? " · 오늘" : ""}
                    </small>
                    <strong>{Number(d.date.slice(8))}</strong>
                    <span>{d.planned ? percentage(d.score) : "계획 없음"}</span>
                  </button>
                ))}
              </div>
              <section className="panel">
                <header className="section-heading">
                  <div>
                    <h2>{shortDate(day)}의 실행</h2>
                    <p className="muted">
                      {day} 04:00부터 다음 날 03:59까지 · 각 항목은 완료 또는
                      미완료
                    </p>
                  </div>
                  <span className="pill">
                    {week.daily.find((d) => d.date === day)?.done} /{" "}
                    {week.daily.find((d) => d.date === day)?.planned} 실행
                  </span>
                </header>
                <div className="task-list">
                  {week.state.occurrences
                    .filter((o) => o.date === day)
                    .sort(
                      (a, b) =>
                        ((+a.time.slice(0, 2) + 20) % 24) -
                          ((+b.time.slice(0, 2) + 20) % 24) ||
                        a.time.localeCompare(b.time),
                    )
                    .map((o) => {
                      const t = week.state.tactics.find(
                        (t) => t.id === o.tacticId,
                      );
                      return (
                        <div
                          className={`task ${o.completed ? "done" : ""}`}
                          key={o.id}
                        >
                          <button
                            className="checkbox"
                            aria-label={`${t.title} ${o.completed ? "완료 취소" : "완료"}`}
                            aria-pressed={o.completed}
                            disabled={
                              busy ||
                              cycle.status === "complete" ||
                              o.date > today
                            }
                            onClick={() => toggle(o)}
                          >
                            {o.completed && <Check size={17} />}
                          </button>
                          <div>
                            <span className="task-meta">
                              {o.time} · {o.minutes}분 · {t.goalTitle}
                            </span>
                            <h3>{t.title}</h3>
                            <p>{t.condition}</p>
                          </div>
                          <button
                            className="icon-button"
                            aria-label={`${t.title} 일정 변경`}
                            disabled={
                              o.completed || cycle.status === "complete"
                            }
                            onClick={() => setSchedule(o)}
                          >
                            <CalendarDays size={18} />
                          </button>
                        </div>
                      );
                    })}
                  {!week.state.occurrences.some((o) => o.date === day) && (
                    <div className="empty-inline">
                      <Sprout size={25} />
                      <p>이날 배치한 실행이 없어요.</p>
                      <button
                        className="text-button"
                        onClick={() => setMode("schedule")}
                      >
                        이번 주 일정을 살펴보기
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="daily-close">
                  <Clock3 size={18} />
                  <p>
                    <strong>하루 마무리, 10분이면 충분해요.</strong>
                    <br />
                    실행 여부를 확인하고 남은 주의 배치를 살펴보세요. 긴 회고를
                    꼭 남길 필요는 없습니다.
                  </p>
                </div>
              </section>
            </>
          )}
          {mode === "schedule" && (
            <>
              <Guide ids={["time", "process"]} />
              <div className="section-heading">
                <div>
                  <h2>모범 주간 위에 이번 주를 배치하세요.</h2>
                  <p className="muted">
                    점선은 모범 주간, 실선은 실제 계획입니다. 시간 블록을 눌러
                    수정하거나 끌어 옮길 수 있어요. 새벽 0–3시 일정은 다음 날
                    새벽입니다.
                  </p>
                </div>
                <Button variant="outlined" onClick={download}>
                  <Download size={16} />
                  Apple 캘린더로 내보내기
                </Button>
              </div>
              <p className="footnote">
                .ics 파일 가져오기 방식입니다. 앱에서 바꾼 일정은 자동
                동기화되지 않으므로, 다시 가져올 때 기존 일정을 확인하세요.
              </p>
              <div className="calendar-schedule-panel">
                <WeekCalendar
                  label="이번 주 일정 캘린더"
                  dates={week.daily.map((d) => d.date)}
                  wrap={false}
                  readonly={cycle.status === "complete"}
                  blocks={[
                    ...cycle.plan.modelWeek.map((b) => ({
                      ...b,
                      id: `model-${b.id}`,
                      background: true,
                    })),
                    ...week.state.occurrences
                      .filter((o) => o.date)
                      .map((o) => ({
                        ...o,
                        day: week.daily.findIndex((d) => d.date === o.date),
                        kind: "actual",
                        title: week.state.tactics.find(
                          (t) => t.id === o.tacticId,
                        ).title,
                        locked: o.completed,
                      })),
                  ]}
                  onEdit={(o) =>
                    setSchedule(
                      week.state.occurrences.find((x) => x.id === o.id),
                    )
                  }
                  onMove={(o, change) =>
                    run(async () => {
                      apply(
                        await api(`${prefix}/occurrences/${o.id}/schedule`, {
                          method: "PUT",
                          body: {
                            version: week.version,
                            date: week.daily[change.day].date,
                            time: change.time,
                            minutes: o.minutes,
                          },
                        }),
                      );
                      notify("일정을 옮겼어요.");
                    })
                  }
                />
              </div>
              <section className="panel">
                <h2>배치할 실행</h2>
                <p className="muted">
                  횟수는 주간 계획으로 정해져 있어요. 같은 주 안에서 실행할
                  날짜와 시간을 선택하세요.
                </p>
                <div className="unscheduled">
                  {week.state.occurrences
                    .filter((o) => !o.date)
                    .map((o) => (
                      <button
                        disabled={cycle.status === "complete"}
                        key={o.id}
                        onClick={() => setSchedule(o)}
                      >
                        <Plus size={16} />
                        {
                          week.state.tactics.find((t) => t.id === o.tacticId)
                            .title
                        }
                        <small>{Number(o.id.split("~")[1]) + 1}회차</small>
                      </button>
                    ))}
                </div>
                {week.state.occurrences.every((o) => o.date) && (
                  <p className="muted">모든 실행을 배치했어요.</p>
                )}
              </section>
            </>
          )}
          {mode === "review" && (
            <>
              <Guide ids={["measure", "ownership"]} />
              <section className="panel">
                <header className="section-heading">
                  <div>
                    <h2>전술별 주간 점수표</h2>
                    <p className="muted">
                      각 전술의 실행률 × 동일한 비중. 일간 점수의 평균이
                      아닙니다.
                    </p>
                  </div>
                  <span className="big-score">
                    {percentage(week.score.score)}
                  </span>
                </header>
                <div className="score-table">
                  <div className="score-row table-head">
                    <span>전술</span>
                    <span>실행</span>
                    <span>실행률</span>
                    <span>점수 기여</span>
                  </div>
                  {week.score.rows.map((t) => (
                    <div className="score-row" key={t.id}>
                      <span>
                        <small>{t.goalTitle}</small>
                        <strong>{t.title}</strong>
                      </span>
                      <span>
                        {t.done}/{t.plannedCount}
                      </span>
                      <span>
                        {percentage(t.rate * 100)}
                        <small>
                          {t.complete
                            ? "완료"
                            : today > addDays(week.start, 6)
                              ? "미완료"
                              : "진행 중"}
                        </small>
                      </span>
                      <span>
                        {Number(t.contribution.toFixed(1))}점
                        <small>비중 {percentage(t.weight)}</small>
                      </span>
                    </div>
                  ))}
                  {!week.score.rows.length && (
                    <p className="muted">
                      이번 주에 배정된 전술이 없어 평가하지 않습니다.
                    </p>
                  )}
                </div>
              </section>
              <section className="panel">
                <h2>실행과 결과를 함께 보기</h2>
                <p className="muted">
                  지표 기록은 실행 점수를 바꾸지 않습니다. 실행했는데 결과가
                  움직이지 않았다면 다음 주의 전술을 검토하세요.
                </p>
                <fieldset
                  disabled={cycle.status === "complete"}
                  className="plan-fields"
                >
                  {weekGoals(week.state).map((g) => {
                    const t = { goalId: g.id, goalTitle: g.title };
                    return (
                      <div className="metric" key={t.goalId}>
                        <h3>{t.goalTitle}</h3>
                        <div className="two-col">
                          {[
                            ["leading", "선행지표 관찰"],
                            ["lagging", "후행지표 관찰"],
                          ].map(([key, label]) => (
                            <Field
                              key={key}
                              label={label}
                              hint={
                                g?.[key] || "측정한 값을 간단히 적어주세요."
                              }
                              value={review?.metrics[t.goalId]?.[key] || ""}
                              onChange={(e) =>
                                setReview((r) => ({
                                  ...r,
                                  metrics: {
                                    ...r.metrics,
                                    [t.goalId]: {
                                      leading: "",
                                      lagging: "",
                                      ...r.metrics[t.goalId],
                                      [key]: e.target.value,
                                    },
                                  },
                                }))
                              }
                            />
                          ))}
                        </div>
                        {g?.measurement && (
                          <p className="footnote">측정 기준: {g.measurement}</p>
                        )}
                      </div>
                    );
                  })}
                  <div className="two-col">
                    <Field
                      area
                      label="실행과 결과에서 발견한 것"
                      hint="점수 설명을 길게 쓰기보다, 다음 선택에 필요한 사실만."
                      value={review?.learned || ""}
                      onChange={(e) =>
                        setReview((r) => ({ ...r, learned: e.target.value }))
                      }
                    />
                    <Field
                      area
                      label="다음 주에 유지하거나 조정할 것"
                      hint="이번 주 미완료는 그대로 남습니다. 다음 주 계획은 새로 판단하세요."
                      value={review?.next || ""}
                      onChange={(e) =>
                        setReview((r) => ({ ...r, next: e.target.value }))
                      }
                    />
                  </div>
                  <div className="section-heading">
                    <span className="muted">
                      {week.state.reviewSavedAt
                        ? "평가 기록이 저장되어 있어요."
                        : "선택한 항목만 기록해도 됩니다."}
                    </span>
                    <Button disabled={busy} onClick={saveReview}>
                      <Save size={17} />
                      주간 평가 저장
                    </Button>
                  </div>
                </fieldset>
              </section>
            </>
          )}
          {schedule && (
            <ScheduleModal
              occurrence={schedule}
              tactic={week.state.tactics.find(
                (t) => t.id === schedule.tacticId,
              )}
              week={week}
              busy={busy}
              onClose={() => setSchedule(null)}
              onSave={(input) =>
                run(async () => {
                  apply(
                    await api(`${prefix}/occurrences/${schedule.id}/schedule`, {
                      method: "PUT",
                      body: { ...input, version: week.version },
                    }),
                  );
                  setSchedule(null);
                  notify("일정을 저장했어요.");
                })
              }
            />
          )}
          {complete && (
            <CompletionModal
              occurrence={complete}
              busy={busy}
              onClose={() => setComplete(null)}
              onSave={(executedAt) =>
                run(async () => {
                  apply(
                    await api(
                      `${prefix}/occurrences/${complete.id}/completion`,
                      {
                        method: "PUT",
                        body: {
                          version: week.version,
                          completed: true,
                          executedAt,
                        },
                      },
                    ),
                  );
                  setComplete(null);
                  notify("실행 기록을 저장했어요.");
                })
              }
            />
          )}
        </>
      )}
    </>
  );
}
function ScheduleModal({ occurrence: o, tactic, week, busy, onClose, onSave }) {
  const [date, setDate] = useState(o.date || week.start),
    [time, setTime] = useState(o.time),
    [minutes, setMinutes] = useState(o.minutes);
  return (
    <Modal title="실행할 시간 배치" onClose={onClose}>
      <h3>{tactic.title}</h3>
      <p className="muted">완료 조건: {tactic.condition}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ date, time, minutes });
        }}
      >
        <Field
          label="평가 날짜"
          type="date"
          min={week.start}
          max={addDays(week.start, 6)}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={!!o.requiredDate}
          required
        />
        <div className="two-col">
          <Field
            label="시작 시각"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />
          <Field
            label="예상 시간(분)"
            type="number"
            min={5}
            max={720}
            value={minutes}
            onChange={(e) => setMinutes(+e.target.value)}
            required
          />
        </div>
        <p className="footnote">
          {o.requiredDate
            ? "매일 하는 전술은 날짜를 옮길 수 없습니다."
            : "날짜 변경은 같은 주 안에서 가능합니다."}{" "}
          00:00–03:59를 선택하면 다음 날 새벽에 배치됩니다.
        </p>
        <Button disabled={busy}>
          일정 저장
          <Check size={17} />
        </Button>
      </form>
    </Modal>
  );
}
function CompletionModal({ occurrence, busy, onClose, onSave }) {
  const [time, setTime] = useState(occurrence.time);
  return (
    <Modal title="지난 실행 기록하기" onClose={onClose}>
      <p>{occurrence.date} 평가일에 실제로 실행한 시각을 입력하세요.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(calendarInstant(occurrence.date, time).toISOString());
        }}
      >
        <Field
          label="실제 실행 시각 · 한국 시간"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
        />
        <p className="footnote">
          새벽 00:00–03:59는 다음 날 새벽입니다. 계획한 시각이 아니라 실제
          실행한 시각을 기록하세요.
        </p>
        <Button disabled={busy}>
          실행 완료 기록
          <Check size={17} />
        </Button>
      </form>
    </Modal>
  );
}
function RestWeek({ cycle, setCycle, run, busy, notify, onDirty }) {
  const weekCount = cycleWeeks(cycle);
  const [summary, setSummary] = useState([]),
    [reflection, setReflection] = useState({
      results: cycle.reflection?.results || "",
      lessons: cycle.reflection?.lessons || "",
      next: cycle.reflection?.next || "",
    });
  const dirty = ["results", "lessons", "next"].some(
    (k) => reflection[k] !== (cycle.reflection?.[k] || ""),
  );
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty]);
  useEffect(() => {
    run(async () => {
      const weeks = await Promise.all(
        Array.from({ length: weekCount }, (_, i) =>
          api(`/cycles/${cycle.id}/weeks/${i + 1}`),
        ),
      );
      setSummary(weeks);
    });
  }, [cycle.id, weekCount]);
  async function save() {
    const c = await api(`/cycles/${cycle.id}/reflection`, {
      method: "PUT",
      body: { ...reflection, version: cycle.version },
    });
    setCycle(c);
    notify(`${weekCount}주 회고를 저장했어요.`);
    return c;
  }
  return (
    <>
      <Guide ids={["measure", "vision"]} />
      <section className="panel">
        <h2>{weekCount}주 동안 쌓인 실행</h2>
        <div className="season-chart">
          {summary.map((w) => (
            <div key={w.number}>
              <span>
                {w.score.score === null ? "—" : Math.round(w.score.score)}
              </span>
              <i style={{ height: `${Math.max(3, w.score.score || 0)}px` }} />
              <small>{w.number}주</small>
            </div>
          ))}
        </div>
        <p className="muted">
          잘된 선택, 효과가 없었던 전술, 회복에 필요한 조건을 돌아보세요. 이전
          주의 평가 기록을 다시 읽고 다음 목표를 천천히 고르면 됩니다.
        </p>
        <fieldset
          disabled={cycle.status === "complete"}
          className="plan-fields"
        >
          <div className="rest-prompts">
            {[
              ["results", `이번 ${weekCount}주에 실제로 달라진 것은?`],
              ["lessons", "유지할 행동과 그만둘 행동은?"],
              ["next", "회복한 뒤 향하고 싶은 방향은?"],
            ].map(([key, label]) => (
              <Field
                area
                key={key}
                label={label}
                value={reflection[key]}
                onChange={(e) =>
                  setReflection((r) => ({ ...r, [key]: e.target.value }))
                }
              />
            ))}
          </div>
          <Button variant="light" disabled={busy} onClick={() => run(save)}>
            <Save size={17} />
            {weekCount}주 회고 저장
          </Button>
        </fieldset>
        <p className="footnote">
          {weekCount + 1}주차에는 실행 점수를 만들지 않습니다. 회고 입력은 선택
          사항입니다. 마무리하면 기록을 보관하고 새로운 주기를 시작할 수 있어요.
        </p>
        <Button
          disabled={
            busy ||
            cycle.status === "complete" ||
            currentWeek(cycle.start_date, new Date(), weekCount) < weekCount + 1
          }
          onClick={() =>
            run(async () => {
              if (dirty) await save();
              setCycle(
                await api(`/cycles/${cycle.id}/finish`, { method: "POST" }),
              );
            })
          }
        >
          {cycle.status === "complete"
            ? `마무리한 ${weekCount}주`
            : `이 ${weekCount}주 마무리하기`}
          <Flag size={17} />
        </Button>
      </section>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);

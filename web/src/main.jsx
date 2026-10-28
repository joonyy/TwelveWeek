import React, {
  useEffect,
  useState,
  useRef,
  useId,
  lazy,
  Suspense,
} from "react";
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
  LoaderCircle,
  CircleHelp,
  Trash2,
  Clock3,
  Flag,
  KeyRound,
} from "lucide-react";
import { api, token } from "./api.js";
import {
  activateSession,
  rememberedSession,
  selectAnotherProfile,
  forgetCurrentSession,
  forgetRememberedSession,
} from "./sessions.js";
import {
  readNavigation,
  writeNavigation,
  clearNavigation,
} from "./navigation.js";
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
  hasScheduledTime,
  occurrenceLabel,
} from "../../shared/domain.js";
import {
  newGoal,
  newTactic,
  editablePlan,
  hasGoalContent,
  hasTacticContent,
  planWithinWeeks,
  modelWeekFor,
  timetableForWeek,
  withWeekModel,
} from "../../shared/planning.js";
import {
  VisionEditor,
  ModelWeekEditor,
  ResponsibilityEditor,
  CommitmentWheel,
  WeekCalendar,
  EXECUTION_DRAG_TYPE,
} from "./PlanningWidgets.jsx";
import DaySchedule from "./DaySchedule.jsx";
import CurrentWeekPlan from "./CurrentWeekPlan.jsx";
import DayTemplateSession, { DayTemplateLibrary } from "./DayTemplates.jsx";
import LifeAttitude from "./LifeAttitude.jsx";
import ExecutionPicker from "./ExecutionPicker.jsx";
import QuickTacticForm from "./QuickTacticForm.jsx";
import { FocusTimerProvider } from "./FocusTimer.jsx";
import "./style.css";
import { VisionAssistant, AIConnectionConsent } from "./VisionAssistant.jsx";
import WritingGuide from "./WritingGuide.jsx";
import WeeklyPlanPreview from "./WeeklyPlanPreview.jsx";
import PlanTimeline from "./PlanTimeline.jsx";
import { ReadingNotebook, ReadingRecordModal } from "./ReadingNotes.jsx";
import GoalReferenceLink from "./GoalReferenceLink.jsx";
const CalendarMergePlanner = lazy(() => import("./CalendarMergePlanner.jsx"));
const CalendarImport = lazy(() => import("./CalendarImport.jsx"));
import { updateVision } from "../../shared/vision-links.js";
import {
  VisionReference,
  GoalVisionLinks,
  GoalVisionSummary,
} from "./GoalVisionLinks.jsx";

function connectionRequest() {
  const raw = new URLSearchParams(location.search).get("ai_authorize");
  if (!raw) return null;
  try {
    const bytes = Uint8Array.from(
      atob(raw.replaceAll("-", "+").replaceAll("_", "/")),
      (c) => c.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

const uid = () => crypto.randomUUID();
const cycleWeeks = (cycle) => cycle.week_count ?? DEFAULT_WEEK_COUNT;
const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
const shortDate = (d) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
const range = (start, end) => `${shortDate(start)} — ${shortDate(end)}`;
function Field({ label, hint, area = false, ...props }) {
  const hintId = useId();
  return (
    <label className="field">
      <span>{label}</span>
      {hint && <small id={hintId}>{hint}</small>}
      {area ? (
        <textarea
          aria-label={label}
          aria-describedby={hint ? hintId : undefined}
          rows={3}
          {...props}
        />
      ) : (
        <input
          aria-label={label}
          aria-describedby={hint ? hintId : undefined}
          {...props}
        />
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
function Modal({ title, children, onClose, className = "" }) {
  const container = useRef(null);
  const backdropGesture = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const initial =
      container.current?.querySelector(
        "input:not(:disabled):not([readonly]), textarea:not(:disabled)",
      ) || container.current?.querySelector("button");
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
      onPointerDownCapture={(e) => {
        backdropGesture.current =
          e.isPrimary && e.button === 0
            ? {
                pointerId: e.pointerId,
                startedOutside: e.target === e.currentTarget,
                endedOutside: false,
              }
            : null;
      }}
      onPointerUpCapture={(e) => {
        const gesture = backdropGesture.current;
        if (gesture?.pointerId === e.pointerId)
          gesture.endedOutside =
            e.target === e.currentTarget &&
            document.elementFromPoint(e.clientX, e.clientY) === e.currentTarget;
      }}
      onPointerCancelCapture={() => {
        backdropGesture.current = null;
      }}
      onClick={(e) => {
        // Dragging text can synthesize a click on the common ancestor (the
        // backdrop). Dismiss only when both ends of this gesture were outside.
        const gesture = backdropGesture.current;
        backdropGesture.current = null;
        if (
          gesture?.startedOutside &&
          gesture.endedOutside &&
          e.target === e.currentTarget
        )
          onClose();
      }}
    >
      <section
        ref={container}
        className={`modal ${className}`}
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
  const navigationEpoch = useRef(0);
  const [profile, setProfile] = useState(null),
    [ready, setReady] = useState(false),
    [cycle, setCycle] = useState(null),
    [view, setView] = useState("plan"),
    [error, setError] = useState(""),
    [restoreError, setRestoreError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [principles, setPrinciples] = useState(false),
    [passwordSettings, setPasswordSettings] = useState(false),
    [editing, setEditing] = useState(false),
    [aiAuthorization, setAIAuthorization] = useState(connectionRequest);
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
        navigationEpoch.current++;
        forgetCurrentSession(profile?.id);
        clearNavigation();
        setRestoreError("");
        setProfile(null);
        setCycle(null);
        setPasswordSettings(false);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    (async () => {
      const existingToken = token();
      if (existingToken) {
        await run(async () => {
          const me = await api("/me", { authToken: existingToken });
          activateSession({ token: existingToken, profile: me.profile });
          setProfile(me.profile);
          const saved = readNavigation();
          if (saved.cycle && !connectionRequest()) {
            try {
              const c = await api(`/cycles/${saved.cycle}`);
              setCycle(c);
              setView(c.status === "draft" ? "plan" : saved.view || "week");
            } catch (e) {
              if (e.status === 404) clearNavigation();
              else {
                setRestoreError(`이전 화면을 복원하지 못했어요. ${e.message}`);
                throw e;
              }
            }
          }
        });
      } else clearNavigation();
      setReady(true);
    })();
  }, []);
  useEffect(() => {
    if (ready && !profile) clearNavigation();
    else if (ready && profile && cycle && !aiAuthorization)
      writeNavigation({ cycle: cycle.id, view });
  }, [ready, profile?.id, cycle?.id, view, aiAuthorization]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(id);
  }, [notice]);
  const open = async (id) => {
    const epoch = ++navigationEpoch.current;
    return run(async () => {
      const c = await api(`/cycles/${id}`);
      if (epoch !== navigationEpoch.current) return;
      setRestoreError("");
      writeNavigation({
        cycle: c.id,
        view: c.status === "draft" ? "plan" : "week",
      });
      setCycle(c);
      setView(c.status === "draft" ? "plan" : "week");
    });
  };
  const logout = () => {
    navigationEpoch.current++;
    return run(async () => {
      try {
        await api("/sessions/current", { method: "DELETE" });
      } finally {
        forgetCurrentSession(profile?.id);
        clearNavigation();
        setRestoreError("");
        setProfile(null);
        setCycle(null);
        setPasswordSettings(false);
      }
    });
  };
  const switchProfile = () => {
    navigationEpoch.current++;
    selectAnotherProfile();
    clearNavigation();
    setRestoreError("");
    setProfile(null);
    setCycle(null);
    setPasswordSettings(false);
  };
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
              navigate(() => {
                navigationEpoch.current++;
                clearNavigation();
                setRestoreError("");
                setCycle(null);
              });
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
                  onClick={() =>
                    navigate(() => {
                      navigationEpoch.current++;
                      clearNavigation();
                      setRestoreError("");
                      setCycle(null);
                    })
                  }
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
              <>
                <button
                  className="logout"
                  onClick={() => setPasswordSettings(true)}
                >
                  <KeyRound size={15} />
                  계정 설정
                </button>
                <button
                  className="logout"
                  onClick={() => navigate(switchProfile)}
                >
                  <LogOut size={15} />
                  유저 전환
                </button>
                <button className="logout" onClick={() => navigate(logout)}>
                  <LogOut size={15} />
                  로그아웃
                </button>
              </>
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
          {(error || restoreError) && (
            <div role="alert" className="error">
              {error || restoreError}
              <button
                onClick={() => {
                  setError("");
                  setRestoreError("");
                }}
                aria-label="오류 닫기"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!profile ? (
            <Entry onLogin={setProfile} run={run} busy={busy} />
          ) : aiAuthorization ? (
            <AIConnectionConsent
              request={aiAuthorization}
              onCancel={() => {
                const url = new URL(location.href);
                url.searchParams.delete("ai_authorize");
                history.replaceState(null, "", url);
                setAIAuthorization(null);
              }}
            />
          ) : !cycle ? (
            <CycleList
              open={open}
              run={run}
              busy={busy}
              onCreated={(c) => {
                writeNavigation({ cycle: c.id, view: "plan" });
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
      {passwordSettings && profile && (
        <AccountSettings
          profile={profile}
          run={run}
          busy={busy}
          onClose={() => setPasswordSettings(false)}
          notify={setNotice}
          onDeleted={() => {
            navigationEpoch.current++;
            forgetCurrentSession(profile.id);
            clearNavigation();
            setRestoreError("");
            setEditing(false);
            setProfile(null);
            setCycle(null);
            setPasswordSettings(false);
            setNotice("계정과 저장된 기록을 삭제했어요.");
          }}
        />
      )}
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
    [name, setName] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [selected, setSelected] = useState(null),
    [password, setPassword] = useState(""),
    [loginError, setLoginError] = useState(""),
    [entryReady, setEntryReady] = useState(false);
  const loadEntry = () =>
    run(async () => {
      setProfiles(await api("/profiles"));
      setEntryReady(true);
    });
  useEffect(() => {
    loadEntry();
  }, []);
  const enter = (e) => {
    e.preventDefault();
    setLoginError("");
    run(async () => {
      try {
        const session = await api("/sessions", {
          method: "POST",
          body: { profileId: selected.id, password },
        });
        activateSession(session);
        setPassword("");
        onLogin(session.profile);
      } catch (e) {
        setLoginError(e.message);
      }
    });
  };
  const create = (e) => {
    e.preventDefault();
    run(async () => {
      const p = await api("/profiles", {
        method: "POST",
        body: { name, password: newPassword },
      });
      setProfiles((prev) => [...prev, p]);
      setName("");
      const s = await api("/sessions", {
        method: "POST",
        body: { profileId: p.id, password: newPassword },
      });
      activateSession(s);
      setNewPassword("");
      onLogin(s.profile);
    });
  };
  const chooseProfile = (p) => {
    setPassword("");
    setLoginError("");
    const saved = rememberedSession(p.id);
    if (!saved) {
      setSelected(p);
      return;
    }
    run(async () => {
      try {
        const me = await api("/me", { authToken: saved.token });
        if (me.profile.id !== p.id) {
          forgetRememberedSession(p.id);
          setSelected(p);
          return;
        }
        activateSession({ ...saved, profile: me.profile });
        onLogin(me.profile);
      } catch (e) {
        if (e.status !== 401) throw e;
        forgetRememberedSession(p.id);
        setSelected(p);
      }
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
        {!entryReady ? (
          <>
            <h2>나의 공간에 연결하는 중…</h2>
            <p className="muted">서버가 준비되면 이어서 시작할 수 있어요.</p>
            <Button disabled={busy} onClick={loadEntry}>
              다시 연결
            </Button>
          </>
        ) : (
          <>
            <h2>유저를 선택하세요.</h2>
            <p className="muted">
              이름을 선택하세요. 이 기기에서 로그인한 계정은 바로 이어집니다.
            </p>
            {profiles.length > 0 && (
              <div className="profile-list">
                {profiles.map((p) => (
                  <button
                    disabled={busy}
                    key={p.id}
                    onClick={() => chooseProfile(p)}
                  >
                    <span className="avatar">{p.name.slice(0, 1)}</span>
                    <span className="profile-choice-name">
                      <strong>{p.name}</strong>
                      {rememberedSession(p.id) && (
                        <small>이 기기에 로그인됨</small>
                      )}
                    </span>
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
                autoComplete="username"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Field
                label="새 유저 비밀번호"
                hint="4자 이상으로 입력해주세요."
                type="password"
                minLength={4}
                maxLength={128}
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <Button
                disabled={busy || !name.trim() || newPassword.length < 4}
                type="submit"
              >
                나의 공간 만들기
                <ArrowRight size={18} />
              </Button>
            </form>
            <p className="footnote">
              로그인은 이 브라우저에서 기본 365일 유지됩니다. 공용 기기에서는
              사용 후 로그아웃하세요. 다른 기기·브라우저는 첫 로그인 때
              비밀번호가 필요합니다.
            </p>
          </>
        )}
      </section>
      {selected && (
        <Modal
          title={`${selected.name} 로그인`}
          onClose={() => setSelected(null)}
        >
          <form onSubmit={enter}>
            <Field
              label="로그인 이름"
              autoComplete="username"
              value={selected.name}
              readOnly
            />
            <Field
              label="비밀번호"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {loginError && (
              <p className="error" role="alert">
                {loginError}
              </p>
            )}
            <Button type="submit" disabled={busy || !password}>
              로그인 <ArrowRight size={18} />
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function AccountSettings({ profile, run, busy, onClose, notify, onDeleted }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deletionPassword, setDeletionPassword] = useState("");
  const [confirmationName, setConfirmationName] = useState("");
  const [deletionAcknowledged, setDeletionAcknowledged] = useState(false);
  const [deletionError, setDeletionError] = useState("");
  const save = (e) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmation) {
      setError("새 비밀번호가 일치하지 않아요.");
      return;
    }
    run(async () => {
      try {
        await api("/me/password", {
          method: "PUT",
          body: { currentPassword, newPassword },
        });
        onClose();
        notify("비밀번호를 변경했어요.");
      } catch (e) {
        if (e.status === 401) throw e;
        setError(e.message);
      }
    });
  };
  const deleteAccount = (e) => {
    e.preventDefault();
    if (!deletionAcknowledged || busy) return;
    setDeletionError("");
    run(async () => {
      try {
        await api("/me", {
          method: "DELETE",
          body: { currentPassword: deletionPassword, confirmationName },
        });
        onDeleted();
      } catch (e) {
        if (e.status === 401) throw e;
        setDeletionError(e.message);
      }
    });
  };
  return (
    <Modal title="계정 설정" onClose={() => !busy && onClose()}>
      <p>
        <strong>{profile.name}</strong>님의 계정
      </p>
      <section aria-label="비밀번호 재설정">
        <h3>비밀번호 재설정</h3>
        <form onSubmit={save}>
          <Field
            label="현재 비밀번호"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <Field
            label="새 비밀번호"
            type="password"
            autoComplete="new-password"
            required
            minLength={4}
            maxLength={128}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Field
            label="새 비밀번호 확인"
            type="password"
            autoComplete="new-password"
            required
            minLength={4}
            maxLength={128}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <p className="footnote">
            변경 후 다른 기기에서는 새 비밀번호로 다시 로그인해주세요.
          </p>
          <Button type="submit" disabled={busy}>
            비밀번호 저장 <Check size={18} />
          </Button>
        </form>
      </section>
      <section className="account-danger-zone" aria-label="계정 삭제">
        <h3>계정 삭제</h3>
        <p>
          이 계정의 모든 주기·비전·목표·전술·실행·평가·독서 기록·AI 대화와
          저장된 연결 정보를 삭제합니다. 모든 기기에서 로그아웃되며 앱에서
          복구할 수 없습니다. 다른 사용자의 계정은 삭제되지 않습니다.
        </p>
        <p className="footnote">
          외부 캘린더나 블로그에 이미 보낸 내용은 삭제되지 않습니다.
        </p>
        {!deleting ? (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => setDeleting(true)}
          >
            계정 삭제 진행 <Trash2 size={17} />
          </Button>
        ) : (
          <form onSubmit={deleteAccount}>
            <Field
              label="삭제 확인 이름"
              hint={`현재 계정 이름 ‘${profile.name}’을 입력해주세요.`}
              value={confirmationName}
              onChange={(e) => setConfirmationName(e.target.value)}
              autoComplete="off"
              autoFocus
              required
              maxLength={32}
            />
            <Field
              label="계정 삭제용 현재 비밀번호"
              type="password"
              autoComplete="current-password"
              value={deletionPassword}
              onChange={(e) => setDeletionPassword(e.target.value)}
              required
              maxLength={128}
            />
            <label className="account-deletion-consent">
              <input
                type="checkbox"
                checked={deletionAcknowledged}
                onChange={(e) => setDeletionAcknowledged(e.target.checked)}
              />
              계정과 모든 기록이 삭제되고 앱에서 복구할 수 없음을 확인했습니다.
            </label>
            {deletionError && (
              <p role="alert" className="error">
                {deletionError}
              </p>
            )}
            <Button
              variant="danger"
              type="submit"
              disabled={
                busy ||
                !deletionAcknowledged ||
                !deletionPassword ||
                confirmationName.normalize("NFKC").trim() !== profile.name
              }
            >
              계정과 모든 기록 영구 삭제 <Trash2 size={17} />
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDeleting(false);
                setDeletionPassword("");
                setConfirmationName("");
                setDeletionAcknowledged(false);
                setDeletionError("");
              }}
            >
              삭제 취소
            </Button>
          </form>
        )}
      </section>
    </Modal>
  );
}

function CycleList({ open, run, busy, onCreated }) {
  const [list, setList] = useState([]),
    [creating, setCreating] = useState(false),
    [title, setTitle] = useState("나의 첫 12주"),
    [start, setStart] = useState(DEFAULT_START),
    [weekCount, setWeekCount] = useState(DEFAULT_WEEK_COUNT);
  const [deletingCycle, setDeletingCycle] = useState(null);
  const [deleteError, setDeleteError] = useState("");
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
  const removeDraft = () => {
    if (!deletingCycle || busy) return;
    setDeleteError("");
    run(async () => {
      try {
        await api(`/cycles/${deletingCycle.id}`, {
          method: "DELETE",
          body: { version: deletingCycle.version },
        });
        setList((previous) =>
          previous.filter((c) => c.id !== deletingCycle.id),
        );
        setDeletingCycle(null);
      } catch (e) {
        if (e.status === 401) throw e;
        setDeleteError(e.message);
      }
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
          <article
            className="cycle-list-item"
            key={c.id}
            aria-label={`${c.title} · ${c.start_date}`}
          >
            <button className="cycle-card" onClick={() => open(c.id)}>
              <span className={`pill ${c.status}`}>
                {
                  { draft: "작성 중", active: "실행 중", complete: "마침" }[
                    c.status
                  ]
                }
              </span>
              <h2>{c.title}</h2>
              <p>
                {c.start_date} — {addDays(c.start_date, cycleWeeks(c) * 7 - 1)}{" "}
                · {cycleWeeks(c)}주 실행
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
            {c.status === "draft" && (
              <button
                className="cycle-delete-button danger"
                disabled={busy}
                onClick={() => {
                  setDeleteError("");
                  setDeletingCycle(c);
                }}
              >
                <Trash2 size={15} /> 초안 삭제
              </button>
            )}
          </article>
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
      {deletingCycle && (
        <Modal
          title="작성 중인 초안 삭제"
          onClose={() => !busy && setDeletingCycle(null)}
        >
          <h3>{deletingCycle.title}</h3>
          <p>
            {deletingCycle.start_date} —{" "}
            {addDays(
              deletingCycle.start_date,
              cycleWeeks(deletingCycle) * 7 - 1,
            )}{" "}
            · {cycleWeeks(deletingCycle)}주
          </p>
          <p>
            이 초안에 작성한 비전·목표·계획·AI 대화를 삭제합니다. 앱에서 복구할
            수 없습니다.
          </p>
          {deleteError && (
            <p className="error" role="alert">
              {deleteError}
            </p>
          )}
          <Button variant="danger" disabled={busy} onClick={removeDraft}>
            이 초안 삭제
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setDeletingCycle(null)}
          >
            취소
          </Button>
          {deleteError && (
            <Button
              variant="light"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  setList(await api("/cycles"));
                  setDeletingCycle(null);
                })
              }
            >
              목록 새로고침
            </Button>
          )}
        </Modal>
      )}
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
  const [initialNavigation] = useState(() => readNavigation(cycle.id));
  const [data, setData] = useState(() =>
      editablePlan(cycle.plan, {
        draft: cycle.status === "draft",
        weekCount: cycleWeeks(cycle),
      }),
    ),
    [title, setTitle] = useState(cycle.title),
    [start, setStart] = useState(cycle.start_date),
    [weekCount, setWeekCount] = useState(cycleWeeks(cycle)),
    [tab, setTab] = useState(initialNavigation.tab ?? 0),
    [planView, setPlanView] = useState(initialNavigation.planView ?? "goal"),
    [planWeek, setPlanWeek] = useState(
      Math.max(1, Math.min(cycleWeeks(cycle), initialNavigation.planWeek ?? 1)),
    ),
    [calendarSession, setCalendarSession] = useState(null),
    [calendarBusy, setCalendarBusy] = useState(false),
    [selectedGoalId, setSelectedGoalId] = useState(
      initialNavigation.goal ?? null,
    ),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [starting, setStarting] = useState(false),
    [remoteCycle, setRemoteCycle] = useState(null);
  const tabs = [
    "비전",
    `${weekCount}주 목표`,
    `${weekCount}주 계획`,
    "모범 주간",
    "삶의 태도",
  ];
  const planningGoals = data.goals.filter(hasGoalContent);
  const selectedGoal =
    planningGoals.find((g) => g.id === selectedGoalId) || planningGoals[0];
  useEffect(() => {
    writeNavigation({
      cycle: cycle.id,
      view: "plan",
      tab,
      planView,
      planWeek,
      goal: selectedGoal?.id,
    });
  }, [cycle.id, tab, planView, planWeek, selectedGoal?.id]);
  const validStart = /^\d{4}-\d{2}-\d{2}$/.test(start);
  const minimumWeeks =
    cycle.status === "active"
      ? Math.min(cycleWeeks(cycle), Math.max(1, currentWeek(cycle.start_date)))
      : 1;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab, planView]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty]);
  const change = (key, value) => {
    setData((p) => ({ ...p, [key]: value }));
    setDirty(true);
  };
  const visionChange = (area, value, edit) => {
    setData((p) => updateVision(p, area, value, edit));
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
    setSaving(true);
    try {
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
      setRemoteCycle(null);
      notify("계획을 저장했어요.");
      return c;
    } finally {
      setSaving(false);
    }
  }
  const acceptRemote = (fresh) => {
    if (fresh.version <= cycle.version) return;
    if (!dirty) {
      setData(
        editablePlan(fresh.plan, {
          draft: fresh.status === "draft",
          weekCount: cycleWeeks(fresh),
        }),
      );
      setTitle(fresh.title);
      setStart(fresh.start_date);
      setWeekCount(cycleWeeks(fresh));
      setCycle(fresh);
      setRemoteCycle(null);
      return;
    }
    const onlyVision =
      fresh.title === cycle.title &&
      fresh.start_date === cycle.start_date &&
      cycleWeeks(fresh) === cycleWeeks(cycle) &&
      JSON.stringify({ ...fresh.plan, longVision: cycle.plan.longVision }) ===
        JSON.stringify(cycle.plan);
    if (onlyVision && data.longVision === cycle.plan.longVision) {
      setData((p) => ({ ...p, longVision: fresh.plan.longVision }));
      setCycle(fresh);
      setRemoteCycle(null);
    } else setRemoteCycle(fresh);
  };
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
      {remoteCycle && (
        <div className="info-note" role="status">
          AI 또는 다른 화면에서 저장된 내용이 바뀌었어요. 현재 작성 중인 내용은
          유지하고 있어요.
          <Button
            onClick={() => {
              if (
                !window.confirm(
                  "현재 저장하지 않은 편집을 버리고 최신 저장 내용을 불러올까요?",
                )
              )
                return;
              setDirty(false);
              setData(
                editablePlan(remoteCycle.plan, {
                  draft: remoteCycle.status === "draft",
                  weekCount: cycleWeeks(remoteCycle),
                }),
              );
              setTitle(remoteCycle.title);
              setStart(remoteCycle.start_date);
              setWeekCount(cycleWeeks(remoteCycle));
              setCycle(remoteCycle);
              setRemoteCycle(null);
            }}
          >
            최신 저장 내용 불러오기
          </Button>
        </div>
      )}
      {tab === 2 && (
        <>
          <Guide ids={["plan", "commitment"]} />
          <SectionTitle
            number="04–07"
            title={`${planView === "week" ? "주차별" : "목표별"} ${weekCount}주 계획`}
            description={
              planView === "week"
                ? "한 주에 약속한 전술을 모든 목표에서 모아 봅니다. 주마다 실행할 내용과 횟수를 함께 확인하세요."
                : "목표 전체를 보면서, 각 목표를 이루기 위한 행동을 정하세요. 목표를 선택하면 그 목표의 계획을 이어서 작성할 수 있어요."
            }
          />
          <div className="goal-plan-overview">
            <div className="section-heading">
              <p className="muted">
                이번 {weekCount}주의 목표 {planningGoals.length}개
              </p>
              <div className="plan-view-controls">
                <div
                  className="format-switch"
                  role="group"
                  aria-label="계획 보기 방식"
                >
                  <button
                    type="button"
                    aria-pressed={planView === "goal"}
                    onClick={() => setPlanView("goal")}
                  >
                    목표별
                  </button>
                  <button
                    type="button"
                    aria-pressed={planView === "week"}
                    onClick={() => setPlanView("week")}
                  >
                    주차별
                  </button>
                </div>
                <Button variant="light" onClick={() => setTab(1)}>
                  <ChevronLeft size={15} />
                  목표 목록 수정
                </Button>
              </div>
            </div>
            {planView === "goal" &&
              (planningGoals.length ? (
                <nav
                  className="goal-plan-selector"
                  aria-label="목표별 계획 선택"
                >
                  {planningGoals.map((g) => (
                    <button
                      type="button"
                      className="goal-plan-choice"
                      key={g.id}
                      aria-pressed={selectedGoal?.id === g.id}
                      onClick={() => setSelectedGoalId(g.id)}
                    >
                      <span className="eyebrow">
                        GOAL{" "}
                        {String(
                          data.goals.findIndex((x) => x.id === g.id) + 1,
                        ).padStart(2, "0")}
                      </span>
                      <strong>{g.title.trim() || "이름 없는 목표"}</strong>
                      <small>
                        전술 {g.tactics.filter(hasTacticContent).length}개
                      </small>
                    </button>
                  ))}
                </nav>
              ) : (
                <p className="goal-plan-empty">
                  먼저 목표 화면에서 이번 {weekCount}주에 이루고 싶은 목표를
                  나열해주세요.
                </p>
              ))}
          </div>
          {planView === "week" && (
            <WeeklyPlanPreview
              plan={data}
              start={start}
              weekCount={weekCount}
              week={planWeek}
              onSelectWeek={setPlanWeek}
              status={cycle.status}
              onEditGoal={(id) => {
                setSelectedGoalId(id);
                setPlanView("goal");
              }}
              calendarLabel={
                dirty
                  ? "저장하고 Apple Calendar와 비교"
                  : "Apple Calendar와 비교"
              }
              calendarDisabled={busy || cycle.status === "complete"}
              onCalendar={() =>
                run(async () => {
                  const fresh = dirty
                    ? await save()
                    : await api(`/cycles/${cycle.id}`);
                  if (!dirty) acceptRemote(fresh);
                  setCalendarSession({
                    cycle: fresh,
                    week: Math.min(planWeek, cycleWeeks(fresh)),
                  });
                })
              }
            />
          )}
        </>
      )}
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
              <WritingGuide step="longVision" weekCount={weekCount} />
              <div className="vision-workspace">
                <div>
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
                </div>
                {cycle.status !== "complete" && (
                  <VisionAssistant
                    cycle={cycle}
                    dirty={dirty}
                    onSave={save}
                    onRemote={acceptRemote}
                  />
                )}
              </div>
            </section>
            <section className="panel">
              <SectionTitle
                number="02"
                title="3년 뒤의 나"
                description="장기 비전에 가까워진 모습을 개인 생활과 일의 관점에서 구체화하세요."
              />
              <WritingGuide step="threeYear" weekCount={weekCount} />
              <div className="two-col">
                <VisionEditor
                  label="개인 생활의 비전"
                  linkable
                  value={data.personalVision}
                  mode={data.visionModes.personalVision}
                  onChange={(v, edit) =>
                    visionChange("personalVision", v, edit)
                  }
                  onMode={(mode) =>
                    change("visionModes", {
                      ...data.visionModes,
                      personalVision: mode,
                    })
                  }
                />
                <VisionEditor
                  label="커리어의 비전"
                  linkable
                  value={data.careerVision}
                  mode={data.visionModes.careerVision}
                  onChange={(v, edit) => visionChange("careerVision", v, edit)}
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
            <Guide ids={["vision"]} />
            <SectionTitle
              number="03"
              title={`이번 ${weekCount}주의 목표`}
              description="3년 비전을 보면서 이번에 이루고 싶은 결과를 먼저 나열하세요. 목표가 어떤 비전에 연결되는지 선택하고, 다음 화면에서 목표별 계획을 세웁니다."
            />
            <div className="goal-vision-workspace">
              <VisionReference plan={data} onEdit={() => setTab(0)} />
              <section
                className="panel goal-list-panel"
                aria-label={`${weekCount}주 목표 목록`}
              >
                <WritingGuide step="goals" weekCount={weekCount} />
                <div className="goal-list">
                  {data.goals.map((g, index) => (
                    <div className="goal-list-row" key={g.id}>
                      <span className="goal-list-number" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <Field
                        label={`${weekCount}주 목표 ${index + 1}`}
                        placeholder={`${weekCount}주 뒤 이루고 싶은 결과는 무엇인가요?`}
                        value={g.title}
                        onChange={(e) =>
                          goalChange(g.id, "title", e.target.value)
                        }
                      />
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label={`목표 ${index + 1} 삭제`}
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
                        <Trash2 size={17} />
                      </button>
                      <GoalVisionLinks
                        plan={data}
                        goal={g}
                        number={index + 1}
                        onChange={(links) =>
                          goalChange(g.id, "visionLinks", links)
                        }
                      />
                    </div>
                  ))}
                </div>
                <Button
                  variant="light"
                  onClick={() =>
                    change("goals", [...data.goals, newGoal(weekCount)])
                  }
                >
                  <Plus size={17} />
                  {weekCount}주 목표 추가
                </Button>
                <p className="goal-list-note">
                  지금은 목표 전체의 방향을 봅니다. 성공 기준과 실행 방법은 다음
                  화면에서 구체화해요.
                </p>
              </section>
            </div>
          </>
        )}
        {tab === 2 && planView === "goal" && selectedGoal && (
          <>
            {[selectedGoal].map((g) => (
              <section
                className="panel goal-panel"
                key={g.id}
                aria-label={`${g.title.trim() || "이름 없는 목표"} 계획`}
              >
                <header className="section-heading">
                  <span className="eyebrow">
                    GOAL{" "}
                    {String(
                      data.goals.findIndex((x) => x.id === g.id) + 1,
                    ).padStart(2, "0")}
                  </span>
                </header>
                <h2 className="goal-plan-title">
                  {g.title.trim() || "이름 없는 목표"}
                </h2>
                <GoalVisionSummary plan={data} goal={g} />
                <details className="goal-reference">
                  <summary>기획서 링크 · Notion 등 (선택)</summary>
                  <Field
                    label="목표 기획서 링크"
                    hint="이 목표에 필요한 상세 기획서나 자료의 주소를 연결하세요. 기획서 작성은 목표 착수의 필수 조건이 아닙니다."
                    type="url"
                    value={g.referenceUrl || ""}
                    onChange={(e) =>
                      goalChange(g.id, "referenceUrl", e.target.value)
                    }
                  />
                  <GoalReferenceLink url={g.referenceUrl} />
                </details>
                <div className="two-col">
                  <div className="writing-section">
                    <WritingGuide step="success" weekCount={weekCount} />
                    <Field
                      label="성공 기준"
                      hint="무엇이 얼마나 달라지면 달성인가요? 수치·성과물·확인 방법을 적어보세요."
                      area
                      value={g.success}
                      onChange={(e) =>
                        goalChange(g.id, "success", e.target.value)
                      }
                    />
                  </div>
                  <div className="writing-section">
                    <WritingGuide step="benefit" weekCount={weekCount} />
                    <Field
                      label="04. 성취했을 때 얻는 변화"
                      hint="이 변화가 나에게 중요한 이유와 연결된 비전을 함께 떠올려보세요."
                      area
                      value={g.benefit}
                      onChange={(e) =>
                        goalChange(g.id, "benefit", e.target.value)
                      }
                    />
                  </div>
                </div>
                <div className="subheading">
                  <h3>05. {weekCount}주 계획</h3>
                  <p>
                    전술은 주차로 배치하세요. 한 번의 실행은 완료 여부를 명확히
                    판단할 수 있어야 합니다.
                  </p>
                </div>
                <WritingGuide step="tactics" weekCount={weekCount} />
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
                <WritingGuide step="obstacles" weekCount={weekCount} />
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
                          hint={
                            key === "obstacle"
                              ? "어떤 상황에서 이 전술을 실행하기 어려울까요?"
                              : "그 상황이 생기면 내가 취할 행동을 구체적으로 적으세요."
                          }
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
                <WritingGuide step="metrics" weekCount={weekCount} />
                <div className="two-col">
                  <Field
                    label="선행지표 · 내가 실행할 행동"
                    hint="원하는 결과를 만드는 행동을 얼마나 실행했는지 확인합니다."
                    placeholder="예: 매주 러닝 3회"
                    area
                    value={g.leading}
                    onChange={(e) =>
                      goalChange(g.id, "leading", e.target.value)
                    }
                  />
                  <Field
                    label="후행지표 · 나타난 결과"
                    hint="행동의 결과로 목표에 얼마나 가까워졌는지 확인합니다."
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
                  hint="무엇으로 확인하고 어디에 기록할지, 언제 비교할지 정하세요."
                  value={g.measurement}
                  onChange={(e) =>
                    goalChange(g.id, "measurement", e.target.value)
                  }
                />
              </section>
            ))}
          </>
        )}
        {tab === 3 && (
          <>
            <Guide ids={["time", "process"]} />
            <PlanTimeline
              plan={data}
              start={start}
              weekCount={weekCount}
              week={planWeek}
              onSelectWeek={setPlanWeek}
              status={cycle.status}
              onEditGoal={(id) => {
                setSelectedGoalId(id);
                setPlanView("goal");
                setTab(2);
              }}
              onDetails={(number) => {
                setPlanWeek(number);
                setPlanView("week");
                setTab(2);
              }}
            />
            <section className="panel">
              <SectionTitle
                number="08"
                title="모범 주간"
                description="월요일부터 일요일까지, 가장 생산적인 한 주를 캘린더에 그려보세요. 중요한 활동과 작은 업무, 재충전 시간을 함께 배치합니다."
              />
              <WritingGuide step="modelWeek" weekCount={weekCount} />
              <Field
                area
                label="근무표에 맞춰 조정할 기준"
                hint="예시 요일, 근무 여부에 따른 배치, 회사 업무와 개인 작업의 구분을 적어두세요."
                value={data.modelWeekNotes || ""}
                onChange={(e) => change("modelWeekNotes", e.target.value)}
              />
              <div
                className="day-template-mode"
                role="group"
                aria-label="모범 주간 구성 방식"
              >
                <button
                  type="button"
                  className="button outlined"
                  disabled={cycle.status === "complete"}
                  aria-pressed={(data.modelWeekMode || "week") === "week"}
                  onClick={() => change("modelWeekMode", "week")}
                >
                  요일별 주간형
                </button>
                <button
                  type="button"
                  className="button outlined"
                  disabled={cycle.status === "complete"}
                  aria-pressed={data.modelWeekMode === "day"}
                  onClick={() => change("modelWeekMode", "day")}
                >
                  하루 유형 조합형
                </button>
              </div>
              {data.modelWeekMode === "day" ? (
                <>
                  <p className="muted">
                    하루 유형을 준비한 뒤 실행 화면의 ‘하루 템플릿 적용’에서
                    날짜별로 선택하세요. 기본 주간 시간표도 그대로 보존됩니다.
                  </p>
                  <DayTemplateLibrary
                    templates={data.dayTemplates || []}
                    onChange={(v) => change("dayTemplates", v)}
                    sourceBlocks={data.modelWeek}
                    readonly={cycle.status === "complete" || busy}
                  />
                </>
              ) : (
                <ModelWeekEditor
                  blocks={data.modelWeek}
                  onChange={(v) => change("modelWeek", v)}
                  Modal={Modal}
                  readonly={cycle.status === "complete"}
                />
              )}
            </section>
          </>
        )}
        {tab === 4 && (
          <>
            <Guide ids={["ownership", "commitment", "moment"]} />
            <section className="panel">
              <SectionTitle
                number="09"
                title="책임을 실천하는 태도"
                description="정리본의 네 가지 태도를 떠올리며, 개인 생활과 일에서 실천할 노력을 적어보세요."
              />
              <WritingGuide step="responsibility" weekCount={weekCount} />
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
              <WritingGuide step="pastCommitments" weekCount={weekCount} />
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
                        hint={
                          {
                            promise:
                              "남이 시킨 일보다 스스로 결정하고 지킨 약속을 떠올려보세요.",
                            action:
                              "실제로 취한 행동과 실행을 도왔던 조건을 적으세요.",
                            benefit:
                              "그 약속을 지켜 얻은 변화나 이득을 적으세요.",
                          }[key]
                        }
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
              <WritingGuide step="commitments" weekCount={weekCount} />
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
      {tab === 0 && cycle.status === "complete" && (
        <section className="panel">
          <h2>보관된 비전 대화</h2>
          <VisionAssistant
            cycle={cycle}
            dirty={false}
            onSave={save}
            onRemote={acceptRemote}
          />
        </section>
      )}
      <footer className="plan-footer">
        <button
          className="text-button"
          disabled={tab === 0}
          onClick={() => setTab(tab - 1)}
        >
          <ChevronLeft size={18} />
          이전
        </button>
        <span>
          {tab + 1} / {tabs.length}
        </span>
        {tab < tabs.length - 1 ? (
          <Button variant="light" onClick={() => setTab(tab + 1)}>
            {tab === 1 ? `${weekCount}주 계획 세우기` : "다음"}
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
      {cycle.status !== "complete" && (
        <button
          type="button"
          className={`floating-save${dirty ? " has-changes" : ""}`}
          aria-label="계획 저장"
          aria-busy={saving}
          title={
            saving
              ? "저장 중…"
              : dirty
                ? "변경한 계획 저장"
                : "변경사항이 모두 저장됐어요"
          }
          disabled={busy || saving || !dirty}
          onClick={() => run(save)}
        >
          {saving ? (
            <LoaderCircle
              size={24}
              className="save-spinner"
              aria-hidden="true"
            />
          ) : (
            <Save size={24} aria-hidden="true" />
          )}
        </button>
      )}
      {calendarSession && (
        <Modal
          title="Apple Calendar와 주간 계획 비교"
          className="calendar-merge-modal"
          onClose={() => {
            if (!calendarBusy) setCalendarSession(null);
          }}
        >
          <Suspense
            fallback={<p className="loading">캘린더 비교 화면을 여는 중…</p>}
          >
            <CalendarMergePlanner
              cycle={calendarSession.cycle}
              week={calendarSession.week}
              onBusy={setCalendarBusy}
              onApplied={(fresh, result) => {
                setCycle(fresh);
                setData(
                  editablePlan(fresh.plan, {
                    draft: fresh.status === "draft",
                    weekCount: cycleWeeks(fresh),
                  }),
                );
                setDirty(false);
                setRemoteCycle(null);
                setCalendarSession(null);
                notify(
                  `새 일정 ${result.created}개와 기존 일정 연결 ${result.linked}개를 반영했어요.`,
                );
              }}
            />
          </Suspense>
        </Modal>
      )}
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
  const modeHintId = useId();
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
          hint="목표를 이루기 위해 내가 직접 실행할 행동을 적으세요."
          placeholder="예: 주 3회 5km 달리기"
          value={t.title}
          onChange={(e) => onChange({ ...t, title: e.target.value })}
        />
        <Field
          label="1회 완료 조건"
          hint="한 번의 실행을 완료·미완료로 명확하게 판단할 기준입니다."
          placeholder="예: 5km를 끝까지 달렸을 때"
          value={t.condition}
          onChange={(e) => onChange({ ...t, condition: e.target.value })}
        />
      </div>
      <div className="tactic-options">
        <label className="field">
          <span>실행 방식</span>
          <select
            aria-label="실행 방식"
            aria-describedby={modeHintId}
            value={t.kind}
            onChange={(e) => onChange({ ...t, kind: e.target.value })}
          >
            <option value="weekly">주간 반복</option>
            <option value="daily">매일 1회</option>
            <option value="once">선택 주차마다 1회</option>
          </select>
          <small id={modeHintId}>
            {
              {
                weekly:
                  "선택한 각 주에 아래 횟수 이상 실행하기로 약속합니다. 더 실행해도 최소 기준은 늘어나지 않아요.",
                daily:
                  "선택한 주의 매일 1회 실행합니다. 빠진 날을 다른 날로 대체하지 않아요.",
                once: "선택한 각 주에 최소 1회 실행합니다. 한 번만 할 행동이라면 주차 하나를 선택하세요.",
              }[t.kind]
            }
          </small>
        </label>
        {t.kind === "weekly" && (
          <Field
            label="주당 횟수"
            hint="최소 약속입니다. 이 횟수 이상 실행하고, 초과 실행은 별도로 기록합니다."
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
        <small>
          이 전술을 수행할 주를 선택하세요. 전체 기간에 반복할 필요는 없어요.
        </small>
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
      <details className="goal-reference">
        <summary>독서 기록 설정 (선택)</summary>
        <Field
          label="독서 기록을 남길 책"
          hint="책 이름을 설정하면 실행을 완료할 때 단원과 한 줄 생각을 함께 저장합니다. 일반 전술은 비워두세요."
          value={t.readingBook || ""}
          onChange={(e) => onChange({ ...t, readingBook: e.target.value })}
        />
      </details>
    </div>
  );
}

function Execution(props) {
  return (
    <FocusTimerProvider key={props.cycle.id} storageKey={props.cycle.id}>
      <ExecutionContent {...props} />
    </FocusTimerProvider>
  );
}
function ExecutionContent({ cycle, setCycle, run, busy, notify, onDirty }) {
  const [dayTemplateSession, setDayTemplateSession] = useState(null);
  const [dayTemplateDirty, setDayTemplateDirty] = useState(false);
  const [calendarImport, setCalendarImport] = useState(null);
  const [calendarImportBusy, setCalendarImportBusy] = useState(false);
  const [initialNavigation] = useState(() => readNavigation(cycle.id));
  const weekCount = cycleWeeks(cycle),
    reviewNumber = weekCount + 1;
  const [number, setNumber] = useState(() =>
      Math.max(
        1,
        Math.min(
          reviewNumber,
          initialNavigation.week ??
            currentWeek(cycle.start_date, new Date(), weekCount),
        ),
      ),
    ),
    [week, setWeek] = useState(null),
    [mode, setMode] = useState(initialNavigation.mode ?? "day"),
    [day, setDay] = useState(initialNavigation.day ?? ""),
    [schedule, setSchedule] = useState(null),
    [placement, setPlacement] = useState(null),
    [addingTactic, setAddingTactic] = useState(null),
    [dragItem, setDragItem] = useState(null),
    [modelEdit, setModelEdit] = useState(null),
    [complete, setComplete] = useState(null),
    [reading, setReading] = useState(null),
    [review, setReview] = useState(null),
    [reflectionDirty, setReflectionDirty] = useState(false);
  const scheduleHistory = useRef({ undo: [], redo: [] });
  const [, updateScheduleHistory] = useState(0);
  useEffect(() => {
    scheduleHistory.current = { undo: [], redo: [] };
    updateScheduleHistory((v) => v + 1);
  }, [cycle.id, number]);
  useEffect(() => {
    writeNavigation({
      cycle: cycle.id,
      view: "week",
      week: number,
      mode,
      day: day || undefined,
    });
  }, [cycle.id, number, mode, day]);
  const reviewDirty =
    !!week && JSON.stringify(review) !== JSON.stringify(week.state.review);
  const modelDirty =
    !!modelEdit &&
    (modelEdit.applyToDefault ||
      modelEdit.reset ||
      JSON.stringify(modelEdit.blocks) !==
        JSON.stringify(modelWeekFor(cycle.plan, number)));
  useEffect(() => {
    if (number === reviewNumber) return;
    onDirty(reviewDirty || modelDirty || dayTemplateDirty);
    return () => onDirty(false);
  }, [reviewDirty, modelDirty, dayTemplateDirty, number]);
  const chooseWeek = (n) => {
    if (
      (reviewDirty || reflectionDirty || modelDirty) &&
      !window.confirm("저장하지 않은 내용을 버리고 이동할까요?")
    )
      return;
    setModelEdit(null);
    setNumber(n);
  };
  const chooseMode = (next) => {
    if (
      modelDirty &&
      !window.confirm("저장하지 않은 시간표 변경을 버리고 이동할까요?")
    )
      return;
    setModelEdit(null);
    setMode(next);
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
    const keepReviewDraft =
      week?.cycle_id === cycle.id && week.number === number && reviewDirty;
    setWeek(null);
    if (number <= weekCount)
      run(async () => {
        const w = await api(`/cycles/${cycle.id}/weeks/${number}`);
        if (live) {
          setWeek(w);
          setDay((previous) =>
            previous >= w.start && previous <= addDays(w.start, 6)
              ? previous
              : w.today >= w.start && w.today <= addDays(w.start, 6)
                ? w.today
                : w.start,
          );
          if (!keepReviewDraft) setReview(structuredClone(w.state.review));
        }
      });
    return () => {
      live = false;
    };
  }, [number, cycle.id, cycle.version]);
  const apply = (w) => {
    setWeek(w);
    return w;
  };
  const canEditModel =
    !!week &&
    cycle.status !== "complete" &&
    addDays(week.start, 6) >= week.today;
  const editWeekModel = () =>
    setModelEdit({
      blocks: structuredClone(modelWeekFor(cycle.plan, number)),
      applyToDefault: false,
      reset: false,
      version: cycle.version,
    });
  useEffect(() => {
    if (
      mode === "plan" &&
      week?.number === number &&
      canEditModel &&
      !modelEdit
    )
      editWeekModel();
  }, [mode, number, week?.number, canEditModel, modelEdit, cycle.version]);
  const saveWeekModel = () =>
    run(async () => {
      const preserveWeeks = Array.from(
        { length: weekCount },
        (_, i) => i + 1,
      ).filter((w) => weekStart(cycle.start_date, w) <= week.today);
      const plan = withWeekModel(cycle.plan, number, modelEdit.blocks, {
        applyToDefault: modelEdit.applyToDefault,
        preserveWeeks,
        reset: modelEdit.reset,
      });
      const changed = await api(`/cycles/${cycle.id}`, {
        method: "PUT",
        body: {
          version: modelEdit.version,
          title: cycle.title,
          startDate: cycle.start_date,
          weekCount,
          plan,
        },
      });
      setModelEdit(null);
      setCycle(changed);
      notify("이번 주 시간표를 저장했어요.");
    });
  const changeSchedule = (
    o,
    input,
    message = "일정을 저장했어요.",
    close = false,
    record = true,
  ) => {
    if (busy || cycle.status === "complete" || o.completed) return;
    if (o.requiredDate && input.date !== o.requiredDate) {
      notify("매일 해야 하는 실행은 다른 날짜로 옮길 수 없어요.");
      return;
    }
    return run(async () => {
      const before = scheduleSnapshot(
        week.state.occurrences.find((item) => item.id === o.id),
      );
      const changed = await api(`${prefix}/occurrences/${o.id}/schedule`, {
        method: "PUT",
        body: { ...input, version: week.version },
      });
      apply(changed);
      const after = scheduleSnapshot(
        changed.state.occurrences.find((item) => item.id === o.id),
      );
      if (record && JSON.stringify(before) !== JSON.stringify(after)) {
        // Undoing first-time placement hides the time while keeping the assigned
        // evaluation day; it must not erase that day's scoring promise.
        if (!before.date) before.date = after.date;
        scheduleHistory.current.undo.push({ id: o.id, before, after });
        scheduleHistory.current.undo = scheduleHistory.current.undo.slice(-50);
        scheduleHistory.current.redo = [];
        updateScheduleHistory((v) => v + 1);
      }
      if (close) {
        setSchedule(null);
        setPlacement(null);
      }
      notify(message);
      return true;
    });
  };
  function scheduleSnapshot(o) {
    return {
      date: o.date,
      time: o.time,
      minutes: o.minutes,
      timePlaced: hasScheduledTime(o),
    };
  }
  async function restoreSchedule(direction) {
    if (busy || !week) return false;
    const history = scheduleHistory.current,
      entry = history[direction].at(-1);
    if (!entry) return false;
    const o = week.state.occurrences.find((item) => item.id === entry.id);
    const expected = direction === "undo" ? entry.after : entry.before;
    if (
      !o ||
      o.completed ||
      JSON.stringify(scheduleSnapshot(o)) !== JSON.stringify(expected)
    ) {
      scheduleHistory.current = { undo: [], redo: [] };
      updateScheduleHistory((v) => v + 1);
      notify(
        "실행 기록이 달라져 이전 배치를 되돌릴 수 없어요. 현재 일정을 확인해주세요.",
      );
      return false;
    }
    const result = await changeSchedule(
      o,
      direction === "undo" ? entry.before : entry.after,
      direction === "undo"
        ? "배치 변경을 되돌렸어요."
        : "배치 변경을 다시 적용했어요.",
      false,
      false,
    );
    if (result) {
      history[direction].pop();
      history[direction === "undo" ? "redo" : "undo"].push(entry);
      updateScheduleHistory((v) => v + 1);
    }
    return !!result;
  }
  const unplaceExecution = (o, close = false) =>
    changeSchedule(
      o,
      {
        date: o.date,
        time: o.time,
        minutes: o.minutes,
        timePlaced: false,
      },
      "시간 배치를 해제했어요. 실행 약속과 평가 항목은 유지됩니다.",
      close,
    );
  const addExecution = (tactic, input) => {
    if (busy || cycle.status !== "active") return false;
    if (input.date < week.today) {
      notify("새 약속은 오늘 이후의 날짜에 추가해주세요.");
      return false;
    }
    const unplaced = week.state.occurrences.filter(
      (o) => o.tacticId === tactic.id && !o.completed && !hasScheduledTime(o),
    ).length;
    if (
      !window.confirm(
        `${tactic.title}\n이번 ${number}주차에 추가 실행 1회를 배치할까요?\n최소 약속 ${tactic.plannedCount}회와 평가 기준은 유지됩니다. 추가 실행을 못해도 점수가 깎이지 않아요.${unplaced ? `\n아직 배치하지 않은 기존 실행 ${unplaced}회도 남아 있어요.` : ""}`,
      )
    )
      return false;
    return run(async () => {
      apply(
        await api(`${prefix}/tactics/${tactic.id}/occurrences`, {
          method: "POST",
          body: { ...input, version: week.version, confirmed: true },
        }),
      );
      setPlacement(null);
      notify(
        `추가 실행을 배치했어요. 최소 약속 ${tactic.plannedCount}회는 그대로예요.`,
      );
      return true;
    });
  };
  const saveExecutionTactic = async (input) => {
    let error;
    const result = await run(async () => {
      try {
        const added = await api(`${prefix}/tactics`, {
          method: "POST",
          body: {
            ...input,
            version: week.version,
            cycleVersion: cycle.version,
            date: placement.date,
            time: placement.time,
            minutes: placement.minutes || 60,
          },
        });
        apply(added.week);
        setCycle(added.cycle);
        setAddingTactic(null);
        setPlacement(null);
        notify("전술을 추가하고 이번 주 평가에 반영했어요.");
        return true;
      } catch (failure) {
        error = failure.message;
        throw failure;
      }
    });
    return { ok: !!result, error };
  };
  const calendarBlocks = week
    ? [
        ...timetableForWeek(cycle.plan, number).map((b) => ({
          ...b,
          id: `model-${b.sourceWeek}-${b.id}`,
          background: true,
        })),
        ...week.state.occurrences.filter(hasScheduledTime).map((o) => ({
          ...o,
          day: week.daily.findIndex((d) => d.date === o.date),
          kind: "actual",
          title: week.state.tactics.find((t) => t.id === o.tacticId).title,
          locked: o.completed,
        })),
      ]
    : [];
  const hasWeeklyModel = cycle.plan.weeklyModelWeeks?.some(
    (entry) => entry.week === number,
  );
  const referenceLabel = hasWeeklyModel ? "주차별 시간표" : "모범 주간";
  const timetableSource = hasWeeklyModel
    ? `${number}주차에 따로 저장한 시간표를 사용 중입니다.`
    : "별도 시간표가 없어 기본 모범 주간을 사용 중입니다.";
  const executionCalendar = week && (
    <WeekCalendar
      label="이번 주 일정 캘린더"
      referenceLabel={referenceLabel}
      dates={week.daily.map((d) => d.date)}
      wrap={false}
      readonly={busy || !canEditModel}
      blocks={calendarBlocks}
      dragItem={dragItem}
      onCreate={(change) =>
        setPlacement({
          ...change,
          date: week.daily[change.day].date,
        })
      }
      onPlace={(id, change) => {
        const o = week.state.occurrences.find(
          (x) => x.id === id && !hasScheduledTime(x),
        );
        if (o)
          changeSchedule(
            o,
            {
              date: week.daily[change.day].date,
              time: change.time,
              minutes: o.minutes,
            },
            "실행을 배치했어요.",
          );
        setDragItem(null);
      }}
      onEdit={(o) =>
        setSchedule(week.state.occurrences.find((x) => x.id === o.id))
      }
      onMove={(o, change) =>
        changeSchedule(
          o,
          {
            date: week.daily[change.day].date,
            time: change.time,
            minutes: o.minutes,
          },
          "일정을 옮겼어요.",
        )
      }
      onResize={(o, change) =>
        changeSchedule(
          o,
          { date: o.date, ...change },
          "일정 시간을 조절했어요.",
        )
      }
    />
  );
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
    if (
      week.state.tactics.find((t) => t.id === o.tacticId)?.readingBook?.trim()
    ) {
      setReading({ occurrence: o, completeOnSave: true });
      return;
    }
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
  const openCalendarImport = () => {
    if (modelDirty) {
      notify("작성 중인 시간표를 먼저 저장하거나 변경을 취소해주세요.");
      return;
    }
    if (busy || !canEditModel) return;
    setCalendarImport({ cycle, week });
  };
  const openDayTemplates = () => {
    if (modelDirty) {
      notify("작성 중인 시간표를 먼저 저장하거나 변경을 취소해주세요.");
      return;
    }
    if (busy || !canEditModel) return;
    setDayTemplateSession({ cycle, week });
  };
  const weekModelEditor = modelEdit && week && canEditModel && (
    <section
      className="panel week-model-editor"
      aria-label="주차별 모범 주간 조정"
    >
      <header className="section-heading">
        <div>
          <h2>{number}주차 근무·생활 시간표 조정</h2>
          <p className="muted">
            근무·생활 블록과 전술 실행을 같은 시간표에서 배치하세요. 근무·생활
            변경은 이번 주 시간표를 저장해야 반영됩니다. 전술 실행은 배치할 때
            바로 저장됩니다.
          </p>
        </div>
        <Button variant="outlined" disabled={busy} onClick={openDayTemplates}>
          하루 템플릿 적용
        </Button>
      </header>
      <ModelWeekEditor
        key={`${cycle.id}-${number}`}
        blocks={modelEdit.blocks}
        wrap={false}
        readonly={busy || !canEditModel}
        initialCreationKind={mode === "plan" ? "strategy" : undefined}
        Modal={Modal}
        tactics={week.state.tactics}
        occurrences={week.state.occurrences}
        dates={week.daily.map((d) => d.date)}
        executionBlocks={calendarBlocks.filter(
          (b) => !b.background || b.day < 0,
        )}
        onEditExecution={(id) =>
          setSchedule(week.state.occurrences.find((o) => o.id === id))
        }
        onPlaceExecution={(id, change) => {
          const o = week.state.occurrences.find((x) => x.id === id);
          return o
            ? changeSchedule(
                o,
                {
                  date: week.daily[change.day].date,
                  time: change.time,
                  minutes: change.minutes,
                },
                "전술 실행을 배치했어요.",
              )
            : false;
        }}
        onAddExecution={(tactic, change) =>
          addExecution(tactic, {
            date: week.daily[change.day].date,
            time: change.time,
            minutes: change.minutes,
          })
        }
        onChange={(blocks) =>
          setModelEdit((previous) => ({
            ...previous,
            blocks,
            reset: false,
          }))
        }
      />
      <label className="week-model-option">
        <input
          type="checkbox"
          checked={modelEdit.applyToDefault}
          disabled={busy || modelEdit.reset}
          onChange={(e) =>
            setModelEdit({ ...modelEdit, applyToDefault: e.target.checked })
          }
        />
        기본 모범 주간에도 반영하기
      </label>
      <p className="footnote">
        체크하면 별도 설정이 없는 미래 주의 기본 시간표에도 반영합니다. 이미
        시작한 다른 주와 주차별로 조정한 시간표는 보존합니다. 실제 실행의
        배치·완료 기록·점수는 그대로 유지됩니다.
      </p>
      <div className="week-model-actions">
        <Button
          disabled={busy || !canEditModel || (mode === "plan" && !modelDirty)}
          onClick={saveWeekModel}
        >
          <Save size={16} />
          이번 주 시간표 저장
        </Button>
        <Button
          type="button"
          variant="outlined"
          disabled={busy || !modelDirty}
          onClick={() => {
            if (mode === "plan") editWeekModel();
            else setModelEdit(null);
          }}
        >
          {mode === "plan" ? "변경 취소" : "취소"}
        </Button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() =>
            setModelEdit({
              ...modelEdit,
              blocks: structuredClone(cycle.plan.modelWeek),
              reset: true,
              applyToDefault: false,
            })
          }
        >
          이번 주 별도 설정 해제
        </button>
      </div>
    </section>
  );
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
          {mode !== "plan" && (
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
                  style={{
                    "--progress": `${(week.score.score || 0) * 3.6}deg`,
                  }}
                >
                  <span>
                    {week.score.rows.filter((t) => t.complete).length}
                    <small>/ {week.score.rows.length} 전술 완료</small>
                  </span>
                </div>
              </article>
              <article>
                <small>이번 주 실제 실행 / 최소 약속</small>
                <strong>
                  {week.state.occurrences.filter((o) => o.completed).length}
                  <em>
                    {" "}
                    /{" "}
                    {week.state.tactics.reduce(
                      (sum, t) => sum + t.plannedCount,
                      0,
                    )}
                    회
                  </em>
                </strong>
                <p>전술별 최소 약속 달성률 · 최대 100%</p>
              </article>
              <article>
                <small>아직 배치하지 않은 실행</small>
                <strong>
                  {
                    week.state.occurrences.filter(
                      (o) => !o.completed && !hasScheduledTime(o),
                    ).length
                  }
                  <em>회</em>
                </strong>
                <button
                  className="text-button"
                  onClick={() => chooseMode("schedule")}
                >
                  이번 주 시간표를 보며 배치
                  <ArrowRight size={16} />
                </button>
              </article>
            </div>
          )}
          <div className="tabs execution-tabs">
            <button
              className={mode === "plan" ? "active" : ""}
              onClick={() => chooseMode("plan")}
            >
              <Target size={17} />
              이번 주 계획표
            </button>
            <button
              className={mode === "day" ? "active" : ""}
              onClick={() => chooseMode("day")}
            >
              <Check size={17} />
              일간 실행 · 10분
            </button>
            <button
              className={mode === "schedule" ? "active" : ""}
              onClick={() => chooseMode("schedule")}
            >
              <CalendarDays size={17} />
              주간 일정
            </button>
            <button
              className={mode === "review" ? "active" : ""}
              onClick={() => chooseMode("review")}
            >
              <BookOpen size={17} />
              주간 평가 · 30분
            </button>
          </div>
          {(!modelEdit || mode === "plan") && (
            <LifeAttitude plan={cycle.plan} />
          )}
          <ReadingNotebook
            cycleId={cycle.id}
            version={`${number}-${week.version}`}
            readingTactics={[
              ...cycle.plan.goals.flatMap((g) => g.tactics),
              ...week.state.tactics,
            ].filter((t) => t.readingBook?.trim())}
            onError={notify}
          />
          {mode === "plan" && (
            <CurrentWeekPlan
              week={week}
              referenceGoals={cycle.plan.goals}
              timetable={
                canEditModel && !weekModelEditor ? (
                  <p className="loading">시간표 편집을 준비하는 중…</p>
                ) : (
                  weekModelEditor || executionCalendar
                )
              }
              timetableSource={timetableSource}
              editingTimetable={!!weekModelEditor}
              onExport={download}
              exportDisabled={modelDirty}
              readonly={busy || cycle.status === "complete"}
              scheduleReadonly={!canEditModel}
              onSchedule={setSchedule}
              onCalendar={() => chooseMode("schedule")}
              onImportCalendar={openCalendarImport}
              importDisabled={busy || !canEditModel}
            />
          )}
          {modelEdit && mode !== "plan" && weekModelEditor}
          {mode === "day" && !modelEdit && (
            <>
              <Guide ids={["moment"]} />
              <WritingGuide step="daily" weekCount={weekCount} />
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
                    <span>
                      {d.planned
                        ? percentage(d.score)
                        : d.extraPlanned
                          ? "기본 약속 없음"
                          : "계획 없음"}
                    </span>
                    {d.extraPlanned > 0 && (
                      <small>
                        추가 실행 {d.extraDone}/{d.extraPlanned}회
                      </small>
                    )}
                  </button>
                ))}
              </div>
              <DaySchedule
                onEditModel={canEditModel ? editWeekModel : undefined}
                blocks={calendarBlocks}
                referenceLabel={referenceLabel}
                timetableSource={timetableSource}
                day={week.daily.findIndex((d) => d.date === day)}
                date={day}
                readonly={busy || cycle.status === "complete"}
                onCreate={(change) => setPlacement({ ...change, date: day })}
                onEdit={(o) =>
                  setSchedule(week.state.occurrences.find((x) => x.id === o.id))
                }
                canUndo={scheduleHistory.current.undo.length > 0}
                canRedo={scheduleHistory.current.redo.length > 0}
                onUndo={() => restoreSchedule("undo")}
                onRedo={() => restoreSchedule("redo")}
                onRemove={
                  canEditModel
                    ? (block) =>
                        unplaceExecution(
                          week.state.occurrences.find((o) => o.id === block.id),
                        )
                    : undefined
                }
                onMove={(block, change) =>
                  changeSchedule(
                    week.state.occurrences.find((o) => o.id === block.id),
                    {
                      date: week.daily[change.day].date,
                      time: change.time,
                      minutes: block.minutes,
                    },
                    "실행 시간을 옮겼어요.",
                  )
                }
                onResize={(block, change) =>
                  changeSchedule(
                    week.state.occurrences.find((o) => o.id === block.id),
                    {
                      date: week.state.occurrences.find(
                        (o) => o.id === block.id,
                      ).date,
                      ...change,
                    },
                    "실행 시간의 길이를 조절했어요.",
                  )
                }
              />
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
                    {week.daily.find((d) => d.date === day)?.extraPlanned > 0 &&
                      ` · 추가 실행 ${week.daily.find((d) => d.date === day).extraDone}회 완료`}
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
                              {hasScheduledTime(o)
                                ? `${o.time} · ${o.minutes}분`
                                : "시간 미배치"}{" "}
                              · {t.goalTitle}
                            </span>
                            <h3>{t.title}</h3>
                            {o.extra && (
                              <small>추가 실행 · 일간 점수 기준 제외</small>
                            )}
                            <p>{t.condition}</p>
                            {o.readingRecord && (
                              <div className="reading-record-preview">
                                <strong>
                                  {o.readingRecord.book} ·{" "}
                                  {o.readingRecord.chapter}
                                </strong>
                                <br />
                                {o.readingRecord.thought}
                              </div>
                            )}
                            {(t.readingBook?.trim() || o.readingRecord) && (
                              <button
                                type="button"
                                className="text-button"
                                disabled={busy || cycle.status === "complete"}
                                aria-label={`${t.title} 독서 기록`}
                                onClick={() =>
                                  setReading({
                                    occurrence: o,
                                    completeOnSave: false,
                                  })
                                }
                              >
                                {o.readingRecord
                                  ? "독서 기록 수정"
                                  : "독서 기록 남기기"}
                              </button>
                            )}
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
          {mode === "schedule" && !modelEdit && (
            <>
              <Guide ids={["time", "process"]} />
              <WritingGuide step="weekly" weekCount={weekCount} />
              <div className="section-heading">
                <div>
                  <h2>{number}주차 시간표에 실행을 배치하세요.</h2>
                  <p className="muted">
                    {timetableSource} 점선은 근무·생활 시간표, 실선은 실제
                    실행입니다. 아래 실행을 끌어 놓고, 블록 위·아래 손잡이로
                    시간을 조절하세요. 새벽 0–3시는 다음 날 새벽입니다.
                  </p>
                </div>
                <div className="week-model-actions">
                  <Button
                    variant="outlined"
                    disabled={busy || !canEditModel}
                    onClick={openDayTemplates}
                  >
                    하루 템플릿 적용
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={busy || !canEditModel}
                    onClick={openCalendarImport}
                  >
                    캘린더 가져오기
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={busy || !canEditModel}
                    onClick={editWeekModel}
                  >
                    이번 주 시간표 조정
                  </Button>
                  <Button variant="outlined" onClick={download}>
                    <Download size={16} />
                    Apple 캘린더로 내보내기
                  </Button>
                </div>
              </div>
              <p className="footnote">
                .ics 파일에 이번 주 근무·생활 시간표와 배치한 실행을 함께
                담습니다. 앱에서 바꾼 일정은 자동 동기화되지 않으므로, 다시
                가져올 때 기존 일정을 확인하세요.
              </p>
              <div className="calendar-schedule-panel">{executionCalendar}</div>
              <section className="panel">
                <h2>배치할 실행</h2>
                <p className="muted">
                  실행을 캘린더의 원하는 시간대로 끌어 놓으세요. 눌러서 날짜와
                  시간을 입력할 수도 있어요. 횟수는 주간 계획을 따릅니다.
                </p>
                <div className="unscheduled">
                  {week.state.occurrences
                    .filter((o) => !o.completed && !hasScheduledTime(o))
                    .map((o) => (
                      <button
                        disabled={busy || cycle.status === "complete"}
                        draggable={!busy && cycle.status !== "complete"}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(EXECUTION_DRAG_TYPE, o.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragItem({
                            ...o,
                            title: week.state.tactics.find(
                              (t) => t.id === o.tacticId,
                            ).title,
                          });
                        }}
                        onDragEnd={() => setDragItem(null)}
                        key={o.id}
                        onClick={() => setSchedule(o)}
                      >
                        <Plus size={16} />
                        {
                          week.state.tactics.find((t) => t.id === o.tacticId)
                            .title
                        }
                        <small>
                          {occurrenceLabel(o, week.state.occurrences)}
                        </small>
                      </button>
                    ))}
                </div>
                {week.state.occurrences.every(
                  (o) => o.completed || hasScheduledTime(o),
                ) && <p className="muted">남은 실행을 모두 배치했어요.</p>}
              </section>
            </>
          )}
          {mode === "review" && (
            <>
              <Guide ids={["measure", "ownership"]} />
              <WritingGuide step="review" weekCount={weekCount} />
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
                        {t.done}회 실행 / 최소 {t.plannedCount}회
                        {t.over > 0 && (
                          <small>최소 약속 달성 · 초과 실행 {t.over}회</small>
                        )}
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
                changeSchedule(schedule, input, "일정을 저장했어요.", true)
              }
              onRemove={
                !schedule.completed &&
                hasScheduledTime(schedule) &&
                addDays(week.start, 6) >= week.today &&
                cycle.status !== "complete"
                  ? () => unplaceExecution(schedule, true)
                  : undefined
              }
            />
          )}
          {placement && (
            <Modal
              title="이 시간에 실행 배치"
              onClose={() => {
                setPlacement(null);
                setAddingTactic(null);
              }}
            >
              <p>
                {placement.date} 평가일 · {placement.time}{" "}
                {+placement.time.slice(0, 2) < 4 ? "(다음 날 새벽)" : ""}
              </p>
              {addingTactic ? (
                <QuickTacticForm
                  goal={cycle.plan.goals.find(
                    (goal) => goal.id === addingTactic.goalId,
                  )}
                  source={addingTactic.source}
                  week={week}
                  weekCount={weekCount}
                  busy={busy}
                  onSave={saveExecutionTactic}
                  onCancel={() => setAddingTactic(null)}
                />
              ) : (
                <ExecutionPicker
                  cycle={cycle}
                  week={week}
                  placement={placement}
                  busy={busy}
                  onAdd={
                    addDays(week.start, 6) >= week.today &&
                    cycle.status === "active"
                      ? (goalId, source) => setAddingTactic({ goalId, source })
                      : undefined
                  }
                  onPlace={(o) =>
                    changeSchedule(
                      o,
                      {
                        date: placement.date,
                        time: placement.time,
                        minutes: placement.minutes || o.minutes,
                      },
                      "실행을 배치했어요.",
                      true,
                    )
                  }
                  onExtra={
                    cycle.status === "active" &&
                    placement.date >= week.today &&
                    addDays(week.start, 6) >= week.today
                      ? (tactic) =>
                          addExecution(tactic, {
                            date: placement.date,
                            time: placement.time,
                            minutes: placement.minutes || 60,
                          })
                      : undefined
                  }
                />
              )}
            </Modal>
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
          {reading && (
            <ReadingRecordModal
              key={reading.occurrence.id}
              Modal={Modal}
              occurrence={reading.occurrence}
              tactic={week.state.tactics.find(
                (t) => t.id === reading.occurrence.tacticId,
              )}
              today={week.today}
              busy={busy}
              completeOnSave={reading.completeOnSave}
              onClose={() => setReading(null)}
              onSave={(record, executedAt, markComplete) =>
                run(async () => {
                  apply(
                    await api(
                      `${prefix}/occurrences/${reading.occurrence.id}/${markComplete ? "completion" : "reading-record"}`,
                      {
                        method: "PUT",
                        body: markComplete
                          ? {
                              version: week.version,
                              completed: true,
                              executedAt,
                              readingRecord: record,
                            }
                          : { version: week.version, record },
                      },
                    ),
                  );
                  setReading(null);
                  notify(
                    markComplete
                      ? "독서 기록과 실행 완료를 저장했어요."
                      : "독서 기록을 저장했어요.",
                  );
                })
              }
              onDelete={() =>
                run(async () => {
                  apply(
                    await api(
                      `${prefix}/occurrences/${reading.occurrence.id}/reading-record`,
                      {
                        method: "PUT",
                        body: { version: week.version, record: null },
                      },
                    ),
                  );
                  setReading(null);
                  notify("독서 기록을 지웠어요. 실행 약속은 유지됩니다.");
                })
              }
            />
          )}
        </>
      )}
      {dayTemplateSession && (
        <DayTemplateSession
          cycle={dayTemplateSession.cycle}
          week={dayTemplateSession.week}
          Modal={Modal}
          onDirty={setDayTemplateDirty}
          onClose={() => setDayTemplateSession(null)}
          onLibrarySaved={(fresh) => {
            setModelEdit(null);
            setCycle(fresh);
          }}
          onApplied={(fresh) => {
            setModelEdit(null);
            setDayTemplateSession(null);
            setCycle(fresh);
            notify("하루 템플릿을 날짜별 시간표에 적용했어요.");
          }}
        />
      )}
      {calendarImport && (
        <Modal
          title={`${calendarImport.week.number}주차 캘린더 가져오기`}
          className="calendar-merge-modal"
          onClose={() => {
            if (!calendarImportBusy) setCalendarImport(null);
          }}
        >
          <Suspense
            fallback={<p className="loading">캘린더 가져오기를 준비하는 중…</p>}
          >
            <CalendarImport
              cycle={calendarImport.cycle}
              week={calendarImport.week}
              onBusy={setCalendarImportBusy}
              onApplied={(fresh, result) => {
                setModelEdit(null);
                setCalendarImport(null);
                setCycle(fresh);
                notify(
                  result.imported != null
                    ? `일정 ${result.imported}개를 ${calendarImport.week.number}주차에 추가했어요.`
                    : `새 일정 ${result.created}개와 기존 일정 연결 ${result.linked}개를 반영했어요.`,
                );
              }}
            />
          </Suspense>
        </Modal>
      )}
    </>
  );
}
function ScheduleModal({
  occurrence: o,
  tactic,
  week,
  busy,
  onClose,
  onSave,
  onRemove,
}) {
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
        {onRemove && (
          <p className="footnote">
            배치 해제는 시간 블록만 지웁니다. 평가 날짜와 실행 약속은 그대로
            남습니다.
          </p>
        )}
        <Button disabled={busy}>
          일정 저장
          <Check size={17} />
        </Button>
        {onRemove && (
          <Button
            type="button"
            variant="outlined"
            disabled={busy}
            onClick={onRemove}
          >
            배치 해제
          </Button>
        )}
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
      <WritingGuide step="reflection" weekCount={weekCount} />
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

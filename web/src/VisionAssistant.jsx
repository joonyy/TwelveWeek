import React, { useEffect, useRef, useState } from "react";
import {
  MessageCircle,
  X,
  Send,
  Undo2,
  Link,
  Plus,
  Settings,
  Upload,
  Copy,
  RefreshCw,
} from "lucide-react";
import { api } from "./api.js";
import { selectedExportChats } from "../../shared/vision-ai.js";
import { MarkdownContent } from "./MarkdownContent.jsx";
import "./vision-ai.css";

const providerName = {
  openai: "OpenAI",
  anthropic: "Claude",
  codex: "로컬 Codex",
};
const Button = ({ children, ...props }) => (
  <button type="button" className="button secondary" {...props}>
    {children}
  </button>
);
export function VisionAssistant({ cycle, dirty, onSave, onRemote }) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState("chat"),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const [config, setConfig] = useState(null),
    [context, setContext] = useState(null),
    [list, setList] = useState([]),
    [chat, setChat] = useState(null),
    [edits, setEdits] = useState([]),
    [mcp, setMcp] = useState(null);
  const [provider, setProvider] = useState("openai"),
    [message, setMessage] = useState(""),
    [key, setKey] = useState(""),
    [model, setModel] = useState("");
  const [importing, setImporting] = useState(false),
    [transcript, setTranscript] = useState(""),
    [source, setSource] = useState("ChatGPT"),
    [choices, setChoices] = useState(null),
    [choice, setChoice] = useState("0"),
    [threads, setThreads] = useState(null);
  const alive = useRef(true),
    end = useRef(null),
    remote = useRef(onRemote),
    selected = useRef(null),
    sending = useRef(false),
    pendingCount = useRef(0),
    cycleSnapshot = useRef(cycle);
  cycleSnapshot.current = cycle;
  remote.current = onRemote;
  selected.current = chat?.id;
  const prefix = `/ai/cycles/${cycle.id}`;
  const storageKey = `twelve.visionChat.${cycle.id}`;
  const perform = async (fn) => {
    setError("");
    pendingCount.current++;
    setPending(true);
    try {
      return await fn();
    } catch (e) {
      if (alive.current) setError(e.message);
      return null;
    } finally {
      pendingCount.current--;
      if (alive.current) setPending(pendingCount.current > 0);
    }
  };
  const refresh = async () => {
    const [cfg, ctx, chats, history, connection] = await Promise.all([
      api("/ai/config"),
      api(`${prefix}/context`),
      api(`${prefix}/conversations`),
      api(`${prefix}/edits`),
      api("/ai/mcp"),
    ]);
    if (!alive.current) return;
    setConfig(cfg);
    setContext(ctx);
    setList(chats);
    setEdits(history);
    setMcp(connection);
    const saved = selected.current || localStorage.getItem(storageKey);
    if (saved && chats.some((c) => c.id === saved)) {
      const c = await api(`${prefix}/conversations/${saved}`);
      if (alive.current) setChat(c);
    }
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    void perform(refresh);
    const timer = setInterval(async () => {
      if (
        document.visibilityState === "hidden" ||
        sending.current ||
        pendingCount.current
      )
        return;
      try {
        const ctx = await api(`${prefix}/context`);
        if (!alive.current) return;
        setContext(ctx);
        if (ctx.version > cycleSnapshot.current.version) {
          const fresh = await api(`/cycles/${cycle.id}`);
          if (alive.current) {
            remote.current(fresh);
            setEdits(await api(`${prefix}/edits`));
          }
        }
      } catch {
        /* Explicit actions show connection errors; background polling stays quiet. */
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [open, cycle.id]);
  useEffect(() => {
    const log = end.current?.parentElement;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chat?.messages?.length]);
  const chooseChat = async (id) => {
    const c = await api(`${prefix}/conversations/${id}`);
    if (!alive.current) return;
    setChat(c);
    setProvider(c.provider);
    localStorage.setItem(storageKey, id);
  };
  const create = async (extra = {}) => {
    const c = await api(`${prefix}/conversations`, {
      method: "POST",
      body: { provider, ...extra },
    });
    setChat(c);
    localStorage.setItem(storageKey, c.id);
    setImporting(false);
    setTranscript("");
    setChoices(null);
    setThreads(null);
    await refresh();
    return c;
  };
  const send = async (text = message, retryId = null) => {
    if (!text.trim() || dirty || sending.current) return;
    sending.current = true;
    try {
      const c = chat || (await create());
      const result = await api(`${prefix}/conversations/${c.id}/messages`, {
        method: "POST",
        body: {
          message: text,
          requestId: retryId || crypto.randomUUID(),
          version: c.version,
          cycleVersion: cycle.version,
        },
      });
      if (!alive.current) return;
      setChat(result.conversation);
      if (!retryId || message === text) setMessage("");
      remote.current(result.cycle);
      await refresh();
    } catch (e) {
      const id = selected.current || localStorage.getItem(storageKey);
      if (alive.current && id)
        setChat(await api(`${prefix}/conversations/${id}`));
      throw e;
    } finally {
      sending.current = false;
    }
  };
  const connected =
    config?.providers.find((p) => p.provider === (chat?.provider || provider))
      ?.connected ||
    ((chat?.provider || provider) === "codex" && config?.codex);
  const unanswered =
    chat?.messages.at(-1)?.role === "user" && chat.messages.at(-1)?.requestId
      ? chat.messages.at(-1)
      : null;
  const accept = async (vision) => {
    const result = await api(`${prefix}/vision`, {
      method: "POST",
      body: { vision, version: cycle.version },
    });
    remote.current(result.cycle);
    await refresh();
  };
  const exportContext = async () => {
    const ctx = await api(`${prefix}/context`);
    await navigator.clipboard.writeText(
      `${ctx.guidance}\n\n내가 작성한 현재 장기비전:\n${ctx.longVision}\n\n한국어로 질문 하나부터 시작해줘. 대화 후 내가 요청하면 비전을 정리해줘.`,
    );
  };
  if (!open)
    return (
      <aside className="vision-ai">
        <Button onClick={() => setOpen(true)}>
          <MessageCircle size={16} />
          AI와 비전 다듬기
        </Button>
      </aside>
    );
  return (
    <aside className="vision-ai open" aria-label="장기비전 AI 대화">
      <header className="ai-heading">
        <div>
          <span className="eyebrow">VISION PARTNER</span>
          <h3>생각을 펼치는 대화</h3>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="AI 대화창 접기"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          <X size={17} />
        </button>
      </header>
      <p className="ai-description">
        상상은 넓게, 질문은 하나씩. 지금은 장기비전을 다듬는 시간이에요.
      </p>
      <div className="ai-tabs" role="tablist" aria-label="비전 AI 메뉴">
        {[
          ["chat", "대화"],
          ["connect", "연결"],
          ["history", "수정 이력"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="ai-error">
          {error}
        </p>
      )}
      {dirty && (
        <div className="ai-note">
          작성 중인 내용을 먼저 저장하면 AI가 같은 비전을 볼 수 있어요.
          <Button disabled={pending} onClick={() => perform(onSave)}>
            저장하고 대화 준비
          </Button>
        </div>
      )}
      {tab === "chat" && (
        <>
          <div className="ai-chat-picker">
            <label className="field">
              <span>비전 대화 선택</span>
              <select
                aria-label="비전 대화 선택"
                value={chat?.id || ""}
                disabled={pending}
                onChange={(e) => perform(() => chooseChat(e.target.value))}
              >
                <option value="" disabled>
                  새 대화를 시작하세요
                </option>
                {list.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.title} · {providerName[c.provider]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label="새 비전 대화"
              disabled={pending}
              onClick={() => {
                setChat(null);
                localStorage.removeItem(storageKey);
              }}
            >
              <Plus size={18} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="대화 다시 불러오기"
              disabled={pending}
              onClick={() => perform(refresh)}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          {!chat && (
            <label className="field">
              <span>대화할 AI</span>
              <select
                aria-label="대화할 AI"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                disabled={pending}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Claude</option>
                {config?.codex && <option value="codex">로컬 Codex</option>}
              </select>
            </label>
          )}
          {chat?.source === "import" && (
            <p className="ai-note">
              {chat.source_label || "외부 AI"} 대화 내용을 가져온 별도의
              대화예요. 원래 서비스의 채팅과 자동 동기화되지 않아요.
            </p>
          )}
          {chat?.source === "codex" && (
            <p className="ai-note">
              선택한 로컬 Codex 대화를 이어갑니다. 원래 대화에서 동시에 요청하지
              마세요.
            </p>
          )}
          <div
            className="ai-messages"
            role="log"
            aria-label="비전 대화 기록"
            aria-live="polite"
          >
            {!chat?.messages.length && (
              <div className="ai-empty">
                <MessageCircle size={25} />
                <p>이미 적은 비전에서 더 생각해볼 지점을 함께 찾아보세요.</p>
                <Button
                  disabled={pending || dirty || !connected}
                  onClick={() =>
                    perform(() =>
                      send(
                        "내 비전을 읽고, 생각을 더 펼칠 수 있는 질문 하나를 해줘.",
                      ),
                    )
                  }
                >
                  질문 하나로 시작하기
                </Button>
              </div>
            )}
            {chat?.messages.map((m) => (
              <article className={`ai-message ${m.role}`} key={m.id}>
                <small>
                  {m.role === "user" ? "나" : providerName[chat.provider]}
                  {m.imported && " · 가져온 대화"}
                </small>
                <MarkdownContent>{m.content}</MarkdownContent>
                {m.proposedVision !== null &&
                  m.proposedVision !== undefined && (
                    <details className="ai-proposal">
                      <summary>
                        {m.applied ? "반영한 비전 보기" : "비전 수정안 보기"}
                      </summary>
                      <MarkdownContent>{m.proposedVision}</MarkdownContent>
                      {!m.applied && (
                        <Button
                          disabled={
                            pending || dirty || cycle.status === "complete"
                          }
                          onClick={() =>
                            perform(() => accept(m.proposedVision))
                          }
                        >
                          이 제안 반영하기
                        </Button>
                      )}
                    </details>
                  )}
                {m.warning && <p className="ai-note">{m.warning}</p>}
              </article>
            ))}
            {(pending || chat?.busy) && (
              <p className="ai-wait" role="status">
                대화를 준비하고 있어요…
              </p>
            )}
            <div ref={end} />
          </div>
          {!connected && (
            <div className="ai-note">
              사용할 AI를 먼저 연결해주세요. 가져온 대화는 연결 전에도 읽을 수
              있어요.
              <Button onClick={() => setTab("connect")}>
                <Settings size={14} />
                연결 설정
              </Button>
            </div>
          )}
          {unanswered && !chat?.busy && !pending && (
            <div className="ai-note" role="status">
              질문은 저장됐어요. 아직 AI 응답을 받지 못했어요.
              <Button
                disabled={dirty || !connected}
                onClick={() =>
                  perform(() => send(unanswered.content, unanswered.requestId))
                }
              >
                저장된 질문 다시 보내기
              </Button>
            </div>
          )}
          <form
            className="ai-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(() => send());
            }}
          >
            <label className="field">
              <span>AI에게 보낼 메시지</span>
              <textarea
                rows={3}
                aria-label="AI에게 보낼 메시지"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="생각을 적거나, 지금까지의 대화를 비전에 반영해달라고 요청하세요."
                maxLength={6000}
                disabled={pending || chat?.busy}
              />
            </label>
            <button
              className="button"
              disabled={
                pending || chat?.busy || dirty || !connected || !message.trim()
              }
            >
              <Send size={15} />
              보내기
            </button>
          </form>
          <label className="ai-permission">
            <input
              type="checkbox"
              aria-label="AI의 장기비전 직접 수정 허용"
              checked={context?.allowWrite || false}
              disabled={pending || dirty || cycle.status === "complete"}
              onChange={(e) => {
                const allowWrite = e.target.checked;
                const before = context?.allowWrite || false;
                setContext((c) => ({ ...c, allowWrite }));
                void perform(async () => {
                  try {
                    const result = await api(`${prefix}/permission`, {
                      method: "PUT",
                      body: { allowWrite },
                    });
                    setContext((c) => ({ ...c, ...result }));
                  } catch (e) {
                    setContext((c) => ({ ...c, allowWrite: before }));
                    throw e;
                  }
                });
              }}
            />
            <span>
              AI의 장기비전 직접 수정 허용
              <small>
                이 주기의 장기비전만. 언제든 철회하고 되돌릴 수 있어요.
              </small>
            </span>
          </label>
        </>
      )}
      {tab === "connect" && (
        <div className="ai-settings">
          <h4>앱 안에서 사용할 AI</h4>
          <p className="muted">
            API 키로 연결해요. 기존 채팅 구독과 대화·메모리가 자동으로 연결되는
            것은 아니에요.
          </p>
          <label className="field">
            <span>AI 제공자</span>
            <select
              aria-label="AI 제공자"
              value={provider === "codex" ? "openai" : provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel("");
                setKey("");
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Claude</option>
            </select>
          </label>
          <label className="field">
            <span>사용할 모델 ID</span>
            <input
              aria-label="사용할 모델 ID"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="사용 가능한 모델 ID"
              maxLength={120}
            />
          </label>
          <label className="field">
            <span>AI API 키</span>
            <input
              aria-label="AI API 키"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="키는 서버에 암호화해서 저장합니다."
            />
          </label>
          {!config?.canSaveKeys && (
            <p className="ai-note">서버의 AI 키 저장 설정이 아직 필요해요.</p>
          )}
          <Button
            disabled={
              pending || !config?.canSaveKeys || !key.trim() || !model.trim()
            }
            onClick={() =>
              perform(async () => {
                await api(
                  `/ai/connections/${provider === "codex" ? "openai" : provider}`,
                  { method: "PUT", body: { key, model } },
                );
                setKey("");
                await refresh();
              })
            }
          >
            <Link size={15} />
            API 연결 저장
          </Button>
          {config?.providers
            .filter((p) => p.connected)
            .map((p) => (
              <div className="ai-connection" key={p.provider}>
                <span>
                  {providerName[p.provider]} · {p.model || "모델 설정 필요"}
                </span>
                {p.personal && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={pending}
                    onClick={() =>
                      perform(async () => {
                        await api(`/ai/connections/${p.provider}`, {
                          method: "DELETE",
                        });
                        await refresh();
                      })
                    }
                  >
                    연결 삭제
                  </button>
                )}
              </div>
            ))}
          <hr />
          <h4>외부 AI에서 TwelveWeek 수정</h4>
          <p>
            ChatGPT·Claude의 MCP 연결에 아래 주소를 등록하세요. 연결 과정에서 이
            주기를 선택하고, 대화 메뉴에서 수정 권한을 켜면 돼요.
          </p>
          <code className="ai-mcp-url">
            {mcp?.url || "연결 주소를 불러오는 중…"}
          </code>
          <Button
            disabled={!mcp?.url}
            onClick={() =>
              perform(() => navigator.clipboard.writeText(mcp.url))
            }
          >
            <Copy size={14} />
            MCP 주소 복사
          </Button>
          {mcp?.connections.map((c) => (
            <div className="ai-connection" key={c.id}>
              <span>
                {c.name} · {c.title}
              </span>
              <button
                type="button"
                className="text-button"
                disabled={pending}
                onClick={() =>
                  perform(async () => {
                    await api(`/ai/mcp/${c.id}`, { method: "DELETE" });
                    await refresh();
                  })
                }
              >
                권한 철회
              </button>
            </div>
          ))}
          <hr />
          <h4>기존 대화 가져오기</h4>
          <p>
            선택한 대화 또는 요약을 가져와 앱에서 이어갈 수 있어요. 전체 대화
            내보내기에서는 대화 하나를 선택합니다.
          </p>
          <div className="ai-actions">
            <Button onClick={() => setImporting(!importing)}>
              <Upload size={14} />
              대화 가져오기
            </Button>
            <Button disabled={dirty} onClick={() => perform(exportContext)}>
              <Copy size={14} />
              외부 AI용 비전·지침 복사
            </Button>
          </div>
          {importing && (
            <div className="ai-import">
              <label className="field">
                <span>원래 대화 서비스</span>
                <select
                  aria-label="원래 대화 서비스"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option>ChatGPT</option>
                  <option>Claude</option>
                  <option>기타 / 요약</option>
                </select>
              </label>
              <label className="field">
                <span>이어갈 AI</span>
                <select
                  aria-label="가져온 대화를 이어갈 AI"
                  value={provider === "codex" ? "openai" : provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Claude</option>
                </select>
              </label>
              <label className="field">
                <span>대화 파일</span>
                <input
                  type="file"
                  accept=".json,.txt,.md"
                  aria-label="대화 파일"
                  onChange={(e) =>
                    perform(async () => {
                      const f = e.target.files[0];
                      if (!f) return;
                      if (f.size > 5000000)
                        throw new Error("5MB 이하의 대화 파일을 선택해주세요.");
                      const raw = await f.text();
                      const chats = selectedExportChats(raw);
                      setChoices(chats);
                      setChoice("0");
                      if (chats) setTranscript(chats[0].transcript);
                      else setTranscript(raw);
                    })
                  }
                />
              </label>
              {choices && (
                <label className="field">
                  <span>가져올 대화 하나 선택</span>
                  <select
                    aria-label="가져올 대화 하나 선택"
                    value={choice}
                    onChange={(e) => {
                      setChoice(e.target.value);
                      setTranscript(choices[Number(e.target.value)].transcript);
                    }}
                  >
                    {choices.map((c, i) => (
                      <option value={i} key={i}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field">
                <span>대화 내용 또는 요약</span>
                <textarea
                  aria-label="대화 내용 또는 요약"
                  rows={5}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  maxLength={120000}
                />
              </label>
              <Button
                disabled={pending || !transcript.trim()}
                onClick={() =>
                  perform(async () => {
                    await create({
                      transcript,
                      sourceLabel: source,
                      title: `${source}에서 이어온 비전 대화`,
                    });
                    setTab("chat");
                  })
                }
              >
                선택한 내용으로 대화 만들기
              </Button>
            </div>
          )}
          <hr />
          <h4>로컬 Codex 대화 resume</h4>
          {config?.codex ? (
            <>
              <p>
                대화 기록이 있는 이 컴퓨터의 Codex에 연결합니다. 같은 대화에서
                동시에 요청하지 마세요.
              </p>
              <Button
                disabled={pending}
                onClick={() =>
                  perform(async () =>
                    setThreads(await api("/ai/codex/threads")),
                  )
                }
              >
                저장된 Codex 대화 찾기
              </Button>
              {threads?.map((t) => (
                <Button
                  disabled={pending || t.busy}
                  key={t.id}
                  onClick={() =>
                    perform(async () => {
                      const c = await api(`${prefix}/conversations`, {
                        method: "POST",
                        body: {
                          provider: "codex",
                          remoteThreadId: t.id,
                          title: t.title || "Codex 비전 대화",
                        },
                      });
                      setChat(c);
                      localStorage.setItem(storageKey, c.id);
                      setTab("chat");
                      await refresh();
                    })
                  }
                >
                  {t.title}
                </Button>
              ))}
              {threads?.length === 0 && <p>저장된 대화를 찾지 못했어요.</p>}
            </>
          ) : (
            <p className="ai-note">
              대화 기록이 있는 로컬 서버에서 사용자별 Codex 연결을 설정하면
              사용할 수 있어요. Render에서 이 컴퓨터의 기록을 직접 읽지는
              못해요.
            </p>
          )}
        </div>
      )}
      {tab === "history" && (
        <div className="ai-history">
          {!edits.length && (
            <p className="muted">아직 AI가 수정한 비전이 없어요.</p>
          )}
          {edits.map((e) => (
            <article key={e.id}>
              <small>
                {e.actor} · {new Date(e.created_at).toLocaleString("ko-KR")}
              </small>
              <details>
                <summary>수정 전후 보기</summary>
                <h4>수정 전</h4>
                <MarkdownContent>
                  {e.before_text || "비어 있음"}
                </MarkdownContent>
                <h4>수정 후</h4>
                <MarkdownContent>{e.after_text || "비어 있음"}</MarkdownContent>
              </details>
              <Button
                disabled={
                  pending ||
                  dirty ||
                  !!e.undone_at ||
                  cycle.plan.longVision !== e.after_text ||
                  cycle.status === "complete"
                }
                onClick={() =>
                  perform(async () => {
                    const c = await api(`${prefix}/edits/${e.id}/undo`, {
                      method: "POST",
                      body: { version: cycle.version },
                    });
                    remote.current(c);
                    await refresh();
                  })
                }
              >
                <Undo2 size={14} />
                {e.undone_at ? "되돌린 수정" : "이 수정 되돌리기"}
              </Button>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}

export function AIConnectionConsent({ request, onCancel }) {
  const [preview, setPreview] = useState(null),
    [cycles, setCycles] = useState([]),
    [cycleId, setCycleId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([
      api("/ai/oauth/preview", { method: "POST", body: request }),
      api("/cycles"),
    ])
      .then(([p, rows]) => {
        setPreview(p);
        setCycles(rows);
        setCycleId(
          rows.find((c) => c.status !== "complete")?.id || rows[0]?.id || "",
        );
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel ai-consent">
      <span className="eyebrow">CONNECT YOUR AI</span>
      <h1>외부 AI에 비전 연결</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {preview && (
        <>
          <p>
            <strong>{preview.name}</strong>에 선택한 주기의 장기비전 접근을
            허용합니다.
          </p>
          <label className="field">
            <span>연결할 실행 주기</span>
            <select
              aria-label="연결할 실행 주기"
              value={cycleId}
              onChange={(e) => setCycleId(e.target.value)}
            >
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <p className="ai-note">
            장기비전 읽기
            {preview.scopes.includes("vision:write") && " · 장기비전 수정 도구"}
            <br />
            직접 수정은 해당 주기의 AI 수정 허용을 켰을 때만 가능해요.
            목표·전술·점수 접근은 포함하지 않아요.
          </p>
          <p className="muted">
            연결 후 돌아갈 서비스: {preview.redirectOrigin}
          </p>
        </>
      )}
      <div className="ai-actions">
        <Button
          disabled={!preview || !cycleId || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await api("/ai/oauth/approve", {
                method: "POST",
                body: { ...request, cycleId },
              });
              location.assign(result.redirect);
            } catch (e) {
              setError(e.message);
              setBusy(false);
            }
          }}
        >
          이 주기 연결 허용
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          연결 취소
        </Button>
      </div>
      {!cycles.length && preview && (
        <p>먼저 앱에서 실행 주기를 하나 작성해주세요.</p>
      )}
    </section>
  );
}

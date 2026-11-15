"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Ellipsis,
  FileChartColumn,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  PanelLeftClose,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  TrendingUp,
  X,
} from "lucide-react";
import { conversationGroup, type Conversation, type Turn } from "@/lib/types";
import { Button } from "./ui/button";
import { ConnectionStatus } from "./connection-status";
import { Dialog } from "./ui/dialog";
import { Constraints } from "./constraints";
import { PortfolioPanel } from "./portfolio";
const suggestions = [
  {
    icon: ShieldCheck,
    title: "Build a defensive portfolio",
    text: "Build a defensive portfolio with no cryptocurrency.",
  },
  {
    icon: TrendingUp,
    title: "Put your cash to work",
    text: "Optimize a portfolio with at least 20% cash.",
  },
  {
    icon: FileChartColumn,
    title: "Understand the trade-offs",
    text: "Compare portfolio risk and expected return.",
  },
  {
    icon: SlidersHorizontal,
    title: "Review your constraints",
    text: "Explain my current portfolio constraints.",
  },
];
// Advisory request fences survive browser restarts; never store credentials here.
function rememberPending(id: string, version: number | null) {
  try {
    if (version === null) localStorage.removeItem(`af:pending:${id}`);
    else localStorage.setItem(`af:pending:${id}`, String(version));
  } catch {
    /* server reservation remains authoritative */
  }
}
function pendingVersion(id: string) {
  try {
    const value = localStorage.getItem(`af:pending:${id}`);
    return value !== null && Number.isInteger(Number(value))
      ? Number(value)
      : null;
  } catch {
    return null;
  }
}
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function api<T>(
  url: string,
  method = "GET",
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
    signal,
    cache: "no-store",
  });
  const result = await response.json();
  if (response.status === 401)
    window.dispatchEvent(new Event("alphaforge:unauthorized"));
  if (!response.ok)
    throw new ApiError(
      response.status,
      result.error ?? "The request could not be completed.",
    );
  return result;
}
export function ChatApp() {
  const [user, setUser] = useState<string | null>(null),
    [loaded, setLoaded] = useState(false),
    [conversations, setConversations] = useState<Conversation[]>([]),
    [activeId, setActiveId] = useState<string | null>(null);
  const [localWorkspace, setLocalWorkspace] = useState(false);
  const [query, setQuery] = useState(""),
    [draft, setDraft] = useState(""),
    [sidebar, setSidebar] = useState(true),
    [mobile, setMobile] = useState(false),
    [dark, setDark] = useState(false),
    [details, setDetails] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [busyId, setBusyId] = useState<string | null>(null),
    [creating, setCreating] = useState(false),
    [settings, setSettings] = useState(false);
  const [editing, setEditing] = useState<Conversation | null>(null),
    [title, setTitle] = useState(""),
    [deleting, setDeleting] = useState<Conversation | null>(null),
    [copied, setCopied] = useState<string | null>(null),
    [scrollDown, setScrollDown] = useState(false);
  const controller = useRef<AbortController | null>(null),
    requestInFlight = useRef(false),
    creatingRef = useRef(false),
    bottom = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    nearBottom = useRef(true);
  const active = conversations.find((c) => c.id === activeId) ?? null;
  function replace(c: Conversation) {
    setConversations((all) =>
      [c, ...all.filter((x) => x.id !== c.id)].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    );
  }
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const me = await api<{ name: string; authentication?: string }>(
          "/api/me",
        );
        if (!alive) return;
        setUser(me.name);
        setLocalWorkspace(me.authentication === "local");
        const list = await api<Conversation[]>("/api/conversations");
        for (let i = 0; i < list.length; i++) {
          const version = pendingVersion(list[i].id);
          if (version !== null) {
            try {
              list[i] = await api<Conversation>(
                `/api/conversations/${list[i].id}/stop-waiting`,
                "POST",
                { version },
              );
              rememberPending(list[i].id, null);
            } catch {
              list[i] = {
                ...list[i],
                status: "uncertain",
                error:
                  "A previous request was interrupted. Reconnect and refresh before continuing.",
              };
            }
          }
        }
        if (!alive) return;
        setConversations(list);
        setActiveId(list[0]?.id ?? null);
      } catch (e) {
        if (
          alive &&
          new URLSearchParams(window.location.search).has("auth_error")
        )
          setError("Sign-in could not be verified. Please sign in again.");
        else if (alive && (!(e instanceof ApiError) || e.status !== 401))
          setError((e as Error).message);
      } finally {
        if (alive) setLoaded(true);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener("alphaforge:unauthorized", expired);
    return () => window.removeEventListener("alphaforge:unauthorized", expired);
  }, []);
  useEffect(() => {
    if (!active?.messages.length) {
      if (scroll.current) scroll.current.scrollTop = 0;
      return;
    }
    if (nearBottom.current)
      bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages.length, busyId, activeId]);
  useEffect(() => {
    if (!activeId || !user || active?.status !== "processing") return;
    const timer = setInterval(() => {
      void api<Conversation>(`/api/conversations/${activeId}`)
        .then(replace)
        .catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [activeId, user, active?.status]);
  async function create() {
    if (creatingRef.current) return null;
    creatingRef.current = true;
    setCreating(true);
    setError(null);
    try {
      const c = await api<Conversation>("/api/conversations", "POST");
      replace(c);
      setActiveId(c.id);
      setDraft("");
      setDetails(false);
      setMobile(false);
      nearBottom.current = true;
      return c;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }
  function select(c: Conversation) {
    setActiveId(c.id);
    setDraft("");
    setMobile(false);
    setError(null);
    nearBottom.current = true;
    const version = pendingVersion(c.id);
    void (
      version === null
        ? api<Conversation>(`/api/conversations/${c.id}`)
        : api<Conversation>(`/api/conversations/${c.id}/stop-waiting`, "POST", {
            version,
          })
    )
      .then((value) => {
        rememberPending(c.id, null);
        replace(value);
      })
      .catch((e) => setError(e.message));
  }
  async function send(turn: Omit<Turn, "version">) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    let c = active;
    try {
      if (!c) c = await create();
      if (!c) return;
      if (c.status === "processing" || c.status === "uncertain") return;
      const id = c.id;
      rememberPending(id, c.version);
      setBusyId(id);
      setDraft("");
      setError(null);
      nearBottom.current = true;
      // Mark locally blocked immediately; authoritative data is always replaced by the server.
      replace({
        ...c,
        status: "processing",
        messages: [
          ...c.messages,
          {
            id: crypto.randomUUID(),
            role: "user",
            content: turn.prompt,
            createdAt: new Date().toISOString(),
          },
        ],
      });
      controller.current = new AbortController();
      const result = await api<Conversation>(
        `/api/conversations/${id}/turn`,
        "POST",
        { ...turn, version: c.version },
        controller.current.signal,
      );
      rememberPending(id, null);
      replace(result);
    } catch (e) {
      const message =
        e instanceof Error && e.name === "AbortError"
          ? "Stopped waiting. The backend may still be processing; cancellation does not cancel its work. Refresh to check the result."
          : (e as Error).message;
      setError(message);
      if (c) {
        try {
          replace(
            e instanceof ApiError && e.status === 424
              ? await api<Conversation>(`/api/conversations/${c.id}`)
              : await api<Conversation>(
                  `/api/conversations/${c.id}/stop-waiting`,
                  "POST",
                  { version: c.version },
                ),
          );
          rememberPending(c.id, null);
        } catch {
          replace({
            ...c,
            status: "uncertain",
            error:
              "The request outcome is uncertain. Refresh before taking further action.",
          });
        }
      }
    } finally {
      setBusyId(null);
      controller.current = null;
      requestInFlight.current = false;
    }
  }
  const blocked =
    !user ||
    !!busyId ||
    creating ||
    active?.status === "processing" ||
    active?.status === "uncertain";
  async function refresh() {
    try {
      const list = await api<Conversation[]>("/api/conversations");
      for (let i = 0; i < list.length; i++) {
        const version = pendingVersion(list[i].id);
        if (version !== null) {
          list[i] = await api<Conversation>(
            `/api/conversations/${list[i].id}/stop-waiting`,
            "POST",
            { version },
          );
          rememberPending(list[i].id, null);
        }
      }
      setConversations(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setError(
        "Clipboard access is unavailable. Select the message text to copy it.",
      );
    }
  }
  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className={`app-shell ${sidebar ? "" : "sidebar-collapsed"}`}>
      {mobile && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        className={`sidebar ${mobile ? "mobile-open" : ""}`}
        aria-label="Conversation navigation"
      >
        <div className="brand">
          <span className="brand-mark">
            <TrendingUp size={20} />
          </span>
          <strong>
            AlphaForge<span>PORTFOLIO INTELLIGENCE</span>
          </strong>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Collapse sidebar"
            onClick={() => {
              setSidebar(false);
              setMobile(false);
            }}
          >
            <PanelLeftClose size={17} />
          </Button>
        </div>
        <Button
          className="new-chat"
          disabled={!user || creating}
          onClick={() => void create()}
        >
          <Plus size={17} />
          New chat
        </Button>
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Search conversations"
            placeholder="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <nav className="conversation-list">
          {["Today", "Yesterday", "Previous 7 Days", "Older"].map((group) => {
            const items = filtered.filter(
              (c) => conversationGroup(c.updatedAt) === group,
            );
            return items.length ? (
              <section key={group}>
                <h2>{group}</h2>
                {items.map((c) => (
                  <div
                    key={c.id}
                    className={`conversation-item ${c.id === activeId ? "active" : ""}`}
                  >
                    <button
                      className="conversation-link"
                      onClick={() => select(c)}
                      aria-current={c.id === activeId ? "page" : undefined}
                    >
                      <MessageSquare size={15} />
                      <span>{c.title}</span>
                      {c.status === "processing" && (
                        <i className="tiny-spinner" />
                      )}
                    </button>
                    <button
                      className="conversation-options"
                      aria-label={`Manage ${c.title}`}
                      onClick={() => {
                        setEditing(c);
                        setTitle(c.title);
                      }}
                    >
                      <Ellipsis size={17} />
                    </button>
                  </div>
                ))}
              </section>
            ) : null;
          })}
          {!filtered.length && (
            <div className="empty-history">
              <MessageSquare size={21} />
              <p>
                {query
                  ? "No matching conversations"
                  : "Your research starts here"}
              </p>
              <small>
                {query
                  ? "Try a different search."
                  : "Your saved conversations will appear here."}
              </small>
            </div>
          )}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={17} />
          <p>
            A clearer view of your portfolio.
            <span>Research. Explore. Understand.</span>
          </p>
        </div>
        <button className="account" onClick={() => setSettings(true)}>
          <span className="avatar">{user?.[0]?.toUpperCase() ?? "A"}</span>
          <span>
            {user ?? "Your workspace"}
            <small>{user ? "Personal workspace" : "Sign in to start"}</small>
          </span>
          <ChevronDown size={15} />
        </button>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <Button
              className="mobile-menu"
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </Button>
            {!sidebar && (
              <Button
                className="desktop-menu"
                variant="ghost"
                size="icon"
                aria-label="Expand sidebar"
                onClick={() => setSidebar(true)}
              >
                <Menu size={20} />
              </Button>
            )}
            <span className="workspace-title">
              {active?.title ?? "New conversation"}
            </span>
            <span className="research-tag">RESEARCH</span>
          </div>
          <div>
            <span className="private-label">
              <ShieldCheck size={13} />
              Private workspace
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={dark ? "Use light theme" : "Use dark theme"}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </Button>
            {active && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Show investment constraints"
                onClick={() => setDetails(!details)}
              >
                <SlidersHorizontal size={18} />
              </Button>
            )}
          </div>
        </header>
        {user && <ConnectionStatus />}
        <div className="workspace-body">
          <div className="chat-column">
            <div
              className="chat-scroll"
              ref={scroll}
              onScroll={() => {
                const el = scroll.current;
                if (el) {
                  nearBottom.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 120;
                  setScrollDown(!nearBottom.current);
                }
              }}
            >
              {!active?.messages.length ? (
                <section className="welcome">
                  <div className="welcome-mark">
                    <TrendingUp size={31} />
                  </div>
                  <div className="eyebrow">
                    THOUGHTFUL INVESTING STARTS WITH A CONVERSATION
                  </div>
                  <h1>Welcome to AlphaForge</h1>
                  <p>
                    Your AI-powered portfolio research
                    <br className="desktop-break" /> and optimization assistant.
                  </p>
                  <div className="prompt-grid">
                    {suggestions.map((s) => (
                      <button
                        key={s.title}
                        onClick={() => setDraft(s.text)}
                        disabled={!user}
                      >
                        <s.icon size={21} />
                        <strong>{s.title}</strong>
                        <span>{s.text}</span>
                        <ArrowUpRight size={16} />
                      </button>
                    ))}
                  </div>
                  <div className="welcome-footnote">
                    <ShieldCheck size={14} />
                    Your constraints. Transparent calculations. Informed
                    decisions.
                  </div>
                </section>
              ) : (
                <div className="messages">
                  {active.messages.map((m) => (
                    <article key={m.id} className={`message ${m.role}`}>
                      <div className="message-avatar">
                        {m.role === "assistant" ? (
                          <TrendingUp size={18} />
                        ) : (
                          user?.[0]
                        )}
                      </div>
                      <div className="message-content">
                        <div className="message-author">
                          {m.role === "assistant" ? "AlphaForge" : "You"}
                          {m.role === "assistant" && (
                            <span>Portfolio research</span>
                          )}
                        </div>
                        <div className="markdown">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                            components={{
                              a: (props) => (
                                <a
                                  {...props}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                />
                              ),
                              img: () => null,
                            }}
                          >
                            {m.content}
                          </ReactMarkdown>
                        </div>
                        {m.portfolios?.map((p, i) => (
                          <PortfolioPanel key={i} result={p} />
                        ))}
                        <button
                          className="copy-message"
                          aria-label="Copy message"
                          onClick={() => void copy(m.id, m.content)}
                        >
                          {copied === m.id ? (
                            <Check size={14} />
                          ) : (
                            <Copy size={14} />
                          )}{" "}
                          {copied === m.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {active?.status === "processing" && (
                <div className="processing" role="status">
                  <span className="processing-orb">
                    <Sparkles size={17} />
                  </span>
                  <div>
                    <strong>AlphaForge is working</strong>
                    <span>
                      Reviewing your conversation and running the analysis…
                    </span>
                  </div>
                </div>
              )}
              {active?.status === "uncertain" && (
                <div className="recovery" role="alert">
                  <strong>This conversation needs review</strong>
                  <p>{active.error}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void refresh()}
                  >
                    Refresh status
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void create()}
                  >
                    Start a new chat explicitly
                  </Button>
                  <p className="small">
                    Your existing chat and confirmed limits remain saved. A new
                    chat starts empty.
                  </p>
                </div>
              )}
              <div ref={bottom} />
            </div>
            {scrollDown && (
              <Button
                className="scroll-bottom"
                variant="secondary"
                size="icon"
                aria-label="Scroll to latest message"
                onClick={() => {
                  nearBottom.current = true;
                  bottom.current?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <ArrowDown size={17} />
              </Button>
            )}
            <div className="composer-area">
              {error && (
                <div className="error-banner" role="alert">
                  <span>{error}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Dismiss error"
                    onClick={() => setError(null)}
                  >
                    <X size={15} />
                  </Button>
                </div>
              )}
              {loaded && !user && (
                <div className="login-callout">
                  <div>
                    <strong>A private space for your research</strong>
                    <p>
                      Sign in securely to save conversations and manage your
                      constraints.
                    </p>
                  </div>
                  <Button asChild>
                    <a href="/api/auth/login">
                      Sign in <ArrowUpRight size={15} />
                    </a>
                  </Button>
                </div>
              )}
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draft.trim() && !blocked)
                    void send({ prompt: draft.trim(), action: "message" });
                }}
              >
                <textarea
                  aria-label="Message AlphaForge"
                  placeholder={
                    user
                      ? "Ask AlphaForge about your portfolio…"
                      : "Sign in to start a conversation"
                  }
                  value={draft}
                  maxLength={16000}
                  disabled={!user}
                  rows={2}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      if (draft.trim() && !blocked)
                        void send({ prompt: draft.trim(), action: "message" });
                    }
                  }}
                />
                <div className="composer-bottom">
                  <span>
                    <span className="connection-dot" />
                    Portfolio research{" "}
                    <span className="composer-separator">/</span>{" "}
                    <small>Snapshot data</small>
                  </span>
                  {busyId ? (
                    <Button
                      variant="secondary"
                      size="icon"
                      type="button"
                      aria-label="Stop waiting for response"
                      onClick={() => controller.current?.abort()}
                    >
                      <Square size={14} />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      type="submit"
                      disabled={blocked || !draft.trim()}
                      aria-label="Send message"
                    >
                      <ArrowUp size={18} />
                    </Button>
                  )}
                </div>
              </form>
              <p className="disclaimer">
                AlphaForge provides simulations, not personalized investment
                advice. Review assumptions and results.
              </p>
            </div>
          </div>
          {active && (
            <aside
              className={`insights ${details ? "insights-open" : ""}`}
              aria-label="Conversation constraints"
            >
              <div className="insights-mobile-heading">
                <strong>Conversation context</strong>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close constraints"
                  onClick={() => setDetails(false)}
                >
                  <X size={18} />
                </Button>
              </div>
              <Constraints
                key={active.id}
                conversation={active}
                disabled={!!blocked}
                onTurn={(t) => void send(t)}
              />
              <div className="context-note">
                <Sparkles size={17} />
                <h4>Built around your decisions</h4>
                <p>
                  Confirmed limits are retained across this conversation.
                  Proposed changes only take effect after your approval.
                </p>
                <span>Historical data · Read-only simulations</span>
              </div>
            </aside>
          )}
        </div>
      </main>
      <Dialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        title="Manage conversation"
        description="Rename this conversation, or remove its saved web history."
      >
        <label className="field">
          Title
          <input
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <Button
            disabled={
              !title.trim() ||
              editing?.status === "processing" ||
              editing?.status === "uncertain"
            }
            onClick={async () => {
              if (!editing) return;
              try {
                replace(
                  await api<Conversation>(
                    `/api/conversations/${editing.id}`,
                    "PATCH",
                    { title: title.trim(), version: editing.version },
                  ),
                );
                setEditing(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Save title
          </Button>
          <Button
            variant="destructive"
            disabled={editing?.status === "processing"}
            onClick={() => {
              setDeleting(editing);
              setEditing(null);
            }}
          >
            Delete conversation
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete this conversation?"
        description="This removes its saved web history and navigation entry. AgentCore Memory events remain until their configured retention expires; this is not a Memory erasure request."
      >
        <Button
          variant="destructive"
          onClick={async () => {
            if (!deleting) return;
            try {
              await api(`/api/conversations/${deleting.id}`, "DELETE", {
                version: deleting.version,
              });
              setConversations((all) =>
                all.filter((c) => c.id !== deleting.id),
              );
              if (activeId === deleting.id) setActiveId(null);
              setDeleting(null);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Delete saved history
        </Button>
      </Dialog>
      <Dialog
        open={settings}
        onOpenChange={setSettings}
        title="Your workspace"
        description="Private portfolio research, with the limits you choose."
      >
        <p className="settings-name">{user ?? "You are not signed in"}</p>
        <Button variant="secondary" onClick={() => setDark(!dark)}>
          {dark ? <Sun size={16} /> : <Moon size={16} />}Switch to{" "}
          {dark ? "light" : "dark"} mode
        </Button>
        {localWorkspace ? null : user ? (
          <Button
            variant="ghost"
            onClick={async () => {
              await api("/api/auth/logout", "POST", {});
              window.location.reload();
            }}
          >
            <LogOut size={16} />
            Sign out
          </Button>
        ) : (
          <Button asChild>
            <a href="/api/auth/login">Sign in</a>
          </Button>
        )}
        <p className="small muted">
          {localWorkspace
            ? "No sign-in is needed. Conversations are saved in this single-user local workspace."
            : "Sessions expire with your identity token. Signing in again keeps your saved conversations."}
        </p>
      </Dialog>
    </div>
  );
}

"use client";

import Script from "next/script";
import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUp, Square } from "lucide-react";

import { ChatMarkdown } from "@/components/chat-markdown";
import { FableDescent, type Descent } from "@/components/fable-descent";
import { Card } from "@/components/ui/card";
import { stableMarkdown } from "@/lib/streaming-markdown";
import { cn } from "@/lib/utils";
import { workerUrl } from "@/lib/worker-url";
import {
  GOD_CHAT_LIMITS,
  GOD_CHAT_PATH,
  GOD_CHAT_TURNSTILE_ACTION,
  GOD_CHAT_USAGE_PATH,
  type GodChatEvent,
  type GodChatMessage,
  type GodChatSource,
  fitHistory,
} from "@shared/god-chat";
import {
  GOD_CHAT_TIERS,
  GOD_CHAT_TIER_INFO,
  modelLabel,
  type GodChatCount,
  type GodChatTier,
  type GodChatUsage,
} from "@shared/god-chat-tiers";

type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

type DocRead = { doc: string; path: string; url: string; section?: string };
type Reply = {
  tier?: GodChatTier | null;
  downgradedFrom?: GodChatTier;
  servedBy?: string;
  lookups?: string[];
  docs?: DocRead[];
  searches?: string[];
  sources?: GodChatSource[];
};
type Bubble = GodChatMessage & Reply;

const CHAT_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, GOD_CHAT_PATH);
const OFFLINE = "The oracle is offline.";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
// 排着队的消息等组件渲染出来的最长时间；组件出来之后（可能在等访客点验证）交给 Turnstile 自己的超时回调。
const VERIFY_LOAD_TIMEOUT_MS = 15_000;
const VERIFY_UNAVAILABLE = "Human verification couldn't load. Check your connection or ad blocker, then reload the page.";
const COMMANDS = [
  { name: "/clear", aliases: ["/new"], description: "Start a new conversation with empty context" },
  { name: "/usage", aliases: [], description: "Show your quota in the current window" },
] as const;

type Command = (typeof COMMANDS)[number];
const commandNames = (c: Command): readonly string[] => [c.name, ...c.aliases];
const USAGE_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, GOD_CHAT_USAGE_PATH);
const USAGE_RETRY_MS = 5_000;
const EDGE_GAP_PX = 12;
// 每个示例各演示一种本事：读实时数据、读项目文档、联网搜索、深问题（Clef 可能请神，神每分钟额度有限，满了会降级）。
const SUGGESTIONS = [
  "What's LYJW listening to?",
  "How does this site get its live data?",
  "What's new in AI this week?",
  "Is free will an illusion?",
];

export function GodChat({ className }: { className?: string }) {
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [usage, setUsage] = useState<FetchedUsage | "loading" | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [descent, setDescent] = useState<Descent | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const pendingRef = useRef<string | null>(null);
  const verifyStateRef = useRef<"ok" | "failed" | "unavailable">("ok");
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef(0);
  const sendRef = useRef<(text: string, token: string) => void>(() => {});

  useEffect(() => {
    const el = widgetRef.current;
    if (!scriptReady || !SITE_KEY || !el || !window.turnstile || widgetId.current) return;
    widgetId.current = window.turnstile.render(el, {
      sitekey: SITE_KEY,
      action: GOD_CHAT_TURNSTILE_ACTION,
      appearance: "interaction-only",
      theme: "auto",
      language: "en",
      callback: (value: string) => {
        const pending = pendingRef.current;
        if (pending) {
          pendingRef.current = null;
          sendRef.current(pending, value);
        } else {
          setToken(value);
        }
      },
      "expired-callback": () => setToken(null),
      "error-callback": () => {
        setToken(null);
        verificationFailed("Human verification failed. Send again to retry.", "failed");
      },
      "timeout-callback": () => verificationFailed("Human verification timed out. Send again to retry.", "failed"),
    });
    return () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [scriptReady]);

  useEffect(
    () => () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    },
    [],
  );

  // 验人起不来（脚本被拦或加载失败、组件出错、超时）时，排队的消息退回输入框并报错，不能一直卡在「验证中」。
  function verificationFailed(message: string, state: "failed" | "unavailable") {
    verifyStateRef.current = state;
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) setDraft((current) => current || pending);
    setError(message);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const header = document.querySelector<HTMLElement>("header.sticky");
    if (!header) return;
    const observer = new ResizeObserver(() => setHeaderHeight(header.offsetHeight));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  async function send(text: string, usedToken: string) {
    const content = text.trim();
    if (!content) return;
    // 界面上的气泡保留档位与查询记录；发给 Worker 的历史另行裁剪、改写成 trace，不能回写界面。
    const shown: Bubble[] = [...messages, { role: "user", content }];
    const history: GodChatMessage[] = fitHistory(
      shown.map(({ role, content, tier, servedBy, lookups, docs, searches }): GodChatMessage => {
        if (role !== "assistant") return { role, content };
        const trace = {
          ...(tier && { tier }),
          ...(lookups?.length && { views: lookups }),
          ...(docs?.length && { docs: [...new Set(docs.map((read) => read.doc))] }),
          ...(searches?.length && { searches: searches.length }),
          ...(servedBy && { fallback: true as const }),
        };
        return Object.keys(trace).length ? { role, content, trace } : { role, content };
      }),
    );
    let reply = "";
    let meta: Reply = {};
    const session = sessionRef.current;
    const bubble = (): Bubble => ({ role: "assistant", content: reply, ...meta });
    const show = () => {
      if (sessionRef.current === session) setMessages([...shown, bubble()]);
    };
    stickRef.current = true;
    if (!messages.length) reveal();
    show();
    // 等验证期间输入框还能改，回调发的是排队时那条；框里已经不是它就别清，免得吞掉访客新改的草稿。
    setDraft((current) => (current === text ? "" : current));
    setError(null);
    setStreaming(true);
    setToken(null);
    if (widgetId.current) window.turnstile?.reset(widgetId.current);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (!CHAT_URL) throw new Error(OFFLINE);
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, turnstileToken: usedToken }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? OFFLINE);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line) as GodChatEvent;
          if (event.type === "text") reply += event.text;
          else if (event.type === "route") {
            meta = { ...meta, tier: event.tier, downgradedFrom: event.downgradedFrom };
            if (event.tier === "fable" && sessionRef.current === session) summon();
          } else if (event.type === "served") meta = { ...meta, servedBy: event.model };
          else if (event.type === "tool") {
            const seen = meta.lookups ?? [];
            meta = { ...meta, lookups: [...seen, ...event.views.filter((view) => !seen.includes(view))] };
          } else if (event.type === "doc") {
            const { doc, path, url, section } = event;
            meta = { ...meta, docs: [...(meta.docs ?? []), { doc, path, url, section }] };
          } else if (event.type === "search") meta = { ...meta, searches: [...(meta.searches ?? []), event.query] };
          else if (event.type === "sources") meta = { ...meta, sources: event.sources };
        }
        show();
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : OFFLINE);
    } finally {
      if (sessionRef.current === session) {
        setMessages(reply ? [...shown, bubble()] : shown.slice(0, -1));
        if (!reply) setDraft((current) => current || content);
      }
      setStreaming(false);
      abortRef.current = null;
    }
  }

  useEffect(() => {
    sendRef.current = (text, value) => void send(text, value);
  });

  const typing = draft.trimStart();
  const paletteOpen = typing.startsWith("/") && !/\s/.test(typing.trim());
  const query = typing.trim().toLowerCase();
  const matches = paletteOpen ? COMMANDS.filter((c) => commandNames(c).some((n) => n.startsWith(query))) : [];
  const active = matches.length ? Math.min(selected, matches.length - 1) : 0;

  function runCommand(name: string) {
    setDraft("");
    setSelected(0);
    if (name === "/usage") {
      void showUsage();
      return;
    }
    if (name === "/clear") {
      sessionRef.current += 1;
      abortRef.current?.abort();
      pendingRef.current = null;
      setMessages([]);
      setError(null);
    }
  }

  async function showUsage(quiet = false) {
    setError(null);
    if (!quiet) setUsage("loading");
    try {
      if (!USAGE_URL) throw new Error(OFFLINE);
      const res = await fetch(USAGE_URL, { cache: "no-store" });
      if (res.status === 429 && quiet) {
        // 倒计时到点的自动刷新被限流时，面板上的数先留着，过几秒再取一次。
        setUsage((current) =>
          current && current !== "loading"
            ? { ...current, resetInMs: USAGE_RETRY_MS, resetAt: Date.now() + USAGE_RETRY_MS }
            : current,
        );
        return;
      }
      if (res.status === 429) throw new Error("Too many usage checks. Try again in a few seconds.");
      if (!res.ok) throw new Error(OFFLINE);
      const data = (await res.json()) as GodChatUsage;
      setUsage((current) => (current === null && quiet ? null : { ...data, resetAt: Date.now() + data.resetInMs }));
    } catch (err) {
      setUsage(null);
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : OFFLINE);
    }
  }

  function submit(text: string) {
    if (text.trim().startsWith("/")) {
      const exact = COMMANDS.find((c) => commandNames(c).includes(text.trim().toLowerCase()));
      const pick = exact ?? matches[active];
      if (pick) runCommand(pick.name);
      else setError(`Unknown command ${text.trim().split(/\s+/)[0]}.`);
      return;
    }
    ask(text);
  }

  function ask(text: string) {
    if (!text.trim() || streaming) return;
    setUsage(null);
    if (!SITE_KEY || verifyStateRef.current === "unavailable") {
      setError(SITE_KEY ? VERIFY_UNAVAILABLE : OFFLINE);
      return;
    }
    if (token) {
      void send(text, token);
      return;
    }
    if (verifyStateRef.current === "failed" && widgetId.current) window.turnstile?.reset(widgetId.current);
    verifyStateRef.current = "ok";
    setError(null);
    pendingRef.current = text;
    setDraft(text);
    setArmed(true);
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => {
      if (pendingRef.current && !widgetId.current) verificationFailed(VERIFY_UNAVAILABLE, "unavailable");
    }, VERIFY_LOAD_TIMEOUT_MS);
  }

  // 卡片从紧凑高度长到视口高度时顶边不动、往下长；把顶边滚到吸顶页头下面，长完正好占满可见区域，上下各留 EDGE_GAP_PX。
  function reveal() {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const top = anchor.getBoundingClientRect().top + window.scrollY - headerHeight - EDGE_GAP_PX;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top, behavior: still ? "auto" : "smooth" });
  }

  function summon() {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const key = Date.now();
    setDescent({ key, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, top: rect.top });
    setTimeout(() => setDescent((current) => (current?.key === key ? null : current)), 4_800);
  }

  const waiting = armed && !token && !streaming && !error;
  const godSpeaking = streaming && messages[messages.length - 1]?.tier === "fable";
  const expanded = messages.length > 0;

  return (
    <Card
      label="Talk to God"
      action={<RouteStatus last={messages[messages.length - 1]} streaming={streaming} />}
      className={cn(
        "transition-[height,box-shadow] duration-700 ease-out motion-reduce:transition-none",
        expanded ? "h-[calc(100dvh-var(--chat-inset))]" : "h-[25rem] sm:h-[22rem]",
        godSpeaking && "god-halo",
        className,
      )}
      style={{ "--chat-inset": `${headerHeight + 2 * EDGE_GAP_PX}px` } as CSSProperties}
    >
      <div ref={anchorRef} className="pointer-events-none absolute inset-0" aria-hidden />
      <FableDescent descent={descent} />
      {armed && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onReady={() => setScriptReady(true)}
          onError={() => verificationFailed(VERIFY_UNAVAILABLE, "unavailable")}
        />
      )}
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 [&::-webkit-scrollbar]:hidden"
      >
        {messages.length === 0 ? (
          <div className="m-auto flex max-w-md flex-col items-center gap-3 py-2 text-center">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Ask anything. The oracle sees what LYJW is up to, knows how this site is built, and can search the web.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={streaming}
                  onClick={() => submit(suggestion)}
                  className="paper-card rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-surface-hover disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => {
            const live = streaming && index === messages.length - 1;
            return (
              <div key={index} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "min-w-0 rounded-lg px-3 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]",
                    message.role === "user" ? "max-w-[85%]" : "max-w-full sm:max-w-[85%]",
                    message.role === "user"
                      ? "whitespace-pre-wrap bg-foreground text-background"
                      : message.tier === "fable"
                        ? "border border-[#f5c542] bg-muted text-foreground shadow-[0_0_24px_-8px_rgba(245,197,66,0.8)]"
                        : "border border-line bg-muted text-foreground",
                  )}
                >
                  {message.role === "assistant" && message.tier !== undefined && <RankLabel reply={message} />}
                  {message.lookups?.length ? (
                    <div className="label-mono mb-1.5 text-[10px] text-muted-foreground">
                      Looked at {message.lookups.join(", ")}
                    </div>
                  ) : null}
                  {message.docs?.map((read, i) => (
                    <div key={i} className="label-mono mb-1.5 text-[10px] text-muted-foreground">
                      Read{" "}
                      <a
                        href={read.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        {read.path}
                      </a>
                      {read.section && <> › {read.section}</>}
                    </div>
                  ))}
                  {message.searches?.map((query, i) => (
                    <div key={i} className="label-mono mb-1.5 text-[10px] text-muted-foreground">
                      Searched “{query}”
                    </div>
                  ))}
                  {!message.content ? (
                    <span className="animate-pulse text-muted-foreground">…</span>
                  ) : message.role === "assistant" ? (
                    <ChatMarkdown>{live ? stableMarkdown(message.content) : message.content}</ChatMarkdown>
                  ) : (
                    message.content
                  )}
                  {message.sources?.length ? (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2 text-[11px]">
                      {message.sources.map((source) => (
                        <a
                          key={source.url}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="max-w-full truncate text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          {source.title}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-line p-3">
        {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
        {usage && <UsagePanel usage={usage} onClose={() => setUsage(null)} onReset={() => void showUsage(true)} />}
        <div ref={widgetRef} />
        <form
          className="relative flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          {paletteOpen && (
            <div
              role="listbox"
              aria-label="Commands"
              className="absolute inset-x-0 bottom-full z-10 mb-2 overflow-hidden rounded-md border border-line-strong bg-surface py-1 shadow-lg"
            >
              {matches.length ? (
                matches.map((command, i) => (
                  <button
                    key={command.name}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setSelected(i)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => runCommand(command.name)}
                    className={cn(
                      "flex w-full items-baseline gap-3 px-3 py-1.5 text-left font-mono text-xs",
                      i === active ? "bg-surface-hover text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span className="w-3 shrink-0">{i === active ? "❯" : ""}</span>
                    <span className="shrink-0 text-foreground">
                      {command.name}
                      {command.aliases.length > 0 && ` (${command.aliases.map((a) => a.slice(1)).join(", ")})`}
                    </span>
                    <span className="truncate">{command.description}</span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-1.5 font-mono text-xs text-muted-foreground">No matching commands</div>
              )}
            </div>
          )}
          <textarea
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setSelected(0);
            }}
            onFocus={() => setArmed(true)}
            onKeyDown={(event) => {
              if (paletteOpen && matches.length) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setSelected((active + step + matches.length) % matches.length);
                  return;
                }
                if (event.key === "Tab") {
                  event.preventDefault();
                  setDraft(matches[active].name);
                  return;
                }
              }
              if (!paletteOpen && usage && event.key === "Escape") {
                event.preventDefault();
                setUsage(null);
                return;
              }
              if (paletteOpen && event.key === "Escape") {
                event.preventDefault();
                setDraft("");
                return;
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit(draft);
              }
            }}
            maxLength={GOD_CHAT_LIMITS.maxMessageChars}
            rows={1}
            placeholder={waiting ? "Verifying you are human…" : "Speak, mortal… (type /)"}
            aria-label="Message"
            className="scrollbar-none max-h-32 min-h-10 flex-1 resize-none rounded-md border border-line-strong bg-surface px-3 py-2 text-base outline-none [field-sizing:content] placeholder:text-muted-foreground focus:border-foreground/40 sm:text-sm [&::-webkit-scrollbar]:hidden"
          />
          {streaming ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={() => abortRef.current?.abort()}
              className="paper-card flex size-10 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface text-foreground transition-colors hover:bg-surface-hover"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!draft.trim()}
              className="flex size-10 shrink-0 items-center justify-center rounded-md bg-foreground text-background transition-opacity disabled:opacity-30"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </form>
      </div>
    </Card>
  );
}

const RANK_TONE: Record<GodChatTier, string> = {
  fable: "god-aura bg-clip-text text-transparent font-bold",
  opus: "text-foreground",
  haiku: "text-muted-foreground opacity-70",
};

function RankLabel({ reply }: { reply: Reply }) {
  if (reply.tier === null) {
    return <div className="label-mono mb-1.5 text-[10px] text-red-500">Gates closed</div>;
  }
  if (!reply.tier) return null;
  const { persona, label } = GOD_CHAT_TIER_INFO[reply.tier];
  return (
    <div className="mb-1.5">
      <div className={cn("label-mono text-[10px]", RANK_TONE[reply.tier])}>
        {persona} · {reply.servedBy ? modelLabel(reply.servedBy) : label}
      </div>
      {reply.downgradedFrom && (
        <div className="label-mono text-[10px] text-muted-foreground">
          {GOD_CHAT_TIER_INFO[reply.downgradedFrom].persona} is resting; the {persona} answers instead
        </div>
      )}
      {reply.servedBy && (
        <div className="label-mono text-[10px] text-muted-foreground">
          {label} declined; {modelLabel(reply.servedBy)} stood in
        </div>
      )}
    </div>
  );
}

function RouteStatus({ last, streaming }: { last?: Bubble; streaming: boolean }) {
  if (!last || last.role !== "assistant") return <>Routed by Clef</>;
  if (last.tier === undefined) return <span className={cn(streaming && "animate-pulse")}>Clef routing…</span>;
  if (last.tier === null) return <span className="text-red-500">Gates closed</span>;
  const { persona, label } = GOD_CHAT_TIER_INFO[last.tier];
  return (
    <span>
      <span className="hidden sm:inline">Clef → </span>
      <span className={RANK_TONE[last.tier]}>
        {persona} · {last.servedBy ? modelLabel(last.servedBy) : label}
      </span>
      {last.downgradedFrom && (
        <span className="hidden sm:inline"> ({GOD_CHAT_TIER_INFO[last.downgradedFrom].persona} resting)</span>
      )}
      {last.servedBy && <span className="hidden sm:inline"> ({label} declined)</span>}
    </span>
  );
}

function UsageBar({ count }: { count: GodChatCount }) {
  const full = count.used >= count.limit;
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full", full ? "bg-red-500" : "bg-foreground/60")}
          style={{ width: `${Math.min(100, (count.used / count.limit) * 100)}%` }}
        />
      </span>
      <span className={cn("tabular-nums", full && "text-red-500")}>
        {count.used}/{count.limit}
      </span>
    </span>
  );
}

type FetchedUsage = GodChatUsage & { resetAt: number };

function useCountdown(resetAt: number | null, onReset: () => void): number {
  const [now, setNow] = useState(() => Date.now());
  const onResetRef = useRef(onReset);
  useEffect(() => {
    onResetRef.current = onReset;
  });
  useEffect(() => {
    if (resetAt === null) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= resetAt) {
        clearInterval(timer);
        onResetRef.current();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [resetAt]);
  return resetAt === null ? 0 : Math.max(0, Math.ceil((resetAt - now) / 1000));
}

function UsagePanel({
  usage,
  onClose,
  onReset,
}: {
  usage: FetchedUsage | "loading";
  onClose: () => void;
  onReset: () => void;
}) {
  const ticking = usage !== "loading" && usage.resetInMs > 0 ? usage.resetAt : null;
  const secondsLeft = useCountdown(ticking, onReset);
  return (
    <div className="mb-2 rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-[11px] text-muted-foreground">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-foreground">
          Usage
          {usage !== "loading" && (
            <>
              {" "}· {usage.windowMs / 1000}s window
              {ticking !== null && <> · resets in {secondsLeft}s</>}
            </>
          )}
        </span>
        <button type="button" onClick={onClose} aria-label="Close usage" className="hover:text-foreground">
          esc
        </button>
      </div>
      {usage === "loading" ? (
        <div className="animate-pulse">Asking the temple…</div>
      ) : (
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1">
          <span />
          <span className="label-mono text-[9px]">you</span>
          <span className="label-mono text-[9px]">whole site</span>
          <span>All messages</span>
          <UsageBar count={usage.visitor} />
          <span>—</span>
          {[...GOD_CHAT_TIERS].reverse().map((tier) => (
            <Fragment key={tier}>
              <span className={cn("truncate", RANK_TONE[tier])}>
                {GOD_CHAT_TIER_INFO[tier].persona} · {GOD_CHAT_TIER_INFO[tier].label}
              </span>
              <UsageBar count={usage.tiers[tier].visitor} />
              <UsageBar count={usage.tiers[tier].everyone} />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}


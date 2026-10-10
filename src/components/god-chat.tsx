"use client";

import Script from "next/script";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { ArrowUp, History, PencilRuler, Plus, Square, Trash2 } from "lucide-react";

import { ChatCard } from "@/components/chat-card";
import { ChatMarkdown } from "@/components/chat-markdown";
import { FableDescent, type Descent } from "@/components/fable-descent";
import { AnswerCard, AskCard, askAnswerText } from "@/components/ask-card";
import { BuildPlanCard } from "@/components/build-plan-card";
import { Card } from "@/components/ui/card";
import { stableMarkdown } from "@/lib/streaming-markdown";
import { chatConsent } from "@/lib/chat-consent";
import { textLanguage, type PlanLanguage } from "@shared/build-routine";
import { activeChatDesign, chatArchive, chatReplyMessages, designSessionEnded, subscribeChatArchive, type ChatAnswer, type ChatArchive, type ChatBubble, type ChatDesign, type ChatSession } from "@/lib/chat-archive";
import { cn } from "@/lib/utils";
import { workerUrl } from "@/lib/worker-url";
import {
  GOD_CHAT_LIMITS,
  GOD_CHAT_PATH,
  GOD_CHAT_TURNSTILE_ACTION,
  GOD_CHAT_USAGE_PATH,
  type GodChatCard,
  type GodChatEvent,
  type GodChatMessage,
  fitHistory,
} from "@shared/god-chat";
import {
  GOD_CHAT_TIERS,
  GOD_CHAT_TIER_INFO,
  modelLabel,
  type GodChatCount,
  type GodChatServedTier,
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

// at 是收到卡片时这条回复已有的正文长度，卡片画在那个位置。
type ShownCard = { card: GodChatCard; at: number };
type Reply = Omit<ChatBubble, "role" | "content">;
type Bubble = ChatBubble;
type Resumed = { user: Bubble & { id: string }; before: Bubble[]; handoff: boolean };
const RESUME_DELAY_MS = 2000;
const EMPTY_MESSAGES: Bubble[] = [];
// 须与 globals.css 里 .design-halo 的动画总时长一致。
const DESIGN_HALO_MS = 2_400;

const CHAT_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, GOD_CHAT_PATH);
const OFFLINE = "The oracle is offline.";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
// 排着队的消息等组件渲染出来的最长时间；组件出来之后（可能在等访客点验证）交给 Turnstile 自己的超时回调。
const VERIFY_LOAD_TIMEOUT_MS = 15_000;
const VERIFY_UNAVAILABLE = "Human verification couldn't load. Check your connection or ad blocker, then reload the page.";
const PASS_KEY = "lyjw.chat.pass";
const PASS_MARGIN_MS = 30_000;
type HumanPass = { pass: string; expiresAt: number };

function readPass(): HumanPass | null {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(PASS_KEY) ?? "null");
    if (value && typeof value === "object" && typeof (value as HumanPass).pass === "string" && typeof (value as HumanPass).expiresAt === "number" && (value as HumanPass).expiresAt - PASS_MARGIN_MS > Date.now()) return value as HumanPass;
  } catch {}
  return null;
}

function writePass(pass: HumanPass | null) {
  try {
    if (pass) window.sessionStorage.setItem(PASS_KEY, JSON.stringify(pass));
    else window.sessionStorage.removeItem(PASS_KEY);
  } catch {}
}

const COMMANDS = [
  { name: "/clear", aliases: ["/new"], description: "Start a new conversation with empty context" },
  { name: "/usage", aliases: [], description: "Show your quota in the current window" },
  { name: "/exit", aliases: [], description: "Leave design mode and return to ordinary chat" },
] as const;

type Command = (typeof COMMANDS)[number];
const commandNames = (c: Command): readonly string[] => [c.name, ...c.aliases];
const USAGE_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, GOD_CHAT_USAGE_PATH);
const USAGE_RETRY_MS = 5_000;
const EDGE_GAP_PX = 12;
// 站主要求示例用中文，是「界面文案英文」的例外；四条依次展示实时状态卡片、项目文档、联网搜索、改站规划与构建。
const SUGGESTIONS = [
  "LYJW 正在听什么歌？",
  "这个网站的实时数据是怎么来的？",
  "帮我搜一下这周 AI 圈的新闻",
  "我想给这个网站加个小功能",
];

export function GodChat({ className }: { className?: string }) {
  const archive = useSyncExternalStore(subscribeChatArchive, chatArchive.getSnapshot, chatArchive.getServerSnapshot);
  const session = archive.sessions.find((entry) => entry.id === archive.activeId);
  return <Conversation key={session?.id ?? "empty"} className={className} archive={archive} session={session} />;
}

function Conversation({ className, archive, session: conversation }: { className?: string; archive: ChatArchive; session?: ChatSession }) {
  const messages = conversation?.messages ?? EMPTY_MESSAGES;
  const setMessages = (next: Bubble[], persist = true) => { if (conversation) chatArchive.update(conversation.id, { messages: next }, { persist }); };
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [usage, setUsage] = useState<FetchedUsage | "loading" | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [warm, setWarm] = useState(false);
  const [descent, setDescent] = useState<Descent | null>(null);
  const consented = useSyncExternalStore(chatConsent.subscribe, chatConsent.getSnapshot, chatConsent.getServerSnapshot);
  const [consentPending, setConsentPending] = useState<string | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [designHalo, setDesignHalo] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const pendingRef = useRef<string | null>(null);
  // 选项卡的回答以文本发给模型，界面上按这份结构画成卡片；Turnstile 延后发送时按文本对上。
  const answersRef = useRef<{ text: string; answers: ChatAnswer[] } | null>(null);
  const verifyStateRef = useRef<"ok" | "failed" | "unavailable">("ok");
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiredRef = useRef(false);
  const sessionRef = useRef(0);
  const sendRef = useRef<(text: string, token?: string) => void>(() => {});
  const resumeRef = useRef<() => void>(() => {});
  const conversationId = conversation?.id;
  const design = conversation?.design;

  useEffect(() => {
    if (!conversationId || !design) return;
    const expire = () => {
      const current = chatArchive.getSnapshot().sessions.find((entry) => entry.id === conversationId);
      if (current?.design?.token === design.token && !activeChatDesign(current.design)) chatArchive.update(conversationId, { design: undefined });
    };
    if (!activeChatDesign(design)) { expire(); return; }
    const timer = setTimeout(expire, Math.max(0, design.expiresAt - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [conversationId, design]);

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
          setQueued(null);
          sendRef.current(pending, value);
        } else {
          setToken(value);
        }
      },
      // token 约 5 分钟过期；默认自动续会让开着页面的访客隔几分钟就在后台重跑一次挑战，改为下次发送时才重新验。
      "refresh-expired": "manual",
      "expired-callback": () => {
        expiredRef.current = true;
        setToken(null);
      },
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
      abortRef.current?.abort();
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
    setQueued(null);
    if (pending) setDraft((current) => current || pending);
    setError(message);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        if (!readPass() && chatConsent.getSnapshot()) setWarm(true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const header = document.querySelector<HTMLElement>("header.sticky");
    if (!header) return;
    const observer = new ResizeObserver(() => setHeaderHeight(header.offsetHeight));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  async function send(text: string, usedToken?: string, resumed?: Resumed) {
    const content = resumed?.user.content ?? text.trim();
    if (!content) return;
    // 界面上的气泡保留档位与查询记录；发给 Worker 的历史另行裁剪，只原样带回 Worker 下发的 trace 与章，不能回写界面。
    const answers = !resumed && answersRef.current?.text.trim() === content ? answersRef.current.answers : undefined;
    if (!resumed) answersRef.current = null;
    const user: Bubble & { id: string } = resumed?.user ?? { id: crypto.randomUUID(), role: "user", content, ...(answers && { answers }) };
    const shown: Bubble[] = [...(resumed?.before ?? messages), user];
    const history: GodChatMessage[] = fitHistory(
      shown
        .filter(({ content }) => content.trim())
        .map(({ role, content, trace, seal, planToken }): GodChatMessage =>
          role === "assistant" ? { role, content, ...(trace && { trace }), ...(seal && { seal }), ...(planToken && { planToken }) } : { role, content },
        ),
    );
    let reply = "";
    // 补发只取回规划者那一段，交接回合里 Sonnet 的开场白拿不回来，分隔线画在最前面。
    let meta: Reply = resumed?.handoff ? { designAt: 0 } : {};
    const session = sessionRef.current;
    const bubble = (): Bubble => ({ role: "assistant", content: reply, ...meta });
    const replyMessages = (next?: Bubble) => chatReplyMessages(
      conversation ? chatArchive.getSnapshot().sessions.find((entry) => entry.id === conversation.id)?.messages ?? messages : messages,
      user,
      next,
    );
    const show = () => {
      if (sessionRef.current === session) setMessages(replyMessages(bubble()), false);
    };
    stickRef.current = true;
    if (!messages.length) reveal();
    show();
    // 等验证期间输入框还能改，回调发的是排队时那条；框里已经不是它就别清，免得吞掉访客新改的草稿。
    if (!resumed) setDraft((current) => (current === text ? "" : current));
    setError(null);
    setStreaming(true);
    if (usedToken) {
      setToken(null);
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let designToken: string | undefined;
    let answered = false;
    let dropped = false;
    try {
      if (!CHAT_URL) throw new Error(OFFLINE);
      const humanPass = usedToken ? null : readPass();
      designToken = activeChatDesign(conversation?.design)?.token;
      if (conversation?.design && !designToken) chatArchive.update(conversation.id, { design: undefined }, { persist: false });
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, ...(usedToken ? { turnstileToken: usedToken } : { humanPass: humanPass?.pass }), ...(designToken && { designToken }), ...(resumed && { resume: true }) }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
        if (data?.code === "human_pass_expired") writePass(null);
        if (conversation && designSessionEnded(data?.code)) {
          chatArchive.update(conversation.id, { design: undefined }, { persist: false });
          throw new Error("Design session ended. Send your message again to continue in ordinary chat.");
        }
        throw new Error(data?.error ?? OFFLINE);
      }
      answered = true;
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
          else if (event.type === "thinking") meta = { ...meta, thinking: (meta.thinking ?? "") + event.text };
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
          else if (event.type === "step") meta = { ...meta, steps: [...(meta.steps ?? []), event.text] };
          else if (event.type === "sources") meta = { ...meta, sources: event.sources };
          else if (event.type === "pass") writePass({ pass: event.pass, expiresAt: event.expiresAt });
          else if (event.type === "seal") meta = { ...meta, seal: event.seal, trace: event.trace, planToken: event.planToken };
          else if (event.type === "card") {
            meta = { ...meta, cards: [...(meta.cards ?? []), { card: event.card, at: reply.length }] };
          } else if (event.type === "design" && conversation) {
            // 连同访客这条一起存下：刷新或断线后要靠它补发规划者的回复。
            chatArchive.update(conversation.id, { design: activeChatDesign({ token: event.token, expiresAt: event.expiresAt, remaining: event.remaining }) });
            if (!designToken && meta.designAt === undefined) {
              meta = { ...meta, designAt: reply.length };
              if (sessionRef.current === session) {
                setDesignHalo(true);
                setTimeout(() => setDesignHalo(false), DESIGN_HALO_MS);
              }
            }
          } else if (event.type === "ask") {
            meta = { ...meta, asks: event.questions };
          } else if (event.type === "plan") {
            meta = { ...meta, proposals: [...(meta.proposals ?? []), { plan: event.plan, token: event.token, expiresAt: event.expiresAt }] };
          }
        }
        show();
      }
    } catch (err) {
      // 设计会话里请求已到 Worker 后断线，规划者那一回合照样跑完、轮数也扣了：留住访客这条，稍后补发错过的回复。
      if (!controller.signal.aborted) {
        if ((designToken && err instanceof TypeError) || (answered && (designToken || meta.designAt !== undefined))) dropped = true;
        else setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : OFFLINE);
      }
    } finally {
      if (sessionRef.current === session) {
        const kept = reply || meta.cards?.length || meta.proposals?.length || meta.asks?.length;
        if (dropped) {
          setMessages([...replyMessages(), user, ...(kept ? [bubble()] : [])]);
          if (resumed) setError("The connection dropped. Reload the page to get the rest of the reply.");
          else setTimeout(() => resumeRef.current(), RESUME_DELAY_MS);
        } else {
          setMessages(replyMessages(kept ? bubble() : undefined));
          if (!kept) setDraft((current) => current || content);
        }
      }
      setStreaming(false);
      abortRef.current = null;
    }
  }

  // 设计会话里最后一条访客消息还没拿到盖了章的回复：从会话里取回它错过的那一回合。
  function resume() {
    // 补发不走 Turnstile：没有有效通行证或对话代码变了还没重新同意时留着那两条，等访客自己再发。
    if ((abortRef.current && !abortRef.current.signal.aborted) || !conversation || !readPass() || !chatConsent.getSnapshot()) return;
    const current = chatArchive.getSnapshot().sessions.find((entry) => entry.id === conversation.id);
    if (!current || !activeChatDesign(current.design)) return;
    const list = current.messages;
    const at = list.map((message) => message.role).lastIndexOf("user");
    if (at < 0 || at < list.length - 2 || list[at + 1]?.seal) return;
    const user = { ...list[at], id: list[at].id ?? crypto.randomUUID() };
    if (!list[at].id) setMessages([...list.slice(0, at), user, ...list.slice(at + 1)], false);
    void send(user.content, undefined, { user, before: list.slice(0, at), handoff: list[at + 1]?.designAt !== undefined });
  }

  useEffect(() => {
    sendRef.current = (text, value) => void send(text, value);
    resumeRef.current = resume;
  });

  useEffect(() => {
    const timer = setTimeout(() => resumeRef.current(), 0);
    return () => clearTimeout(timer);
  }, []);

  const typing = draft.trimStart();
  const paletteOpen = typing.startsWith("/") && !/\s/.test(typing.trim());
  const query = typing.trim().toLowerCase();
  const commands = COMMANDS.filter((c) => c.name !== "/exit" || design);
  const matches = paletteOpen ? commands.filter((c) => commandNames(c).some((n) => n.startsWith(query))) : [];
  const active = matches.length ? Math.min(selected, matches.length - 1) : 0;

  function runCommand(name: string) {
    setDraft("");
    setSelected(0);
    if (name === "/usage") {
      void showUsage();
      return;
    }
    if (name === "/exit") {
      if (!conversation?.design) return;
      if (streaming) {
        sessionRef.current += 1;
        abortRef.current?.abort();
      }
      chatArchive.update(conversation.id, { design: undefined });
      return;
    }
    if (name === "/clear") {
      sessionRef.current += 1;
      abortRef.current?.abort();
      pendingRef.current = null;
      setQueued(null);
      setError(null);
      chatArchive.start();
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
      const exact = commands.find((c) => commandNames(c).includes(text.trim().toLowerCase()));
      const pick = exact ?? matches[active];
      if (pick) runCommand(pick.name);
      else setError(`Unknown command ${text.trim().split(/\s+/)[0]}.`);
      return;
    }
    ask(text);
  }

  function answer(answers: ChatAnswer[]) {
    const text = askAnswerText(answers);
    answersRef.current = { text, answers };
    ask(text);
  }

  function ask(text: string) {
    if (!text.trim() || streaming) return;
    setUsage(null);
    // 同意前消息只留在本地、不发给 Worker；站主要求说明一出现就在后台跑 Turnstile，访客读完点接受时多半已验完，可以直接发。
    if (!chatConsent.getSnapshot()) {
      if (!messages.length && consentPending === null) reveal();
      setConsentPending(text.trim());
      setDraft("");
      setError(null);
      if (SITE_KEY && !readPass()) setArmed(true);
      return;
    }
    if (!SITE_KEY || verifyStateRef.current === "unavailable") {
      setError(SITE_KEY ? VERIFY_UNAVAILABLE : OFFLINE);
      return;
    }
    if (readPass()) {
      void send(text);
      return;
    }
    if (token) {
      void send(text, token);
      return;
    }
    if ((verifyStateRef.current === "failed" || expiredRef.current) && widgetId.current) window.turnstile?.reset(widgetId.current);
    expiredRef.current = false;
    verifyStateRef.current = "ok";
    setError(null);
    pendingRef.current = text;
    setQueued(text);
    setDraft("");
    setArmed(true);
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => {
      if (pendingRef.current && !widgetId.current) verificationFailed(VERIFY_UNAVAILABLE, "unavailable");
    }, VERIFY_LOAD_TIMEOUT_MS);
  }

  function acceptConsent() {
    const text = consentPending;
    setConsentPending(null);
    chatConsent.accept();
    if (text) ask(text);
  }

  function declineConsent() {
    const text = consentPending;
    setConsentPending(null);
    if (text) setDraft((current) => current || text);
    setError(CONSENT_COPY[textLanguage(text ?? "")].declined);
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
  const expanded = messages.length > 0 || consentPending !== null || queued !== null;

  return (
    // 对话、设计与构建计划包含访客原文，Replay 需要遮住整张卡片。
    <Card
      data-sentry-mask
      label="Talk to God"
      action={conversation?.design ? <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400"><PencilRuler className="size-3" />Design · Opus</span> : <RouteStatus last={messages[messages.length - 1]} streaming={streaming} />}
      className={cn(
        "transition-[height,box-shadow] duration-700 ease-out motion-reduce:transition-none",
        expanded ? "h-[calc(100dvh-var(--chat-inset))]" : "h-[25rem] sm:h-[22rem]",
        godSpeaking && "god-halo",
        designHalo && !godSpeaking && "design-halo",
        className,
      )}
      style={{ "--chat-inset": `${headerHeight + 2 * EDGE_GAP_PX}px` } as CSSProperties}
    >
      <div ref={anchorRef} className="pointer-events-none absolute inset-0" aria-hidden />
      <FableDescent descent={descent} />
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-xs text-muted-foreground">
        <button type="button" onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen} className="flex min-w-0 items-center gap-1.5 hover:text-foreground"><History className="size-3.5 shrink-0" /><span className="truncate">Conversations{savedSessions(archive).length > 0 ? ` (${savedSessions(archive).length})` : ""}</span></button>
        <button type="button" onClick={() => runCommand("/clear")} className="flex shrink-0 items-center gap-1 hover:text-foreground"><Plus className="size-3.5" />New</button>
      </div>
      {historyOpen && <SessionList archive={archive} />}
      {(armed || warm) && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onReady={() => setScriptReady(true)}
          onError={() => verificationFailed(VERIFY_UNAVAILABLE, "unavailable")}
        />
      )}
      {/* 遮罩只遮文字，链接的 href 照样进录像（rrweb 对 href、src 不走属性遮罩），模型能把对话拼进链接：消息列表整块不录。 */}
      <div
        ref={scrollRef}
        data-sentry-block
        onScroll={(event) => {
          const el = event.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 [&::-webkit-scrollbar]:hidden"
      >
        {messages.length === 0 && consentPending === null && queued === null ? (
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
                    "min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere]",
                    message.role === "user" && message.answers
                      ? "max-w-[85%]"
                      : message.role === "user"
                      ? "max-w-[85%] whitespace-pre-wrap rounded-lg bg-foreground px-3 py-2 text-background"
                      : "w-full text-foreground",
                  )}
                >
                  {message.role === "assistant" && message.tier !== undefined && <RankLabel reply={message} />}
                  {message.thinking && (
                    <details open={live && !message.content} className="mb-1.5">
                      <summary className="label-mono cursor-pointer text-[10px] text-muted-foreground">
                        {live && !message.content ? "Thinking…" : "Thought process"}
                      </summary>
                      {/* column-reverse 让溢出时停在最底下，摘要往下长时始终看得到最新一句。 */}
                      <div className="scrollbar-none mt-1 flex max-h-32 flex-col-reverse overflow-y-auto text-xs text-muted-foreground [&::-webkit-scrollbar]:hidden">
                        <ChatMarkdown>{live ? stableMarkdown(message.thinking) : message.thinking}</ChatMarkdown>
                      </div>
                    </details>
                  )}
                  {message.lookups?.length ? (
                    <div className="label-mono mb-1.5 text-[10px] text-muted-foreground">
                      Looked at {message.lookups.join(", ")}
                    </div>
                  ) : null}
                  {message.designAt === undefined && <PlannerActivity message={message} live={live} />}
                  {message.role === "assistant" ? (
                    <ReplyBody content={message.content} cards={message.cards} designAt={message.designAt} live={live} handoff={<PlannerActivity message={message} live={live} />} />
                  ) : message.answers ? (
                    <AnswerCard answers={message.answers} />
                  ) : (
                    message.content
                  )}
                  {message.asks?.length ? <AskCard questions={message.asks} active={!streaming && index === messages.length - 1} onAnswer={answer} /> : null}
                  {message.proposals?.map((proposal, proposalIndex) => (
                    <BuildPlanCard key={proposal.token} proposal={proposal} inactive={live} onChange={(updated) => {
                      if (!conversation) return;
                      const current = chatArchive.getSnapshot().sessions.find((entry) => entry.id === conversation.id);
                      if (current) chatArchive.update(current.id, { messages: current.messages.map((entry, messageIndex) => messageIndex === index ? { ...entry, proposals: entry.proposals?.map((item, itemIndex) => itemIndex === proposalIndex ? updated : item) } : entry) });
                    }} />
                  ))}
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
        {consentPending !== null && <ConsentPrompt text={consentPending} onAccept={acceptConsent} onDecline={declineConsent} />}
        {queued !== null && <UserBubble text={queued} />}
      </div>

      <div className="border-t border-line p-3">
        {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
        {usage && <UsagePanel usage={usage} onClose={() => setUsage(null)} onReset={() => void showUsage(true)} />}
        {conversation?.design && <DesignStatus design={conversation.design} />}
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
            onFocus={() => { if (consented) setArmed(true); }}
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

// 存储层总留一条空会话给输入框当草稿；只有带消息的会话才算存档，列表与计数都不含草稿。
function savedSessions(archive: ChatArchive): ChatSession[] {
  return archive.sessions.filter((session) => session.messages.length > 0);
}

function DocRead({ read, prefix }: { read: NonNullable<ChatBubble["docs"]>[number]; prefix: boolean }) {
  return (
    <div className="label-mono text-[10px] text-muted-foreground">
      {prefix && "Read "}
      <a href={read.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-foreground">
        {read.path}
      </a>
      {read.section && <> › {read.section}</>}
    </div>
  );
}

// 交接回合的文档、沙盒步骤和搜索跟规划者的回复放在一起，画在交接分隔线下面。
function PlannerActivity({ message, live }: { message: ChatBubble; live: boolean }) {
  if (!message.docs?.length && !message.steps?.length && !message.searches?.length) return null;
  return (
    <div>
      {message.docs?.length ? <DocReads docs={message.docs} /> : null}
      {message.steps?.length ? <PlannerSteps steps={message.steps} live={live} /> : null}
      {message.searches?.map((query, i) => (
        <div key={i} className="label-mono mb-1.5 text-[10px] text-muted-foreground">
          Searched “{query}”
        </div>
      ))}
    </div>
  );
}

function PlannerSteps({ steps, live }: { steps: string[]; live: boolean }) {
  return (
    <details className="mb-1.5">
      <summary className={`label-mono cursor-pointer truncate text-[10px] text-muted-foreground ${live ? "normal-case" : ""}`}>
        {live ? steps[steps.length - 1] : `${steps.length.toLocaleString("en-US")} step${steps.length > 1 ? "s" : ""} in the sandbox`}
      </summary>
      <ol className="mt-1 space-y-0.5 pl-3 text-[10px] text-muted-foreground">
        {steps.map((step, i) => <li key={i} className="label-mono normal-case leading-snug [overflow-wrap:anywhere]">{step}</li>)}
      </ol>
    </details>
  );
}

function DocReads({ docs }: { docs: NonNullable<ChatBubble["docs"]> }) {
  if (docs.length === 1) return <div className="mb-1.5"><DocRead read={docs[0]} prefix /></div>;
  return (
    <details className="mb-1.5">
      <summary className="label-mono cursor-pointer text-[10px] text-muted-foreground">Read {docs.length} docs</summary>
      <div className="mt-1 space-y-1 pl-3">
        {docs.map((read, i) => <DocRead key={i} read={read} prefix={false} />)}
      </div>
    </details>
  );
}

function SessionList({ archive }: { archive: ChatArchive }) {
  const sessions = savedSessions(archive);
  function remove(id: string) {
    chatArchive.remove(id);
    if (!chatArchive.getSnapshot().sessions.length) chatArchive.start();
  }
  return (
    <div data-sentry-block className="border-b border-line bg-muted px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{sessions.length ? "Saved in this browser" : "No saved conversations yet"}</span>
        {sessions.length > 0 && <button type="button" onClick={() => { if (window.confirm("Clear all conversations saved in this browser? This cannot be undone.")) { chatArchive.clear(); chatArchive.start(); } }} className="hover:text-red-500">Clear all conversations</button>}
      </div>
      {/* 视口必须是 h-11 的整数倍，否则吸附后底部仍停在半行。 */}
      {sessions.length > 0 && <ul className="scrollbar-none max-h-[calc(var(--spacing)*33)] snap-y snap-mandatory overflow-y-auto [&::-webkit-scrollbar]:hidden">
        {sessions.map((session) => (
          <li key={session.id} className="flex h-11 snap-start items-center gap-2">
            <button type="button" aria-current={session.id === archive.activeId ? "true" : undefined} onClick={() => chatArchive.select(session.id)} className={cn("flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs", session.id === archive.activeId ? "bg-surface text-foreground" : "text-muted-foreground hover:bg-surface-hover")}>
              <span className="truncate">{session.title}</span>
              <time className="shrink-0 text-[10px]" dateTime={new Date(session.updatedAt).toISOString()}>{new Date(session.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time>
            </button>
            <button type="button" aria-label={`Delete conversation: ${session.title}`} onClick={() => remove(session.id)} className="p-2 text-muted-foreground hover:text-red-500"><Trash2 className="size-3.5" /></button>
          </li>
        ))}
      </ul>}
    </div>
  );
}

// 站主要求隐私说明跟随访客消息的语言（中日英，判断与设计模式的计划同一套），是「界面文案英文」的例外。
// destinations 须列全对话数据的每个出站去向；Turnstile 人机验证不收对话内容，站主定为不列；新增模型供应商、第三方工具或日志出口时同步改三种语言；Anthropic（含 Managed Agents）与 Clef 的保留和训练说法按 docs/ops-facts.md 记的设置与政策写，两边同步；设计会话「约一小时内删除」取决于 workers/ai/src/chat/design-cleanup.ts 的宽限期与 cron 周期。
type ConsentCopy = { lang: string; label: string; intro: string; destinations: { name: string; detail: string }[]; accept: string; decline: string; remember: string; declined: string };
const CONSENT_COPY: Record<PlanLanguage, ConsentCopy> = {
  en: {
    lang: "en",
    label: "Privacy notice",
    intro: "Before the oracle answers, please accept where this chat sends your data:",
    destinations: [
      { name: "Cloudflare Workers (this site's backend)", detail: "relays your messages and this conversation's history, and keeps your IP address for the rate-limit window. No transcripts are stored; logs hold request metadata, usage counts and errors, not your message text." },
      { name: "Cloudflare Workers AI (Clef router)", detail: "reads your latest message plus short excerpts of a few earlier ones to pick which Claude model answers. Cloudflare doesn't store this or use it for training." },
      { name: "Anthropic (Claude API)", detail: "receives the whole conversation to write the reply and runs any web searches. Anthropic keeps API data for 30 days and may access it for safety review (longer if flagged); it isn't used for training. Design sessions run on Anthropic's Claude Managed Agents, which keep the session transcript until this site deletes it, within about an hour after the session expires." },
      { name: "AI HOT (aihot.news)", detail: "receives the search terms Claude picks from your message when it looks up AI news. Anthropic connects to it on the site's behalf." },
      { name: "Sentry", detail: "receives error reports; chat text is masked in session replays and request bodies aren't sent." },
      { name: "GitHub", detail: "only if you file a build plan: it becomes a public issue or pull request, and a build also sends the plan to Anthropic's Claude Code." },
      { name: "This browser", detail: "saves your conversations and this consent." },
    ],
    accept: "Accept",
    decline: "Decline",
    remember: "Accepting is remembered in this browser until the chat code changes.",
    declined: "Nothing was sent. Accept the privacy notice to chat.",
  },
  zh: {
    lang: "zh-CN",
    label: "隐私说明",
    intro: "神谕作答之前，请先确认这个对话会把你的数据发到哪里：",
    destinations: [
      { name: "Cloudflare Workers（本站后端）", detail: "转发你的消息和本次对话的历史，并在限流窗口内保留你的 IP 地址。不保存对话记录，日志里只有请求元数据、用量计数和错误，没有消息原文。" },
      { name: "Cloudflare Workers AI（Clef 路由）", detail: "读取你最新的消息和前几条消息的简短摘录，决定由哪个 Claude 模型回答。Cloudflare 不存储这些内容，也不用于训练。" },
      { name: "Anthropic（Claude API）", detail: "收到完整对话来生成回复，并执行联网搜索。Anthropic 保留 API 数据 30 天，可因安全原因查看，被标记的会保留更久；不用于训练。设计会话运行在 Anthropic 的 Claude Managed Agents 上，会话记录会一直保留到本站删除，本站在设计会话过期后约一小时内删除。" },
      { name: "AI HOT（aihot.news）", detail: "Claude 查 AI 资讯时，会收到它从你的消息里提炼的搜索词。由 Anthropic 代本站连接。" },
      { name: "Sentry", detail: "接收错误报告；会话录像里对话文字被遮住，也不上传请求正文。" },
      { name: "GitHub", detail: "仅当你提交构建计划时：计划会成为公开的 issue 或 pull request，发起构建还会把计划发给 Anthropic 的 Claude Code。" },
      { name: "这个浏览器", detail: "保存你的对话和这次同意。" },
    ],
    accept: "接受",
    decline: "拒绝",
    remember: "接受后会记在这个浏览器里，对话代码有改动时需要重新确认。",
    declined: "消息没有发出。接受隐私说明后才能对话。",
  },
  ja: {
    lang: "ja",
    label: "プライバシーに関するお知らせ",
    intro: "神託が答える前に、このチャットがあなたのデータをどこへ送るかをご確認ください：",
    destinations: [
      { name: "Cloudflare Workers（本サイトのバックエンド）", detail: "メッセージとこの会話の履歴を中継し、レート制限の期間中は IP アドレスを保持します。会話の記録は保存せず、ログにはリクエストのメタデータ、利用回数、エラーのみが残り、メッセージ本文は含まれません。" },
      { name: "Cloudflare Workers AI（Clef ルーター）", detail: "最新のメッセージと、それ以前のいくつかのメッセージの短い抜粋を読み、どの Claude モデルが答えるかを決めます。Cloudflare はこれを保存せず、学習にも使いません。" },
      { name: "Anthropic（Claude API）", detail: "返信を書くために会話全体を受け取り、Web 検索も行います。Anthropic は API データを 30 日間保持し、安全確認のために閲覧することがあります（フラグが付いた場合はより長く保持）。学習には使われません。デザインセッションは Anthropic の Claude Managed Agents 上で動き、会話の記録は本サイトが削除するまで残ります。本サイトはセッションの期限切れから約 1 時間以内に削除します。" },
      { name: "AI HOT（aihot.news）", detail: "Claude が AI ニュースを調べるとき、メッセージから選んだ検索語を受け取ります。接続は Anthropic が本サイトに代わって行います。" },
      { name: "Sentry", detail: "エラーレポートを受け取ります。セッションリプレイではチャットの文字が隠され、リクエスト本文は送られません。" },
      { name: "GitHub", detail: "ビルド計画を提出した場合のみ：計画は公開の issue または pull request になり、ビルドを始めると計画が Anthropic の Claude Code にも送られます。" },
      { name: "このブラウザ", detail: "会話とこの同意を保存します。" },
    ],
    accept: "同意する",
    decline: "同意しない",
    remember: "同意はこのブラウザに記録され、チャットのコードが変わると改めて確認します。",
    declined: "メッセージは送信されていません。チャットするにはプライバシーに関するお知らせに同意してください。",
  },
};

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="min-w-0 max-w-[85%] whitespace-pre-wrap rounded-lg bg-foreground px-3 py-2 text-sm leading-relaxed text-background [overflow-wrap:anywhere]">{text}</div>
    </div>
  );
}

function ConsentPrompt({ text, onAccept, onDecline }: { text: string; onAccept: () => void; onDecline: () => void }) {
  const copy = CONSENT_COPY[textLanguage(text)];
  return (
    <>
      <UserBubble text={text} />
      <div role="group" aria-label={copy.label} lang={copy.lang} className="w-full text-sm leading-relaxed text-foreground">
        <div className="label-mono mb-1.5 text-[10px] text-muted-foreground">{copy.label}</div>
        <p>{copy.intro}</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {copy.destinations.map(({ name, detail }) => (
            <li key={name}>
              <span className="font-medium text-foreground">{name}</span>
              {copy.lang === "en" ? ": " : "："}
              {detail}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onAccept} className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background">{copy.accept}</button>
          <button type="button" onClick={onDecline} className="rounded-md border border-line-strong px-3 py-1.5 text-xs transition-colors hover:bg-surface-hover">{copy.decline}</button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{copy.remember}</p>
      </div>
    </>
  );
}

function DesignStatus({ design }: { design: ChatDesign }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-[11px] text-sky-600 dark:text-sky-400">
      <PencilRuler className="size-3 shrink-0" />
      <span>Design session with Opus · {design.remaining.toLocaleString("en-US")} turns left</span>
    </p>
  );
}

function DesignDivider() {
  return (
    <div role="separator" aria-label="Design session started" className="design-divider flex items-center gap-2 py-1 text-sky-600 dark:text-sky-400">
      <span className="h-px flex-1 bg-sky-500/40" />
      <span className="label-mono flex shrink-0 items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[10px]">
        <PencilRuler className="size-3" />
        Design session · {GOD_CHAT_TIER_INFO.opus.persona} takes over
      </span>
      <span className="h-px flex-1 bg-sky-500/40" />
    </div>
  );
}

function ReplyBody({ content, cards = [], designAt, live, handoff }: { content: string; cards?: ShownCard[]; designAt?: number; live: boolean; handoff?: ReactNode }) {
  const parts: ReactNode[] = [];
  let from = 0;
  const marks = [
    ...cards.map(({ card, at }) => ({ at, node: <ChatCard key={card} card={card} /> })),
    ...(designAt === undefined ? [] : [{ at: designAt, node: <Fragment key="design"><DesignDivider />{handoff}</Fragment> }]),
  ].sort((a, b) => a.at - b.at);
  for (const { at, node } of marks) {
    const text = content.slice(from, at);
    if (text.trim()) parts.push(<ChatMarkdown key={`text-${from}`}>{text}</ChatMarkdown>);
    parts.push(node);
    from = at;
  }
  const rest = content.slice(from);
  if (rest.trim()) parts.push(<ChatMarkdown key={`text-${from}`}>{live ? stableMarkdown(rest) : rest}</ChatMarkdown>);
  if (live && !rest.trim()) parts.push(<span key="typing" className="animate-pulse text-muted-foreground">…</span>);
  return <div className="space-y-2">{parts}</div>;
}

const RANK_TONE: Record<GodChatServedTier, string> = {
  fable: "god-aura bg-clip-text text-transparent font-bold",
  sonnet: "text-foreground",
  opus: "text-foreground",
  haiku: "text-muted-foreground opacity-70",
};

function RankLabel({ reply }: { reply: Reply }) {
  if (reply.tier === null) {
    return <div className="label-mono mb-1.5 text-[10px] text-red-500">Gates closed</div>;
  }
  if (!reply.tier) return null;
  const { persona, label } = GOD_CHAT_TIER_INFO[reply.tier];
  const opener = reply.designAt !== undefined && reply.tier === "opus" ? GOD_CHAT_TIER_INFO.sonnet : undefined;
  return (
    <div className="mb-1.5">
      <div className={cn("label-mono text-[10px]", RANK_TONE[reply.tier])}>
        {opener && `${opener.persona} · ${opener.label} → `}{persona} · {reply.servedBy ? modelLabel(reply.servedBy) : label}
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


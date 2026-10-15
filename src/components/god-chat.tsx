"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { ArrowUp, History, PencilRuler, Plus, Square, Trash2 } from "lucide-react";

import { ChatCard } from "@/components/chat-card";
import { ChatMarkdown, preloadChatMarkdown, useChatMarkdownReady } from "@/components/lazy-chat-markdown";
import { FableDescent, type Descent } from "@/components/fable-descent";
import { AnswerCard, AskCard, askAnswerText } from "@/components/ask-card";
import { BuildPlanCard } from "@/components/build-plan-card";
import { Card } from "@/components/ui/card";
import { stableMarkdown } from "@/lib/streaming-markdown";
import { chatConsent, designConsent } from "@/lib/chat-consent";
import { textLanguage, type PlanLanguage } from "@shared/build-routine";
import { activeChatDesign, chatArchive, chatResumePoint, designEndReason, chatReplyMessages, designSessionEnded, subscribeChatArchive, type ChatAnswer, type ChatArchive, type ChatBubble, type ChatDesign, type ChatShownCard, type ChatSession, type DesignEndReason } from "@/lib/chat-archive";
import { cn } from "@/lib/utils";
import { workerUrl } from "@/lib/worker-url";
import {
  GOD_CHAT_LIMITS,
  GOD_CHAT_PATH,
  GOD_CHAT_TURNSTILE_ACTION,
  GOD_CHAT_USAGE_PATH,
  type GodChatEvent,
  type GodChatMessage,
  fitHistory,
  readGodChatRoute,
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

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function TurnstileScript({ onReady, onError }: { onReady: () => void; onError: () => void }) {
  const readyRef = useRef(onReady);
  const errorRef = useRef(onError);
  useEffect(() => {
    readyRef.current = onReady;
    errorRef.current = onError;
  });
  useEffect(() => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
    if (window.turnstile || existing?.dataset.loaded === "1") {
      readyRef.current();
      return;
    }
    const script = existing ?? document.createElement("script");
    const ready = () => {
      script.dataset.loaded = "1";
      readyRef.current();
    };
    const failed = () => errorRef.current();
    script.addEventListener("load", ready, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (!existing) {
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    return () => {
      script.removeEventListener("load", ready);
      script.removeEventListener("error", failed);
    };
  }, []);
  return null;
}

type Reply = Omit<ChatBubble, "role" | "content">;
type Resumed = { user: ChatBubble & { id: string }; before: ChatBubble[]; keep: ChatBubble[]; handoff: boolean };
const RESUME_DELAY_MS = 2000;
const EMPTY_MESSAGES: ChatBubble[] = [];
// 须与 globals.css 里 .design-halo 的动画总时长一致。
const DESIGN_HALO_MS = 2_400;

const CHAT_URL = workerUrl(process.env.PUBLIC_BACKEND_URL, GOD_CHAT_PATH);
const OFFLINE = "The oracle is offline.";

const SITE_KEY = process.env.PUBLIC_TURNSTILE_SITE_KEY ?? "";
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
  } catch {
  }
  return null;
}

function writePass(pass: HumanPass | null) {
  try {
    if (pass) window.sessionStorage.setItem(PASS_KEY, JSON.stringify(pass));
    else window.sessionStorage.removeItem(PASS_KEY);
  } catch {
  }
}

const COMMANDS = [
  { name: "/clear", aliases: ["/new"], description: "Start a new conversation with empty context" },
  { name: "/usage", aliases: [], description: "Show your quota in the current window" },
  { name: "/exit", aliases: [], description: "Leave design mode and return to ordinary chat" },
] as const;

type Command = (typeof COMMANDS)[number];
const commandNames = (c: Command): readonly string[] => [c.name, ...c.aliases];
const USAGE_URL = workerUrl(process.env.PUBLIC_BACKEND_URL, GOD_CHAT_USAGE_PATH);
const USAGE_RETRY_MS = 5_000;
const EDGE_GAP_PX = 12;
// lyjw 要求示例用中文，是「界面文案英文」的例外。首屏四条各对应一类能力：实时状态、读设计文档、网页搜索、设计会话。
// 每条须在 14 个汉字宽以内：桌面两列等宽格放得下，换题时按钮尺寸不变。
const SUGGESTIONS = [
  "LYJW 现在在忙什么？",
  "这个网站是怎么搭起来的？",
  "这周 AI 圈有什么大新闻？",
  "我想给这个网站提个改进",
  "LYJW 最近在听什么歌？",
  "首页的实时数据从哪来？",
  "今天科技圈有什么新鲜事？",
  "LYJW 最近在玩什么游戏？",
  "这个网站用了哪些技术？",
  "比较一下最新的几款大模型",
  "LYJW 最近在追什么番？",
  "网站最近的提交改了什么？",
  "LYJW 今天运动了吗？",
  "LYJW 用 AI 写了多少代码？",
];
const SUGGESTION_SLOTS = 4;
// 每隔这么久只换一格，四格轮流；淡出时长与 globals.css 的 headline-in 一起凑成一次换题。
const SUGGESTION_ROTATE_MS = 3_000;
const SUGGESTION_FADE_MS = 150;

export function GodChat({ className }: { className?: string }) {
  const archive = useSyncExternalStore(subscribeChatArchive, chatArchive.getSnapshot, chatArchive.getServerSnapshot);
  const session = archive.sessions.find((entry) => entry.id === archive.activeId);
  return <Conversation key={session?.id ?? "empty"} className={className} archive={archive} session={session} />;
}

function Conversation({ className, archive, session: conversation }: { className?: string; archive: ChatArchive; session?: ChatSession }) {
  const messages = conversation?.messages ?? EMPTY_MESSAGES;
  const setMessages = (next: ChatBubble[], persist = true) => { if (conversation) chatArchive.update(conversation.id, { messages: next }, { persist }); };
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
  const designConsented = useSyncExternalStore(designConsent.subscribe, designConsent.getSnapshot, designConsent.getServerSnapshot);
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
      const current = chatArchive.session(conversationId);
      if (current?.design?.token === design.token && !activeChatDesign(current.design)) chatArchive.endDesign(conversationId, designEndReason(current.design));
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

  const markdownReady = useChatMarkdownReady();
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, markdownReady]);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        preloadChatMarkdown();
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
    const user: ChatBubble & { id: string } = resumed?.user ?? { id: crypto.randomUUID(), role: "user", content, time: { iso: new Date().toISOString(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone }, ...(answers && { answers }) };
    const shown: ChatBubble[] = [...(resumed?.before ?? messages), user];
    const history: GodChatMessage[] = fitHistory(
      shown
        .filter(({ content }) => content.trim())
        .map(({ role, content, trace, seal, planToken, time }): GodChatMessage =>
          role === "assistant" ? { role, content, ...(trace && { trace }), ...(seal && { seal }), ...(planToken && { planToken }) } : { role, content, ...(time && { time }) },
        ),
    );
    let reply = "";
    // 交接回复没盖章就被补发整条替掉，Sonnet 的开场白拿不回来，分隔线画在规划者回复的最前面。
    let meta: Reply = resumed?.handoff ? { designAt: 0 } : {};
    const session = sessionRef.current;
    const bubble = (): ChatBubble => ({ role: "assistant", content: reply, ...meta, ...(meta.designAt !== undefined && designConsent.getSnapshot() ? { designRevealed: true } : {}) });
    const replyMessages = (next?: ChatBubble) => chatReplyMessages(
      conversation ? chatArchive.session(conversation.id)?.messages ?? messages : messages,
      user,
      next,
      resumed?.keep,
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
      // 设计同意要读此刻的真值：接受后立刻补发时，闭包里的 designConsented 还是旧的。
      designToken = designConsent.getSnapshot() ? activeChatDesign(conversation?.design)?.token : undefined;
      if (conversation?.design && !designToken && designConsent.getSnapshot()) chatArchive.endDesign(conversation.id, designEndReason(conversation.design), { persist: false });
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, ...(usedToken ? { turnstileToken: usedToken } : { humanPass: humanPass?.pass }), ...(designToken && { designToken }), ...(resumed && { resume: true }), time: { iso: new Date().toISOString(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone } }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
        if (data?.code === "human_pass_expired") writePass(null);
        if (conversation && designSessionEnded(data?.code)) {
          chatArchive.endDesign(conversation.id, data?.code === "design_session_exhausted" ? "exhausted" : "expired", { persist: false });
          throw new Error("The design session has ended. Send your message again to continue in ordinary chat.");
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
            const route = readGodChatRoute(event.tier, event.downgradedFrom);
            if (!route) continue;
            meta = { ...meta, tier: route.tier, ...(route.downgradedFrom && { downgradedFrom: route.downgradedFrom }) };
            if (route.tier === "fable" && sessionRef.current === session) summon();
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
            meta = { ...meta, proposals: [...(meta.proposals ?? []), { plan: event.plan, token: event.token, expiresAt: event.expiresAt, ...(event.issueRef && { issueRef: event.issueRef }) }] };
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
          setMessages([...replyMessages(), user, ...(resumed?.keep ?? []), ...(kept ? [bubble()] : [])]);
          if (resumed) setError("The connection dropped. Reload the page to get the rest of the reply.");
          else setTimeout(() => resumeRef.current(), RESUME_DELAY_MS);
        } else {
          setMessages(replyMessages(kept ? bubble() : undefined));
          if (!kept) setDraft((current) => current || content);
          // 设计开场在同意后由补发发出：已同意的访客无缝续上交接，不同意的停在确认框。
          if (!resumed && meta.designAt !== undefined && designConsent.getSnapshot()) setTimeout(() => resumeRef.current(), 0);
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
    const current = chatArchive.session(conversation.id);
    // 没同意设计时扣着令牌，resume: true 不带 designToken 会被 Worker 拒绝：补发等同意之后再走。
    if (!current || !activeChatDesign(current.design) || !designConsent.getSnapshot()) return;
    const list = current.messages;
    const point = chatResumePoint(list);
    if (!point) return;
    const { at, keep, handoff } = point;
    const user = { ...list[at], id: list[at].id ?? crypto.randomUUID() };
    if (!list[at].id) setMessages([...list.slice(0, at), user, ...list.slice(at + 1)], false);
    void send(user.content, undefined, { user, before: list.slice(0, at), keep, handoff });
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
      chatArchive.endDesign(conversation.id, "left");
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
    // 同意前消息只留在本地、不发给 Worker；lyjw 要求说明一出现就在后台跑 Turnstile，访客读完点接受时多半已验完，可以直接发。
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
  const savedCount = savedSessions(archive).length;
  const lastDesignAtIndex = messages.findLastIndex((message) => message.designAt !== undefined);

  return (
    <Card
      label="Talk to God"
      action={conversation?.design && designConsented ? <span className="flex items-center gap-1 text-signal-blue"><PencilRuler className="size-3" />Design · Opus</span> : <RouteStatus last={messages[messages.length - 1]} streaming={streaming} />}
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
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs text-muted-foreground lg:px-5">
        <button type="button" onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen} className="-my-1 flex min-w-0 items-center gap-1.5 py-1 hover:text-foreground"><History className="size-3.5 shrink-0" /><span className="truncate">Conversations{savedCount > 0 ? ` (${savedCount})` : ""}</span></button>
        <button type="button" onClick={() => runCommand("/clear")} className="-my-1 flex shrink-0 items-center gap-1 py-1 hover:text-foreground"><Plus className="size-3.5" />New</button>
      </div>
      {historyOpen && <SessionList archive={archive} />}
      {(armed || warm) && (
        <TurnstileScript
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
        className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-5 [&::-webkit-scrollbar]:hidden"
      >
        {!expanded ? (
          <div className="m-auto flex max-w-md flex-col items-center gap-3 py-2 text-center">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Ask about LYJW, this site, or anything on the web.
            </p>
            <Suggestions disabled={streaming} onPick={submit} />
          </div>
        ) : (
          messages.map((message, index) => {
            const live = streaming && index === messages.length - 1;
            return (
              <Fragment key={index}>
                <div className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
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
                        <summary className="label-mono cursor-pointer text-muted-foreground">
                          {live && !message.content ? <span className="thinking-shimmer">Thinking</span> : "Thought process"}
                        </summary>
                        {/* column-reverse 让溢出时停在最底下，摘要往下长时始终看得到最新一句。 */}
                        <div className="scrollbar-none mt-1 flex max-h-32 flex-col-reverse overflow-y-auto text-xs text-muted-foreground [&::-webkit-scrollbar]:hidden">
                          <ChatMarkdown>{live ? stableMarkdown(message.thinking) : message.thinking}</ChatMarkdown>
                        </div>
                      </details>
                    )}
                    {message.lookups?.length ? (
                      <div className="label-mono mb-1.5 text-muted-foreground">
                        Looked at {message.lookups.join(", ")}
                      </div>
                    ) : null}
                    {message.designAt === undefined && <PlannerActivity message={message} live={live} />}
                    {message.role === "assistant" ? (() => {
                      const messageLang = textLanguage(messages.slice(0, index + 1).reverse().find((m) => m.role === "user")?.content ?? "");
                      // designRevealed 是这条回复被展示过的事实，与现在是否还同意无关：同意失效后退出，看过的规划仍可读，没看过的仍藏。
                      const unrevealedDesign = message.designAt !== undefined && !designConsented && message.designRevealed !== true;
                      // 会话还开着就要重新问：对话代码换版后同意失效，看过的内容照样显示，但不问就会把下一条悄悄发去普通对话。
                      const waitingDesignConsent = message.designAt !== undefined && !designConsented && conversation?.design !== undefined && index === lastDesignAtIndex;
                      const designConsentNode = waitingDesignConsent ? (
                        <DesignConsentPrompt
                          language={messageLang}
                          onAccept={() => {
                            designConsent.accept();
                            const current = conversation ? chatArchive.session(conversation.id) : undefined;
                            if (current) chatArchive.update(current.id, { messages: current.messages.map((entry) => entry.designAt !== undefined ? { ...entry, designRevealed: true } : entry) });
                            resumeRef.current();
                          }}
                          onDecline={() => { if (conversation) chatArchive.endDesign(conversation.id, "left"); }}
                        />
                      ) : null;
                      return (
                        <>
                          <ReplyBody
                            content={message.content}
                            cards={message.cards}
                            designAt={message.designAt}
                            live={live}
                            awaiting={live && !(message.thinking && !message.content)}
                            handoff={<PlannerActivity message={message} live={live} />}
                            designConsentNode={designConsentNode}
                            showDesignContent={!unrevealedDesign}
                          />
                          {!unrevealedDesign && message.asks?.length ? (
                            <AskCard questions={message.asks} active={!streaming && index === messages.length - 1} onAnswer={answer} />
                          ) : null}
                          {!unrevealedDesign && message.proposals?.map((proposal, proposalIndex) => (
                            <BuildPlanCard key={proposal.token} proposal={proposal} inactive={live} onChange={(updated) => {
                              if (!conversation) return;
                              const current = chatArchive.session(conversation.id);
                              if (current) chatArchive.update(current.id, { messages: current.messages.map((entry, messageIndex) => messageIndex === index ? { ...entry, proposals: entry.proposals?.map((item, itemIndex) => itemIndex === proposalIndex ? updated : item) } : entry) });
                            }} />
                          ))}
                        </>
                      );
                    })() : message.answers ? (
                      <AnswerCard answers={message.answers} />
                    ) : (
                      message.content
                    )}
                    {message.sources?.length ? (
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2 text-2xs">
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
                {message.designEnded && <DesignEndNotice reason={message.designEnded} />}
              </Fragment>
            );
          })
        )}
        {consentPending !== null && <ConsentPrompt text={consentPending} onAccept={acceptConsent} onDecline={declineConsent} />}
        {queued !== null && <UserBubble text={queued} />}
      </div>

      <div className="border-t border-line px-4 py-3 lg:px-5">
        {error && <p className="mb-2 text-xs text-signal-red">{error}</p>}
        {usage && <UsagePanel usage={usage} onClose={() => setUsage(null)} onReset={() => void showUsage(true)} />}
        {conversation?.design && designConsented && <DesignStatus design={conversation.design} />}
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
    <div className="label-mono text-muted-foreground">
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
        <div key={i} className="label-mono mb-1.5 text-muted-foreground">
          Searched “{query}”
        </div>
      ))}
    </div>
  );
}

function PlannerSteps({ steps, live }: { steps: string[]; live: boolean }) {
  return (
    <details className="mb-1.5">
      <summary className={`label-mono cursor-pointer truncate text-muted-foreground ${live ? "normal-case" : ""}`}>
        {live ? steps[steps.length - 1] : `${steps.length.toLocaleString("en-US")} step${steps.length > 1 ? "s" : ""} in the sandbox`}
      </summary>
      <ol className="mt-1 space-y-0.5 pl-3 text-2xs text-muted-foreground">
        {steps.map((step, i) => <li key={i} className="label-mono normal-case leading-snug [overflow-wrap:anywhere]">{step}</li>)}
      </ol>
    </details>
  );
}

function DocReads({ docs }: { docs: NonNullable<ChatBubble["docs"]> }) {
  if (docs.length === 1) return <div className="mb-1.5"><DocRead read={docs[0]} prefix /></div>;
  return (
    <details className="mb-1.5">
      <summary className="label-mono cursor-pointer text-muted-foreground">Read {docs.length} docs</summary>
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
    <div className="border-b border-line bg-muted px-4 py-2 lg:px-5">
      <div className="mb-2 flex items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span>{sessions.length ? "Saved in this browser" : "No saved conversations yet"}</span>
        {sessions.length > 0 && <button type="button" onClick={() => { if (window.confirm("Clear all conversations saved in this browser? This cannot be undone.")) { chatArchive.clear(); chatArchive.start(); } }} className="hover:text-signal-red">Clear all conversations</button>}
      </div>
      {sessions.length > 0 && <ul className="scrollbar-none max-h-36 snap-y snap-mandatory overflow-y-auto [&::-webkit-scrollbar]:hidden">
        {sessions.map((session) => (
          <li key={session.id} className="flex h-11 snap-start items-center gap-2">
            <button type="button" aria-current={session.id === archive.activeId ? "true" : undefined} onClick={() => chatArchive.select(session.id)} className={cn("flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs", session.id === archive.activeId ? "bg-surface text-foreground" : "text-muted-foreground hover:bg-surface-hover")}>
              <span className="truncate">{session.title}</span>
              <time className="shrink-0 text-2xs" dateTime={new Date(session.updatedAt).toISOString()}>{new Date(session.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time>
            </button>
            <button type="button" aria-label={`Delete conversation: ${session.title}`} onClick={() => remove(session.id)} className="p-2 text-muted-foreground hover:text-signal-red"><Trash2 className="size-3.5" /></button>
          </li>
        ))}
      </ul>}
    </div>
  );
}

// lyjw 要求隐私说明跟随访客消息的语言（中日英，判断与设计模式的计划同一套），是「界面文案英文」的例外。
// destinations 须列全普通对话数据的每个出站去向；GitHub 授权由提交计划时的 GithubConsent 单独说明，设计会话的 Managed Agents 保留规则由进入设计会话时的 DESIGN_CONSENT_COPY 单独说明；Turnstile 人机验证不收对话内容，lyjw 定为不列；新增模型供应商、第三方工具或日志出口时同步改三种语言；Anthropic 与 Clef 的保留和训练说法按 docs/ops-facts.md 记的设置与政策写，两边同步。
type ConsentCopy = { lang: string; label: string; intro: string; destinations: { name: string; detail: string }[]; accept: string; decline: string; remember: string; declined: string };
const CONSENT_COPY: Record<PlanLanguage, ConsentCopy> = {
  en: {
    lang: "en",
    label: "Privacy notice",
    intro: "Before the oracle responds, please review and accept where this chat sends your data:",
    destinations: [
      { name: "Cloudflare Workers (this site's backend)", detail: "relays your messages and conversation history, and temporarily keeps your IP address within the rate-limit window. When Claude looks something up, it sends only that search query or page URL to Exa (web search and page reads), Bangumi or the Steam store, never your full conversation. Transcripts are not stored; server logs only contain request metadata, usage counts, and errors—never message text." },
      { name: "Cloudflare Workers AI (Clef router)", detail: "reads your latest message and brief excerpts from recent context to select the appropriate Claude model. Cloudflare does not store this content or use it for training." },
      { name: "Anthropic (Claude API)", detail: "receives the full conversation to generate replies, and passes only the lookup query Claude writes to the documentation and code search services Context7, Cloudflare Docs, grep.app and DeepWiki. Anthropic retains API data for 30 days for safety review (retained longer if flagged); it is not used for training." },
      { name: "This browser", detail: "stores your conversations and this consent locally." },
    ],
    accept: "Accept",
    decline: "Decline",
    remember: "Your consent is remembered in this browser and will be requested again if chat-related code changes.",
    declined: "No message was sent. Please accept the privacy notice to start chatting.",
  },
  zh: {
    lang: "zh-CN",
    label: "隐私说明",
    intro: "在神谕作答前，请确认本次对话的数据去向：",
    destinations: [
      { name: "Cloudflare Workers（本站后端）", detail: "负责转发消息与本次对话历史，并在限流窗口内临时保留 IP 地址。Claude 检索时，只把查询词或网页地址发给 Exa（联网搜索与读取网页）、Bangumi 或 Steam 商店，不发送完整对话。不存储对话记录，日志仅包含请求元数据、用量计数与错误信息，不记录任何消息原文。" },
      { name: "Cloudflare Workers AI（Clef 路由）", detail: "读取最新消息及上下文的简短摘录，用于路由选择合适的 Claude 模型。Cloudflare 不存储这些内容，亦不用于模型训练。" },
      { name: "Anthropic（Claude API）", detail: "接收完整对话以生成回复，并只把 Claude 写出的检索词转给文档与代码检索服务 Context7、Cloudflare 文档、grep.app 与 DeepWiki。Anthropic 保留 API 数据 30 天（仅供安全审查，违规标记数据会保留更久）；数据不用于模型训练。" },
      { name: "当前浏览器", detail: "在本地保存你的对话记录与本次同意状态。" },
    ],
    accept: "接受",
    decline: "拒绝",
    remember: "你的同意将保存在当前浏览器中；当对话相关代码发生改动时需要重新确认。",
    declined: "消息未发送。需接受隐私说明后方可开始对话。",
  },
  ja: {
    lang: "ja",
    label: "プライバシーに関するお知らせ",
    intro: "神託が回答する前に、本チャットにおけるデータの送信先をご確認のうえ同意してください：",
    destinations: [
      { name: "Cloudflare Workers（本サイトのバックエンド）", detail: "メッセージおよび会話履歴を中継し、レート制限期間中のみ IP アドレスを一時保持します。Claude が調べものをする際は、検索クエリまたはページ URL のみを Exa（Web 検索とページ取得）、Bangumi、Steam ストアに送信し、会話全体は送信しません。会話の記録は保存されず、ログにはリクエストのメタデータ、利用回数、エラー情報のみが記録され、メッセージ本文は一切含まれません。" },
      { name: "Cloudflare Workers AI（Clef ルーター）", detail: "最新のメッセージおよび直前の短い会話抜粋を読み取り、最適な Claude モデルを選択します。Cloudflare がこの内容を保存したり、モデルの学習に使用することはありません。" },
      { name: "Anthropic（Claude API）", detail: "回答生成のために会話全体を受信し、Claude が作成した検索クエリのみをドキュメント・コード検索サービス（Context7、Cloudflare Docs、grep.app、DeepWiki）に渡します。Anthropic は API データを安全確認目的で 30 日間保持します（フラグ適用時は保持期間が延長される場合があります、モデルの学習には不使用）。" },
      { name: "このブラウザ", detail: "会話履歴と今回の同意状況をローカルに保存します。" },
    ],
    accept: "同意する",
    decline: "同意しない",
    remember: "同意内容はブラウザに保存され、チャット関連のコードが更新された際に改めて確認されます。",
    declined: "メッセージは送信されていません。チャットを開始するにはプライバシーに関するお知らせにご同意ください。",
  },
};

type DesignConsentCopy = {
  lang: string;
  label: string;
  intro: string;
  points: { name: string; detail: string }[];
  accept: string;
  decline: string;
  remember: string;
};

const DESIGN_CONSENT_COPY: Record<PlanLanguage, DesignConsentCopy> = {
  en: {
    lang: "en",
    label: "Design session privacy notice",
    intro: "Before planning site changes with the Architect, please review and accept how design sessions handle your data:",
    points: [
      { name: "Anthropic (Claude Managed Agents)", detail: "Design sessions run on Anthropic's Claude Managed Agents. Session transcripts are retained on Anthropic until deleted by this site—typically within about an hour after session expiration." },
      { name: "Model training & safety", detail: "Anthropic does not use design session data for model training. Transcripts may only be accessed for safety review." },
    ],
    accept: "Accept & enter design mode",
    decline: "Exit design mode",
    remember: "Your consent is remembered in this browser until chat code changes.",
  },
  zh: {
    lang: "zh-CN",
    label: "设计模式隐私说明",
    intro: "在进入设计模式与架构师规划站点改动之前，请确认设计会话的数据保留规则：",
    points: [
      { name: "Anthropic（Claude Managed Agents）", detail: "设计会话运行在 Anthropic 的 Claude Managed Agents 上。会话记录将保留在 Anthropic 直至本站主动删除；本站会在设计会话过期后约一小时内自动清理。" },
      { name: "模型训练与安全", detail: "Anthropic 不会将设计会话数据用于模型训练；数据仅可因安全审查需要由 Anthropic 查看。" },
    ],
    accept: "接受并进入设计模式",
    decline: "退出设计模式",
    remember: "你的同意将保存在当前浏览器中；当对话相关代码发生改动时需要重新确认。",
  },
  ja: {
    lang: "ja",
    label: "デザインモードのプライバシーに関するお知らせ",
    intro: "アーキテクトとサイト変更を設計するデザインモードに入る前に、データ保持のルールをご確認ください：",
    points: [
      { name: "Anthropic（Claude Managed Agents）", detail: "デザインセッションは Anthropic の Claude Managed Agents 上で動作します。会話記録は本サイトが削除するまで Anthropic 上に保持されます（セッションの有効期限切れから約 1 時間以内に本サイトが自動削除します）。" },
      { name: "モデル学習と安全性", detail: "Anthropic がデザインセッションのデータをモデルの学習に使用することはありません。データは安全確認目的でのみ閲覧される場合があります。" },
    ],
    accept: "同意してデザインモードを開始",
    decline: "デザインモードを終了",
    remember: "同意内容はブラウザに保存され、チャット関連のコードが更新された際に改めて確認されます。",
  },
};

function Suggestions({ disabled, onPick }: { disabled: boolean; onPick: (text: string) => void }) {
  const [slots, setSlots] = useState(() => SUGGESTIONS.slice(0, SUGGESTION_SLOTS).map((text) => ({ text, rotated: false })));
  const [leaving, setLeaving] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const turn = useRef({ slot: 0, next: SUGGESTION_SLOTS });
  useEffect(() => {
    if (paused) return;
    let swap: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      const { slot, next } = turn.current;
      turn.current = { slot: (slot + 1) % SUGGESTION_SLOTS, next: (next + 1) % SUGGESTIONS.length };
      setLeaving(slot);
      swap = setTimeout(() => {
        setSlots((current) => current.map((entry, index) => (index === slot ? { text: SUGGESTIONS[next], rotated: true } : entry)));
        setLeaving(null);
      }, SUGGESTION_FADE_MS);
    }, SUGGESTION_ROTATE_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(swap);
      setLeaving(null);
    };
  }, [paused]);
  return (
    // 悬停或聚焦时停住轮播，免得点下去的那一刻换了题。
    <div
      className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    >
      {slots.map(({ text, rotated }, index) => (
        <button
          key={index}
          type="button"
          disabled={disabled}
          onClick={() => onPick(text)}
          className="paper-card overflow-hidden rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs whitespace-nowrap text-foreground transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          {/* 淡出与淡入分在两层：入场动画的填充会盖住同一层上的 opacity 过渡。 */}
          <span className={cn("inline-block transition-opacity duration-150", leaving === index && "opacity-0")}>
            <span key={text} className={cn("inline-block", rotated && "animate-headline-in")}>
              {text}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function DesignConsentPrompt({
  language,
  onAccept,
  onDecline,
}: {
  language: PlanLanguage;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const copy = DESIGN_CONSENT_COPY[language];
  return (
    <div role="group" aria-label={copy.label} lang={copy.lang} className="mt-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-sm leading-relaxed text-foreground">
      <div className="label-mono mb-1.5 flex items-center gap-1.5 text-signal-blue">
        <PencilRuler className="size-3" />
        <span>{copy.label}</span>
      </div>
      <p className="text-xs text-foreground">{copy.intro}</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        {copy.points.map(({ name, detail }) => (
          <li key={name}>
            <span className="font-medium text-foreground">{name}</span>
            {copy.lang === "en" ? ": " : "："}
            {detail}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onAccept} className="rounded-md bg-sky-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-sky-500">
          {copy.accept}
        </button>
        <button type="button" onClick={onDecline} className="rounded-md border border-line-strong px-3 py-1.5 text-xs transition-colors hover:bg-surface-hover">
          {copy.decline}
        </button>
      </div>
      <p className="mt-2 text-2xs text-muted-foreground">{copy.remember}</p>
    </div>
  );
}

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
        <div className="label-mono mb-1.5 text-muted-foreground">{copy.label}</div>
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
        <p className="mt-2 text-2xs text-muted-foreground">{copy.remember}</p>
      </div>
    </>
  );
}

function DesignStatus({ design }: { design: ChatDesign }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-2xs text-signal-blue">
      <PencilRuler className="size-3 shrink-0" />
      <span>Design session with Opus · {design.remaining.toLocaleString("en-US")} turns left · ends {new Date(design.expiresAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
    </p>
  );
}

const DESIGN_END_LABELS: Record<DesignEndReason, string> = {
  expired: "Design session ended · time's up",
  exhausted: "Design session ended · no turns left",
  left: "Left the design session",
};

function DesignEndNotice({ reason }: { reason: DesignEndReason }) {
  return (
    <div role="status" className="space-y-1 py-1 text-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="h-px flex-1 bg-line" />
        <span className="label-mono flex min-w-0 items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1">
          <PencilRuler className="size-3 shrink-0" />
          {DESIGN_END_LABELS[reason]}
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <p className="text-2xs text-muted-foreground">You&apos;re back in ordinary chat, which can&apos;t make plans. To keep planning, describe the change again and a new design session will start.</p>
    </div>
  );
}

function DesignDivider() {
  return (
    <div role="separator" aria-label="Design session started" className="design-divider flex items-center gap-2 py-1 text-signal-blue">
      <span className="h-px flex-1 bg-sky-500/40" />
      <span className="label-mono flex shrink-0 items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-1">
        <PencilRuler className="size-3" />
        Design session · {GOD_CHAT_TIER_INFO.opus.persona} takes over
      </span>
      <span className="h-px flex-1 bg-sky-500/40" />
    </div>
  );
}

function ReplyBody({
  content,
  cards = [],
  designAt,
  live,
  awaiting,
  handoff,
  designConsentNode,
  showDesignContent = true,
}: {
  content: string;
  cards?: ChatShownCard[];
  designAt?: number;
  live: boolean;
  awaiting: boolean;
  handoff?: ReactNode;
  designConsentNode?: ReactNode;
  showDesignContent?: boolean;
}) {
  const parts: ReactNode[] = [];
  let from = 0;
  // 分隔线本身带确认框，恒显示；线后的文字、卡片和交接都属于设计内容，由 showDesignContent 统一把守。
  const dividerMark = designAt === undefined
    ? null
    : {
        at: designAt,
        design: false,
        node: (
          <Fragment key="design">
            <DesignDivider />
            {designConsentNode}
            {showDesignContent ? handoff : null}
          </Fragment>
        ),
      };
  const marks = [
    ...cards.map(({ card, at }) => ({ at, design: true, node: <ChatCard key={card} card={card} /> })),
    ...(dividerMark ? [dividerMark] : []),
  ].sort((a, b) => a.at - b.at);
  for (const { at, node, design } of marks) {
    const text = content.slice(from, at);
    if (text.trim() && (showDesignContent || designAt === undefined || from < designAt)) parts.push(<ChatMarkdown key={`text-${from}`} visuals>{text}</ChatMarkdown>);
    if (!design || showDesignContent || designAt === undefined || at < designAt) parts.push(node);
    from = at;
  }
  const rest = content.slice(from);
  if (rest.trim() && (showDesignContent || designAt === undefined || from < designAt)) parts.push(<ChatMarkdown key={`text-${from}`} visuals>{live ? stableMarkdown(rest) : rest}</ChatMarkdown>);
  if (awaiting && !rest.trim() && (showDesignContent || designAt === undefined)) parts.push(<div key="thinking" role="status" className="thinking-shimmer label-mono w-fit">Thinking</div>);
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
    return <div className="label-mono mb-1.5 text-signal-red">Gates closed</div>;
  }
  if (!reply.tier) return null;
  const { persona, label } = GOD_CHAT_TIER_INFO[reply.tier];
  const from = reply.downgradedFrom && GOD_CHAT_TIER_INFO[reply.downgradedFrom];
  const opener = reply.designAt !== undefined && reply.tier === "opus" ? GOD_CHAT_TIER_INFO.sonnet : undefined;
  return (
    <div className="mb-1.5">
      <div className={cn("label-mono", RANK_TONE[reply.tier])}>
        {opener && `${opener.persona} · ${opener.label} → `}{persona} · {reply.servedBy ? modelLabel(reply.servedBy) : label}
      </div>
      {from && (
        <div className="label-mono text-muted-foreground">
          {from.persona} is resting; the {persona} answers instead
        </div>
      )}
      {reply.servedBy && (
        <div className="label-mono text-muted-foreground">
          {label} declined; {modelLabel(reply.servedBy)} stood in
        </div>
      )}
    </div>
  );
}

function RouteStatus({ last, streaming }: { last?: ChatBubble; streaming: boolean }) {
  if (!last || last.role !== "assistant") return <>Routed by Clef</>;
  if (last.tier === undefined) {
    return streaming ? <span className="animate-pulse">Clef routing…</span> : <>Routed by Clef</>;
  }
  if (last.tier === null) return <span className="text-signal-red">Gates closed</span>;
  const { persona, label } = GOD_CHAT_TIER_INFO[last.tier];
  const from = last.downgradedFrom && GOD_CHAT_TIER_INFO[last.downgradedFrom];
  return (
    <span>
      <span className="hidden sm:inline">Clef → </span>
      <span className={RANK_TONE[last.tier]}>
        {persona} · {last.servedBy ? modelLabel(last.servedBy) : label}
      </span>
      {from && (
        <span className="hidden sm:inline"> ({from.persona} resting)</span>
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
      <span className={cn("tabular-nums", full && "text-signal-red")}>
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
    <div className="mb-2 rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-2xs text-muted-foreground">
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
          <span className="label-mono">you</span>
          <span className="label-mono">whole site</span>
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


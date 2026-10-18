"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { ArrowUp, Check, History, PencilRuler, Plus, Square, Trash2 } from "lucide-react";

import { ChatCard } from "@/components/chat-card";
import { ChatMarkdown, preloadChatMarkdown, useChatMarkdownReady } from "@/components/lazy-chat-markdown";
import { FableDescent, type Descent } from "@/components/fable-descent";
import { AnswerCard, AskCard, askAnswerText } from "@/components/ask-card";
import { BuildPlanCard } from "@/components/build-plan-card";
import { Card } from "@/components/ui/card";
import { STREAM_FLUSH_MS, revealedLength, revealedText, stableMarkdown } from "@/lib/streaming-markdown";
import { chatConsent, designConsent, vendorConsent } from "@/lib/chat-consent";
import { chatLineup } from "@/lib/chat-lineup";
import { useHumanCheck } from "@/hooks/use-human-check";
import { textLanguage, type PlanLanguage } from "@shared/build-routine";
import { activeChatDesign, chatArchive, chatResumePoint, designEndReason, chatReplyMessages, designSessionEnded, subscribeChatArchive, type ChatAnswer, type ChatArchive, type ChatBubble, type ChatDesign, type ChatShownCard, type ChatSession, type DesignEndReason } from "@/lib/chat-archive";
import { cn } from "@/lib/utils";
import { workerUrl } from "@/lib/worker-url";
import {
  GOD_CHAT_LIMITS,
  GOD_CHAT_PATH,
  GOD_CHAT_PRESETS,
  GOD_CHAT_USAGE_PATH,
  type GodChatEvent,
  type GodChatMessage,
  fitHistory,
  readGodChatRoute,
  GOD_CHAT_ANTHROPIC_CONSENT,
} from "@shared/god-chat";
import {
  GOD_CHAT_TIER_INFO,
  lineupTiers,
  modelLabel,
  type GodChatCount,
  type GodChatLineup,
  type GodChatServedTier,
  type GodChatUsage,
  type GodChatWebSearch,
} from "@shared/god-chat-tiers";

type Reply = Omit<ChatBubble, "role" | "content">;
type Resumed = { user: ChatBubble & { id: string }; before: ChatBubble[]; keep: ChatBubble[]; handoff: boolean };
const RESUME_DELAY_MS = 2000;
const EMPTY_MESSAGES: ChatBubble[] = [];
// 须与 globals.css 里 .design-halo 的动画总时长一致。
const DESIGN_HALO_MS = 2_400;

const CHAT_URL = workerUrl(process.env.PUBLIC_BACKEND_URL, GOD_CHAT_PATH);
const OFFLINE = "The oracle is offline.";

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
const SUGGESTIONS = GOD_CHAT_PRESETS.map((preset) => preset.text);
const SUGGESTION_SLOTS = 4;
// 每隔这么久只换一格，四格轮流；淡出时长与 globals.css 的 headline-in 一起凑成一次换题。
const SUGGESTION_ROTATE_MS = 3_000;
const SUGGESTION_FADE_MS = 150;
// 访客看到题到点下去有反应延迟：从开始淡出算起这么久内点到的，按换题前那道算。
const SUGGESTION_CLICK_GRACE_MS = 500;

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
  const [sourcesFresh, setSourcesFresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [usage, setUsage] = useState<FetchedUsage | "loading" | null>(null);
  const [descent, setDescent] = useState<Descent | null>(null);
  const designConsented = useSyncExternalStore(designConsent.subscribe, designConsent.getSnapshot, designConsent.getServerSnapshot);
  const [consentPending, setConsentPending] = useState<string | null>(null);
  const [vendorPending, setVendorPending] = useState<VendorPending | null>(null);
  const [designHalo, setDesignHalo] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  // 选项卡的回答以文本发给模型，界面上按这份结构画成卡片；发送时按文本对上。
  const answersRef = useRef<{ text: string; answers: ChatAnswer[] } | null>(null);
  const sessionRef = useRef(0);
  const resumeRef = useRef<() => void>(() => {});
  const human = useHumanCheck();
  const lineup = useSyncExternalStore(chatLineup.subscribe, chatLineup.getSnapshot, chatLineup.getServerSnapshot);
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

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

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

  // anthropic 只给这一条用：访客在单独弹出的 Anthropic 说明里点了拒绝，这条就带 deny 重发，不记下来。
  async function send(text: string, resumed?: Resumed, anthropic?: "deny") {
    setSourcesFresh(false);
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
    let revealed = 0;
    let finished = false;
    let frame = 0;
    let lastFrame = 0;
    let drained: (() => void) | undefined;
    // 交接回复没盖章就被补发整条替掉，先知的开场白拿不回来，分隔线画在规划者回复的最前面。
    let meta: Reply = resumed?.handoff ? { designAt: 0 } : {};
    const session = sessionRef.current;
    const bubble = (): ChatBubble => {
      const content = revealedText(reply, revealed);
      return {
        role: "assistant",
        content,
        ...meta,
        ...(meta.cards && { cards: meta.cards.filter((card) => card.at <= content.length) }),
        ...(meta.designAt !== undefined && designConsent.getSnapshot() ? { designRevealed: true } : {}),
      };
    };
    const replyMessages = (next?: ChatBubble) => chatReplyMessages(
      conversation ? chatArchive.session(conversation.id)?.messages ?? messages : messages,
      user,
      next,
      resumed?.keep,
    );
    const show = () => {
      if (sessionRef.current === session) setMessages(replyMessages(bubble()), false);
    };
    const tick = (now: number) => {
      frame = 0;
      revealed = revealedLength(reply, revealed, lastFrame ? Math.min(now - lastFrame, 100) : 16, finished);
      lastFrame = now;
      show();
      if (revealed < reply.length) frame = requestAnimationFrame(tick);
      else {
        lastFrame = 0;
        drained?.();
      }
    };
    const pace = () => {
      if (!frame && revealed < reply.length) frame = requestAnimationFrame(tick);
    };
    stickRef.current = true;
    if (!messages.length) reveal();
    show();
    if (!resumed) setDraft((current) => (current === text ? "" : current));
    setError(null);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let designToken: string | undefined;
    let answered = false;
    let dropped = false;
    let needsAnthropic = false;
    try {
      if (!CHAT_URL) throw new Error(OFFLINE);
      // 设计同意要读此刻的真值：接受后立刻补发时，闭包里的 designConsented 还是旧的。
      designToken = designConsent.getSnapshot() ? activeChatDesign(conversation?.design)?.token : undefined;
      if (conversation?.design && !designToken && designConsent.getSnapshot()) chatArchive.endDesign(conversation.id, designEndReason(conversation.design), { persist: false });
      // 阵容按点发送那一刻取：等人机验证期间再切换，不能把已发出的这条改派给另一个阵容。
      const sentLineup = chatLineup.getSnapshot();
      const anthropicConsent = anthropic ?? (vendorConsent.claude.getSnapshot() ? "allow" : undefined);
      const post = async () => {
        const proof = await human.proof(controller.signal);
        const res = await fetch(CHAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, lineup: sentLineup, ...(anthropicConsent && { anthropic: anthropicConsent }), ...proof, ...(designToken && { designToken }), ...(resumed && { resume: true }), time: { iso: new Date().toISOString(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone } }),
          signal: controller.signal,
        });
        const data = res.ok && res.body ? null : (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
        return { res, data, usedPass: "humanPass" in proof };
      };
      let attempt = await post();
      // 通行证被拒（签名密钥换了、本地时钟偏了）就丢掉它，当场验一次人重发同一条，不让访客自己再点一遍。
      if (attempt.data?.code === "human_pass_expired" && attempt.usedPass) {
        human.clearPass();
        attempt = await post();
      }
      const { res, data } = attempt;
      if (!res.ok || !res.body) {
        if (conversation && designSessionEnded(data?.code)) {
          chatArchive.endDesign(conversation.id, data?.code === "design_session_exhausted" ? "exhausted" : "expired", { persist: false });
          throw new Error("The design session has ended. Send your message again to continue in ordinary chat.");
        }
        if (data?.code === GOD_CHAT_ANTHROPIC_CONSENT) needsAnthropic = true;
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
          else if (event.type === "seal") meta = { ...meta, seal: event.seal, trace: event.trace, planToken: event.planToken };
          else if (event.type === "pass") human.storePass({ pass: event.pass, expiresAt: event.expiresAt });
          else if (event.type === "card") {
            meta = { ...meta, cards: [...(meta.cards ?? []), { card: event.card, at: reply.length }] };
          } else if (event.type === "design" && conversation) {
            // 连同访客这条一起存下：刷新或断线后要靠它补发规划者的回复。
            chatArchive.update(conversation.id, { design: activeChatDesign({ token: event.token, expiresAt: event.expiresAt, remaining: event.remaining }) });
            if (!designToken && meta.designAt === undefined) {
              meta = { ...meta, designAt: reply.length };
              revealed = reply.length;
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
        pace();
      }
      finished = true;
      // 后台标签页不跑 requestAnimationFrame，直接整段交出；兜底超时防止放字卡住收尾。
      if (revealed < reply.length && !document.hidden) {
        await new Promise<void>((resolve) => {
          drained = resolve;
          pace();
          setTimeout(resolve, STREAM_FLUSH_MS * 3);
        });
      }
    } catch (err) {
      // 设计会话里请求已到 Worker 后断线，规划者那一回合照样跑完、轮数也扣了：留住访客这条，稍后补发错过的回复。
      if (!controller.signal.aborted) {
        if ((designToken && err instanceof TypeError) || (answered && (designToken || meta.designAt !== undefined))) dropped = true;
        else if (!needsAnthropic) setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : OFFLINE);
      }
    } finally {
      if (frame) cancelAnimationFrame(frame);
      revealed = reply.length;
      if (sessionRef.current === session) {
        const kept = reply || meta.cards?.length || meta.proposals?.length || meta.asks?.length;
        if (needsAnthropic) {
          // 这条先撤下，和 Anthropic 那一条说明一起画；访客表态后按原文重发。
          setMessages(replyMessages().filter((message) => message.id !== user.id));
          setVendorPending({ lineup: "claude", text: content, from: "god" });
        } else if (dropped) {
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
      setSourcesFresh(true);
      abortRef.current = null;
    }
  }

  // 设计会话里最后一条访客消息还没拿到盖了章的回复：从会话里取回它错过的那一回合。
  function resume() {
    // 补发不跑 Turnstile：没有有效通行证或对话代码变了还没重新同意时留着那两条，等访客自己再发。
    if ((abortRef.current && !abortRef.current.signal.aborted) || !conversation || !human.hasPass() || !chatConsent.getSnapshot()) return;
    const current = chatArchive.session(conversation.id);
    // 没同意设计时扣着令牌，resume: true 不带 designToken 会被 Worker 拒绝：补发等同意之后再走。
    if (!current || !activeChatDesign(current.design) || !designConsent.getSnapshot()) return;
    const list = current.messages;
    const point = chatResumePoint(list);
    if (!point) return;
    const { at, keep, handoff } = point;
    const user = { ...list[at], id: list[at].id ?? crypto.randomUUID() };
    if (!list[at].id) setMessages([...list.slice(0, at), user, ...list.slice(at + 1)], false);
    void send(user.content, { user, before: list.slice(0, at), keep, handoff });
  }

  useEffect(() => {
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

  function ask(text: string, anthropic?: "deny") {
    if (!text.trim() || streaming) return;
    setUsage(null);
    // 同意前消息只留在本地、不发给 Worker；lyjw 要求说明一出现就在后台跑 Turnstile，访客读完点接受时多半已验完，可以直接发。
    if (!chatConsent.getSnapshot()) {
      if (!messages.length && consentPending === null) reveal();
      setConsentPending(text.trim());
      setDraft("");
      setError(null);
      human.prepare();
      return;
    }
    void send(text, undefined, anthropic);
  }

  function acceptConsent(chosen: GodChatLineup) {
    const text = consentPending;
    setConsentPending(null);
    chatLineup.choose(chosen);
    vendorConsent[chosen].accept();
    chatConsent.accept();
    if (text) ask(text);
  }

  function acceptVendor() {
    const pending = vendorPending;
    if (!pending) return;
    setVendorPending(null);
    vendorConsent[pending.lineup].accept();
    if (pending.from === "switch") chatLineup.choose(pending.lineup);
    if (pending.text) ask(pending.text);
  }

  function declineVendor() {
    const pending = vendorPending;
    setVendorPending(null);
    if (pending?.text) ask(pending.text, "deny");
  }

  // 首次访客还没看过隐私说明，切了再在那份说明里确认；已同意过基础说明的，切到没同意过的厂商先弹那一家。
  function chooseLineup(next: GodChatLineup) {
    if (!chatConsent.getSnapshot() || vendorConsent[next].getSnapshot()) chatLineup.choose(next);
    else setVendorPending({ lineup: next, text: null, from: "switch" });
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

  const godSpeaking = streaming && messages[messages.length - 1]?.tier === "fable";
  const expanded = messages.length > 0 || consentPending !== null || vendorPending !== null;
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
        <div className="-my-1 flex shrink-0 items-center gap-4">
          <LineupSwitch lineup={lineup} onChoose={chooseLineup} />
          <button type="button" onClick={() => runCommand("/clear")} className="flex shrink-0 items-center gap-1 py-1 hover:text-foreground"><Plus className="size-3.5" />New</button>
        </div>
      </div>
      {historyOpen && <SessionList archive={archive} />}
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
                    {/* 参考链接等正文放完才出现：搜索结果在流末尾就到了，放字还没放完时先弹出来会盖过正文。 */}
                    {message.sources?.length && !live ? (
                      <div className={cn("mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2 text-2xs", sourcesFresh && index === messages.length - 1 && "animate-headline-in")}>
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
        {consentPending !== null && <ConsentPrompt text={consentPending} lineup={lineup} onChoose={chooseLineup} onAccept={acceptConsent} onDecline={declineConsent} />}
        {vendorPending !== null && <VendorConsentPrompt pending={vendorPending} onAccept={acceptVendor} onDecline={declineVendor} />}
      </div>

      <div className="border-t border-line px-4 py-3 lg:px-5">
        {error && <p className="mb-2 text-xs text-signal-red">{error}</p>}
        {usage && <UsagePanel usage={usage} lineup={lineup} onClose={() => setUsage(null)} onReset={() => void showUsage(true)} />}
        {conversation?.design && designConsented && <DesignStatus design={conversation.design} />}
        <div ref={human.slotRef} className={cn(human.state === "interactive" && "pb-2")} />
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
            placeholder={human.state === "interactive" ? "Tick the box above to continue…" : human.state === "checking" ? "Verifying you are human…" : "Speak, mortal… (type /)"}
            aria-label="Message"
            className="scrollbar-none max-h-32 min-h-10 flex-1 resize-none rounded-md border border-line-strong bg-surface px-3 py-2 text-base outline-none [field-sizing:content] placeholder:text-muted-foreground focus:border-foreground/40 sm:text-sm [&::-webkit-scrollbar]:hidden"
          />
          {/* 两个按钮各带 key：同类型同位置的元素会被 React 复用，发送按钮会从停止按钮的不透明度过渡到禁用态，结束时闪一下。 */}
          {streaming ? (
            <button
              key="stop"
              type="button"
              aria-label="Stop"
              onClick={() => abortRef.current?.abort()}
              className="paper-card flex size-10 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface text-foreground transition-colors hover:bg-surface-hover"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              key="send"
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
// 隐私说明列出普通对话数据的每个出站去向：两种阵容都用的 workers、clef、browser，加所选阵容那家模型厂商（deepseek 或 anthropicAll）；
// DeepSeek 阵容里 Clef 选了神时另弹 anthropicGod。GitHub 授权由提交计划时的 GithubConsent 单独说明，设计会话的 Managed Agents 保留规则由进入设计会话时的
// DESIGN_CONSENT_COPY 单独说明；Turnstile 人机验证不收对话内容，lyjw 定为不列；新增模型供应商、第三方工具或日志出口时同步改三种语言，对话记录的保留期按
// workers/ai/src/chat/transcripts.ts#TRANSCRIPT_RETENTION_MS 写；Anthropic 与 Clef 的保留和训练说法按 docs/ops-facts.md 记的设置与政策写，两边同步；
// DeepSeek 只写服务器在中国大陆、按其开放平台条款处理，账号的保留与训练设置未核实前不写具体承诺；联网搜索的去向按 /api/chat/usage 回的 webSearch
// （workers/ai/src/chat/web-search.ts#webSearchServices）写，拿不到时用 searchFallback。
type ConsentDestination = { name: string; detail: string };
type ConsentCopy = {
  lang: string;
  label: string;
  intro: string;
  workers: (lookups: string) => ConsentDestination;
  lookupJoin: (services: string[]) => string;
  searchRoles: { both: string; search: string; read: string };
  searchFallback: string;
  clef: ConsentDestination;
  deepseek: ConsentDestination;
  anthropicAll: ConsentDestination;
  anthropicGod: ConsentDestination;
  browser: ConsentDestination;
  accept: string;
  decline: string;
  remember: string;
  declined: string;
};
const CONSENT_COPY: Record<PlanLanguage, ConsentCopy> = {
  en: {
    lang: "en",
    label: "Privacy notice",
    intro: "Before the oracle responds, please review and accept where this chat sends your data:",
    workers: (lookups) => ({ name: "Cloudflare Workers (this site's backend)", detail: `relays your messages and conversation history, and temporarily keeps your IP address within the rate-limit window. When a model looks something up, it sends only that search query or page URL to ${lookups}, never your full conversation. Transcripts are kept for 30 days for debugging, then deleted automatically; server logs only contain request metadata, usage counts, and errors—never message text.` }),
    lookupJoin: (services) => `${services.slice(0, -1).join(", ")} or ${services[services.length - 1]}`,
    searchRoles: { both: "web search and page reads", search: "web search", read: "page reads" },
    searchFallback: "the web search service",
    clef: { name: "Cloudflare Workers AI (Clef router)", detail: "reads your latest message and brief excerpts from recent context to select the appropriate model. Cloudflare does not store this content or use it for training." },
    deepseek: { name: "DeepSeek (DeepSeek API)", detail: "receives the full conversation to generate the Small Fry's and the Prophet's replies. DeepSeek's servers are in mainland China, and this data is processed under DeepSeek's open platform terms." },
    anthropicAll: { name: "Anthropic (Claude API)", detail: "receives the full conversation to generate the Small Fry's, the Prophet's and God's replies. Anthropic retains API data for 30 days for safety review (retained longer if flagged); it is not used for training." },
    anthropicGod: { name: "Anthropic (Claude API)", detail: "receives the full conversation when God answers. Anthropic retains API data for 30 days for safety review (retained longer if flagged); it is not used for training. If you decline, the Prophet answers this message instead." },
    browser: { name: "This browser", detail: "stores your conversations and this consent locally." },
    accept: "Accept",
    decline: "Decline",
    remember: "Your consent is remembered in this browser and will be requested again if chat-related code changes.",
    declined: "No message was sent. Please accept the privacy notice to start chatting.",
  },
  zh: {
    lang: "zh-CN",
    label: "隐私说明",
    intro: "在神谕作答前，请确认本次对话的数据去向：",
    workers: (lookups) => ({ name: "Cloudflare Workers（本站后端）", detail: `负责转发消息与本次对话历史，并在限流窗口内临时保留 IP 地址。模型检索时，只把查询词或网页地址发给${latinGap(lookups)}${lookups}，不发送完整对话。对话记录保留 30 天用于调试，到期自动删除；日志仅包含请求元数据、用量计数与错误信息，不记录任何消息原文。` }),
    lookupJoin: (services) => `${services.slice(0, -1).join("、")} 或 ${services[services.length - 1]}`,
    searchRoles: { both: "联网搜索与读取网页", search: "联网搜索", read: "读取网页" },
    searchFallback: "联网搜索服务",
    clef: { name: "Cloudflare Workers AI（Clef 路由）", detail: "读取最新消息及上下文的简短摘录，用于路由选择合适的模型。Cloudflare 不存储这些内容，亦不用于模型训练。" },
    deepseek: { name: "DeepSeek（DeepSeek API）", detail: "接收完整对话，为「杂鱼」与「先知」生成回复。DeepSeek 的服务器位于中国大陆，数据按 DeepSeek 开放平台条款处理。" },
    anthropicAll: { name: "Anthropic（Claude API）", detail: "接收完整对话，为「杂鱼」「先知」与「神」生成回复。Anthropic 保留 API 数据 30 天（仅供安全审查，违规标记数据会保留更久）；数据不用于模型训练。" },
    anthropicGod: { name: "Anthropic（Claude API）", detail: "由「神」作答时接收完整对话。Anthropic 保留 API 数据 30 天（仅供安全审查，违规标记数据会保留更久）；数据不用于模型训练。拒绝则这条改由「先知」回答。" },
    browser: { name: "当前浏览器", detail: "在本地保存你的对话记录与本次同意状态。" },
    accept: "接受",
    decline: "拒绝",
    remember: "你的同意将保存在当前浏览器中；当对话相关代码发生改动时需要重新确认。",
    declined: "消息未发送。需接受隐私说明后方可开始对话。",
  },
  ja: {
    lang: "ja",
    label: "プライバシーに関するお知らせ",
    intro: "神託が回答する前に、本チャットにおけるデータの送信先をご確認のうえ同意してください：",
    workers: (lookups) => ({ name: "Cloudflare Workers（本サイトのバックエンド）", detail: `メッセージおよび会話履歴を中継し、レート制限期間中のみ IP アドレスを一時保持します。モデルが調べものをする際は、検索クエリまたはページ URL のみを${latinGap(lookups)}${lookups}に送信し、会話全体は送信しません。会話の記録はデバッグ目的で 30 日間保存され、期限後に自動で削除されます。ログにはリクエストのメタデータ、利用回数、エラー情報のみが記録され、メッセージ本文は一切含まれません。` }),
    lookupJoin: (services) => services.join("、"),
    searchRoles: { both: "Web 検索とページ取得", search: "Web 検索", read: "ページ取得" },
    searchFallback: "Web 検索サービス",
    clef: { name: "Cloudflare Workers AI（Clef ルーター）", detail: "最新のメッセージおよび直前の短い会話抜粋を読み取り、最適なモデルを選択します。Cloudflare がこの内容を保存したり、モデルの学習に使用することはありません。" },
    deepseek: { name: "DeepSeek（DeepSeek API）", detail: "「雑魚」と「預言者」の回答生成のために会話全体を受信します。DeepSeek のサーバーは中国本土にあり、データは DeepSeek オープンプラットフォームの規約に基づいて処理されます。" },
    anthropicAll: { name: "Anthropic（Claude API）", detail: "「雑魚」「預言者」「神」の回答生成のために会話全体を受信します。Anthropic は API データを安全確認目的で 30 日間保持します（フラグ適用時は保持期間が延長される場合があります、モデルの学習には不使用）。" },
    anthropicGod: { name: "Anthropic（Claude API）", detail: "「神」が回答する際に会話全体を受信します。Anthropic は API データを安全確認目的で 30 日間保持します（フラグ適用時は保持期間が延長される場合があります、モデルの学習には不使用）。同意しない場合、このメッセージには「預言者」が回答します。" },
    browser: { name: "このブラウザ", detail: "会話履歴と今回の同意状況をローカルに保存します。" },
    accept: "同意する",
    decline: "同意しない",
    remember: "同意内容はブラウザに保存され、チャット関連のコードが更新された際に改めて確認されます。",
    declined: "メッセージは送信されていません。チャットを開始するにはプライバシーに関するお知らせにご同意ください。",
  },
};

const SEARCH_NAMES: Record<"exa" | "deepseek", string> = { exa: "Exa", deepseek: "DeepSeek" };
// 中日文正文里拉丁字母开头的服务名前空一格，和其余文案的排版一致。
const latinGap = (text: string) => (/^[A-Za-z]/.test(text) ? " " : "");

// 搜索与读页同一家就写一次；各是一家就分开写；都没配就只剩 Bangumi 与 Steam。webSearch 为 undefined 是还没问到（或旧版 Worker）。
function lookupServices(copy: ConsentCopy, webSearch: GodChatWebSearch | null | undefined): string {
  const role = (name: string, what: string) => (copy.lang === "en" ? `${name} (${what})` : `${name}（${what}）`);
  const search = webSearch === undefined || webSearch === null ? [copy.searchFallback]
    : webSearch.search && webSearch.search === webSearch.fetch ? [role(SEARCH_NAMES[webSearch.search], copy.searchRoles.both)]
      : [
        ...(webSearch.search ? [role(SEARCH_NAMES[webSearch.search], copy.searchRoles.search)] : []),
        ...(webSearch.fetch ? [role(SEARCH_NAMES[webSearch.fetch], copy.searchRoles.read)] : []),
      ];
  const stores = copy.lang === "en" ? ["Bangumi", "the Steam store"] : copy.lang === "ja" ? ["Bangumi", "Steam ストア"] : ["Bangumi", "Steam 商店"];
  return copy.lookupJoin([...search, ...stores]);
}

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
  const [slots, setSlots] = useState<{ text: string; rotated: boolean; previous?: string; fadedAt?: number }[]>(() =>
    SUGGESTIONS.slice(0, SUGGESTION_SLOTS).map((text) => ({ text, rotated: false })),
  );
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
      const fadedAt = performance.now();
      setLeaving(slot);
      swap = setTimeout(() => {
        setSlots((current) =>
          current.map((entry, index) =>
            index === slot ? { text: SUGGESTIONS[next], rotated: true, previous: entry.text, fadedAt } : entry,
          ),
        );
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
      {slots.map(({ text, rotated, previous, fadedAt }, index) => (
        <button
          key={index}
          type="button"
          disabled={disabled}
          onClick={() =>
            onPick(previous !== undefined && performance.now() - (fadedAt ?? 0) < SUGGESTION_CLICK_GRACE_MS ? previous : text)
          }
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

function useWebSearch(): GodChatWebSearch | undefined {
  const [webSearch, setWebSearch] = useState<GodChatWebSearch | undefined>();
  useEffect(() => {
    if (!USAGE_URL) return;
    const controller = new AbortController();
    fetch(USAGE_URL, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<GodChatUsage>) : null))
      .then((data) => { if (data?.webSearch) setWebSearch(data.webSearch); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return webSearch;
}

function ConsentFrame({ copy, text, destinations, children }: { copy: ConsentCopy; text: string | null; destinations: ConsentDestination[]; children: ReactNode }) {
  return (
    <>
      {text !== null && <UserBubble text={text} />}
      <div role="group" aria-label={copy.label} lang={copy.lang} className="w-full text-sm leading-relaxed text-foreground">
        <div className="label-mono mb-1.5 text-muted-foreground">{copy.label}</div>
        <p>{copy.intro}</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {destinations.map(({ name, detail }) => (
            <li key={name}>
              <span className="font-medium text-foreground">{name}</span>
              {copy.lang === "en" ? ": " : "："}
              {detail}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-col items-start gap-2">{children}</div>
        <p className="mt-2 text-2xs text-muted-foreground">{copy.remember}</p>
      </div>
    </>
  );
}

function ConsentChoice({ copy, onAccept, onDecline }: { copy: ConsentCopy; onAccept: () => void; onDecline: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={onAccept} className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background">{copy.accept}</button>
      <button type="button" onClick={onDecline} className="rounded-md border border-line-strong px-3 py-1.5 text-xs transition-colors hover:bg-surface-hover">{copy.decline}</button>
    </div>
  );
}

// 第一行选杂鱼与先知用哪家，和头部开关是同一个选择；去向列表只列那一家。第二行接受或拒绝。
function ConsentPrompt({ text, lineup: choice, onChoose, onAccept, onDecline }: { text: string; lineup: GodChatLineup; onChoose: (lineup: GodChatLineup) => void; onAccept: (lineup: GodChatLineup) => void; onDecline: () => void }) {
  const copy = CONSENT_COPY[textLanguage(text)];
  const webSearch = useWebSearch();
  const destinations = [copy.workers(lookupServices(copy, webSearch)), copy.clef, choice === "claude" ? copy.anthropicAll : copy.deepseek, copy.browser];
  return (
    <ConsentFrame copy={copy} text={text} destinations={destinations}>
      <div role="radiogroup" aria-label="Models for the Small Fry and the Prophet" className="flex flex-wrap items-center gap-2">
        {LINEUP_OPTIONS.map((option) => (
          <button
            key={option.lineup}
            type="button"
            role="radio"
            aria-checked={choice === option.lineup}
            title={lineupTitle(option.lineup)}
            onClick={() => onChoose(option.lineup)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors",
              choice === option.lineup ? "border-foreground bg-foreground/8 font-medium text-foreground" : "border-line text-muted-foreground hover:border-line-strong hover:text-foreground",
            )}
          >
            {choice === option.lineup && <Check className="size-3.5" aria-hidden />}
            {option.label}
          </button>
        ))}
      </div>
      <ConsentChoice copy={copy} onAccept={() => onAccept(choice)} onDecline={onDecline} />
    </ConsentFrame>
  );
}

type VendorPending = { lineup: GodChatLineup; text: string | null; from: "god" | "switch" };

// 只列一家厂商：神档要用 Anthropic（from god，带着那条消息），或切到还没同意过的阵容（from switch）。
function VendorConsentPrompt({ pending, onAccept, onDecline }: { pending: VendorPending; onAccept: () => void; onDecline: () => void }) {
  const copy = CONSENT_COPY[textLanguage(pending.text ?? "")];
  const destination = pending.lineup === "deepseek" ? copy.deepseek : pending.from === "god" ? copy.anthropicGod : copy.anthropicAll;
  return (
    <ConsentFrame copy={copy} text={pending.text} destinations={[destination]}>
      <ConsentChoice copy={copy} onAccept={onAccept} onDecline={onDecline} />
    </ConsentFrame>
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
  if (rest.trim() && (showDesignContent || designAt === undefined || from < designAt)) parts.push(<ChatMarkdown key={`text-${from}`} visuals streaming={live}>{live ? stableMarkdown(rest) : rest}</ChatMarkdown>);
  if (awaiting && !rest.trim() && (showDesignContent || designAt === undefined)) parts.push(<div key="thinking" role="status" className="thinking-shimmer label-mono w-fit">Thinking</div>);
  return <div className="space-y-2">{parts}</div>;
}

const RANK_TONE: Record<GodChatServedTier, string> = {
  fable: "god-aura bg-clip-text text-transparent font-bold",
  think: "text-foreground",
  sonnet: "text-foreground",
  opus: "text-foreground",
  flash: "text-muted-foreground opacity-70",
  haiku: "text-muted-foreground opacity-70",
};

const LINEUP_OPTIONS: { lineup: GodChatLineup; label: string }[] = [
  { lineup: "deepseek", label: "DeepSeek" },
  { lineup: "claude", label: "Claude" },
];

function lineupTitle(lineup: GodChatLineup): string {
  const [fry, prophet] = lineupTiers(lineup).map((tier) => GOD_CHAT_TIER_INFO[tier].label);
  return `Small Fry: ${fry} · Prophet: ${prophet}`;
}

// 只换杂鱼与先知由谁出场，神始终是 Fable；选了只影响之后发的消息。
function LineupSwitch({ lineup, onChoose }: { lineup: GodChatLineup; onChoose: (lineup: GodChatLineup) => void }) {
  return (
    <div role="radiogroup" aria-label="Models for the Small Fry and the Prophet" className="flex items-center gap-1.5">
      {LINEUP_OPTIONS.map((option, index) => {
        return (
          <Fragment key={option.lineup}>
            {index > 0 && <span aria-hidden>/</span>}
            <button
              type="button"
              role="radio"
              aria-checked={lineup === option.lineup}
              title={lineupTitle(option.lineup)}
              onClick={() => onChoose(option.lineup)}
              className={cn("py-1", lineup === option.lineup ? "text-foreground" : "hover:text-foreground")}
            >
              {option.label}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

function RankLabel({ reply }: { reply: Reply }) {
  if (reply.tier === null) {
    return <div className="label-mono mb-1.5 text-signal-red">Gates closed</div>;
  }
  if (!reply.tier) return null;
  const { persona, label } = GOD_CHAT_TIER_INFO[reply.tier];
  const from = reply.downgradedFrom && GOD_CHAT_TIER_INFO[reply.downgradedFrom];
  const opener = reply.designAt !== undefined && reply.tier === "opus" ? GOD_CHAT_TIER_INFO.think.persona : undefined;
  return (
    <div className="mb-1.5">
      <div className={cn("label-mono", RANK_TONE[reply.tier])}>
        {opener && `${opener} → `}{persona} · {reply.servedBy ? modelLabel(reply.servedBy) : label}
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
  lineup,
  onClose,
  onReset,
}: {
  usage: FetchedUsage | "loading";
  lineup: GodChatLineup;
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
          {lineupTiers(lineup).reverse().map((tier) => (
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


"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ArrowUp, History, PencilRuler, Plus, Square, Trash2 } from "lucide-react";

import { AnswerCard, AskCard, BuildPlanCard } from "@/components/lazy-chat-cards";
import { ChatMarkdown, preloadChatMarkdown, useChatMarkdownReady } from "@/components/lazy-chat-markdown";
import { FableDescent, type Descent } from "@/components/fable-descent";
import { Card } from "@/components/ui/card";
import { STREAM_FLUSH_MS, revealedLength, revealedText, stableMarkdown } from "@/lib/streaming-markdown";
import { chatConsent, designConsent, vendorConsent } from "@/lib/chat-consent";
import { askAnswerText } from "@/lib/ask-answer-text";
import { chatLineup } from "@/lib/chat-lineup";
import { useHumanCheck } from "@/hooks/use-human-check";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import { textLanguage } from "@shared/build-routine";
import { activeChatDesign, chatArchive, chatResumePoint, designEndReason, chatReplyMessages, designSessionEnded, subscribeChatArchive, type ChatAnswer, type ChatArchive, type ChatBubble, type ChatSession } from "@/lib/chat-archive";
import { cn } from "@/lib/utils";
import { workerUrl } from "@/lib/worker-url";
import { GOD_CHAT_LIMITS, GOD_CHAT_PATH, GOD_CHAT_PRESETS, type GodChatEvent, type GodChatMessage, fitHistory, readGodChatRoute, GOD_CHAT_ANTHROPIC_CONSENT } from "@shared/god-chat";
import type { GodChatLineup, GodChatUsage } from "@shared/god-chat-tiers";
import { type Reply, PlannerActivity, DesignStatus, DesignEndNotice, ReplyBody, LineupSwitch, RankLabel, RouteStatus } from "@/components/god-chat/message-parts";
import { USAGE_URL, type FetchedUsage, UsagePanel } from "@/components/god-chat/usage";
import { CONSENT_COPY, DesignConsentPrompt, ConsentPrompt, type VendorPending, VendorConsentPrompt } from "@/components/god-chat/consent";

type Resumed = { user: ChatBubble & { id: string }; before: ChatBubble[]; keep: ChatBubble[]; handoff: boolean };
const RESUME_DELAY_MS = 2000;
const EMPTY_MESSAGES: ChatBubble[] = [];
// 须与 src/app/styles/chat-effects.css 里 .design-halo 的动画总时长一致。
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
const USAGE_RETRY_MS = 5_000;
const EDGE_GAP_PX = 12;
const SUGGESTIONS = GOD_CHAT_PRESETS.map((preset) => preset.text);

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
  useStickToBottom(scrollRef, stickRef, [messages, markdownReady]);

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
            meta = { ...meta, cards: [...(meta.cards ?? []), { card: event.card, at: reply.length, ...(event.game && { game: event.game }) }] };
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
    const current = chatLineup.getSnapshot();
    if (!vendorConsent[current].getSnapshot()) {
      setVendorPending({ lineup: current, text: text.trim(), from: "send" });
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
    if (pending.text) ask(pending.text);
  }

  function declineVendor() {
    const pending = vendorPending;
    setVendorPending(null);
    if (!pending?.text) return;
    if (pending.from === "god") return ask(pending.text, "deny");
    setDraft((current) => current || pending.text || "");
    setError(CONSENT_COPY[textLanguage(pending.text)].declined);
  }

  // 切阵容不弹说明，等点发送时再按那条消息的语言弹没同意过的厂商。
  function chooseLineup(next: GodChatLineup) {
    chatLineup.choose(next);
    if (vendorPending?.from === "send" && vendorPending.text) {
      const text = vendorPending.text;
      setVendorPending(null);
      ask(text);
    }
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
          // 手机上卡片高度放不下提示句加单列示例，提示句只在 sm 以上显示。
          <div className="m-auto flex w-full max-w-md flex-col items-center gap-3 text-center sm:py-2">
            <p className="hidden text-sm leading-relaxed text-muted-foreground sm:block">
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

function Suggestions({ disabled, onPick }: { disabled: boolean; onPick: (text: string) => void }) {
  return (
    <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
      {SUGGESTIONS.map((text) => (
        <button
          key={text}
          type="button"
          disabled={disabled}
          onClick={() => onPick(text)}
          className="paper-card overflow-hidden rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs whitespace-nowrap text-foreground transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          {text}
        </button>
      ))}
    </div>
  );
}

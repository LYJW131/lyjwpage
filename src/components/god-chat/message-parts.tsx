"use client";

import { Fragment, type ReactNode } from "react";
import { PencilRuler } from "lucide-react";

import { ChatCard } from "@/components/lazy-chat-cards";
import { ChatMarkdown } from "@/components/lazy-chat-markdown";
import { stableMarkdown } from "@/lib/streaming-markdown";
import type { ChatBubble, ChatDesign, ChatShownCard, DesignEndReason } from "@/lib/chat-archive";
import { cn } from "@/lib/utils";
import { GOD_CHAT_TIER_INFO, lineupTiers, modelLabel, type GodChatLineup, type GodChatServedTier } from "@shared/god-chat-tiers";

export type Reply = Omit<ChatBubble, "role" | "content">;
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
export function PlannerActivity({ message, live }: { message: ChatBubble; live: boolean }) {
  if (!message.docs?.length && !message.steps?.length && !message.searches?.length) return null;
  return (
    <div>
      {message.docs?.length ? <DocReads docs={message.docs} /> : null}
      {message.steps?.length ? <PlannerSteps steps={message.steps} live={live} /> : null}
      {message.searches?.length ? <Searches searches={message.searches} live={live} /> : null}
    </div>
  );
}

// 搜了不止一次就收起来，和读文档、沙盒步骤一样一行带过；流式中摘要行跟着最新那次搜索走。
function Searches({ searches, live }: { searches: string[]; live: boolean }) {
  const line = (query: string) => `Searched “${query}”`;
  return (
    <div className="label-mono mb-1.5 text-muted-foreground">
      {searches.length === 1 ? line(searches[0]) : (
        <details className="space-y-1">
          <summary className="cursor-pointer truncate">
            {live ? line(searches[searches.length - 1]) : `Ran ${searches.length.toLocaleString("en-US")} searches`}
          </summary>
          <ol className="space-y-0.5 pl-3">
            {searches.map((query, i) => <li key={i} className="leading-snug [overflow-wrap:anywhere]">{line(query)}</li>)}
          </ol>
        </details>
      )}
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

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="min-w-0 max-w-[85%] whitespace-pre-wrap rounded-lg bg-foreground px-3 py-2 text-sm leading-relaxed text-background [overflow-wrap:anywhere]">{text}</div>
    </div>
  );
}

export function DesignStatus({ design }: { design: ChatDesign }) {
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

export function DesignEndNotice({ reason }: { reason: DesignEndReason }) {
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

export function ReplyBody({
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
    ...cards.map(({ card, at, game }) => ({ at, design: true, node: <ChatCard key={game ? `${card}:${game}` : card} card={card} game={game} entering={live} /> })),
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

export const RANK_TONE: Record<GodChatServedTier, string> = {
  fable: "god-aura bg-clip-text text-transparent font-bold",
  think: "text-foreground",
  sonnet: "text-foreground",
  opus: "text-foreground",
  flash: "text-muted-foreground opacity-70",
  haiku: "text-muted-foreground opacity-70",
};

export const LINEUP_OPTIONS: { lineup: GodChatLineup; label: string }[] = [
  { lineup: "deepseek", label: "DeepSeek" },
  { lineup: "claude", label: "Claude" },
];

export function lineupTitle(lineup: GodChatLineup): string {
  const [fry, prophet] = lineupTiers(lineup).map((tier) => GOD_CHAT_TIER_INFO[tier].label);
  return `Small Fry: ${fry} · Prophet: ${prophet}`;
}

// 只换杂鱼与先知由谁出场，神始终是 Fable；选了只影响之后发的消息。
export function LineupSwitch({ lineup, onChoose }: { lineup: GodChatLineup; onChoose: (lineup: GodChatLineup) => void }) {
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

export function RankLabel({ reply }: { reply: Reply }) {
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

export function RouteStatus({ last, streaming }: { last?: ChatBubble; streaming: boolean }) {
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

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, PencilRuler } from "lucide-react";

import { textLanguage, type PlanLanguage } from "@shared/build-routine";
import { cn } from "@/lib/utils";
import type { GodChatLineup, GodChatUsage, GodChatWebSearch } from "@shared/god-chat-tiers";
import { UserBubble, LINEUP_OPTIONS, lineupTitle } from "@/components/god-chat/message-parts";
import { USAGE_URL } from "@/components/god-chat/usage";

// lyjw 要求隐私说明跟随访客消息的语言（中日英，判断与设计模式的计划同一套），是「界面文案英文」的例外。
// 隐私说明列出普通对话数据的每个出站去向：两种阵容都用的 workers、clef、browser，加所选阵容那家模型厂商（deepseek 或 anthropicAll）；
// DeepSeek 阵容里 Clef 选了神时另弹 anthropicGod。GitHub 授权由提交计划时的 GithubConsent 单独说明，设计会话的 Managed Agents 保留规则由进入设计会话时的
// DESIGN_CONSENT_COPY 单独说明；Turnstile 人机验证不收对话内容，lyjw 定为不列；新增模型供应商、第三方工具或日志出口时同步改三种语言，对话记录的保留期按
// workers/ai/src/chat/transcripts.ts#TRANSCRIPT_RETENTION_MS 写；Anthropic 与 Clef、Clairic 的保留和训练说法按 docs/ops-facts.md 记的设置与政策写，两边同步；
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
  steamStore: string;
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
export const CONSENT_COPY: Record<PlanLanguage, ConsentCopy> = {
  en: {
    lang: "en",
    steamStore: "the Steam store",
    label: "Privacy notice",
    intro: "Before the oracle responds, please review and accept where this chat sends your data:",
    workers: (lookups) => ({ name: "Cloudflare Workers (this site's backend)", detail: `relays your messages and conversation history, and temporarily keeps your IP address within the rate-limit window. When a model looks something up, it sends only that search query or page URL to ${lookups}, never your full conversation. Transcripts are kept for 30 days for debugging, then deleted automatically; server logs only contain request metadata, usage counts, and errors—never message text.` }),
    lookupJoin: (services) => `${services.slice(0, -1).join(", ")} or ${services[services.length - 1]}`,
    searchRoles: { both: "web search and page reads", search: "web search", read: "page reads" },
    searchFallback: "the web search service",
    clef: { name: "Cloudflare Workers AI (Clef router, Clairic extractor)", detail: "Clef reads your latest message and brief excerpts from recent context to select the appropriate model; Clairic reads your latest message to pick out any game, song or show you name, so the matching status can be looked up first. Cloudflare does not store this content or use it for training." },
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
    steamStore: "Steam 商店",
    label: "隐私说明",
    intro: "在神谕作答前，请确认本次对话的数据去向：",
    workers: (lookups) => ({ name: "Cloudflare Workers（本站后端）", detail: `负责转发消息与本次对话历史，并在限流窗口内临时保留 IP 地址。模型检索时，只把查询词或网页地址发给${latinGap(lookups)}${lookups}，不发送完整对话。对话记录保留 30 天用于调试，到期自动删除；日志仅包含请求元数据、用量计数与错误信息，不记录任何消息原文。` }),
    lookupJoin: (services) => `${services.slice(0, -1).join("、")} 或 ${services[services.length - 1]}`,
    searchRoles: { both: "联网搜索与读取网页", search: "联网搜索", read: "读取网页" },
    searchFallback: "联网搜索服务",
    clef: { name: "Cloudflare Workers AI（Clef 路由、Clairic 抽取）", detail: "Clef 读取最新消息及上下文的简短摘录，用于路由选择合适的模型；Clairic 读取最新消息，挑出其中点名的游戏、歌曲或剧集，以便先查对应的状态。Cloudflare 不存储这些内容，亦不用于模型训练。" },
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
    steamStore: "Steam ストア",
    label: "プライバシーに関するお知らせ",
    intro: "神託が回答する前に、本チャットにおけるデータの送信先をご確認のうえ同意してください：",
    workers: (lookups) => ({ name: "Cloudflare Workers（本サイトのバックエンド）", detail: `メッセージおよび会話履歴を中継し、レート制限期間中のみ IP アドレスを一時保持します。モデルが調べものをする際は、検索クエリまたはページ URL のみを${latinGap(lookups)}${lookups}に送信し、会話全体は送信しません。会話の記録はデバッグ目的で 30 日間保存され、期限後に自動で削除されます。ログにはリクエストのメタデータ、利用回数、エラー情報のみが記録され、メッセージ本文は一切含まれません。` }),
    lookupJoin: (services) => services.join("、"),
    searchRoles: { both: "Web 検索とページ取得", search: "Web 検索", read: "ページ取得" },
    searchFallback: "Web 検索サービス",
    clef: { name: "Cloudflare Workers AI（Clef ルーター、Clairic 抽出）", detail: "Clef は最新のメッセージおよび直前の短い会話抜粋を読み取り、最適なモデルを選択します。Clairic は最新のメッセージから名前の挙がったゲーム・曲・作品を取り出し、該当する状態を先に調べられるようにします。Cloudflare がこの内容を保存したり、モデルの学習に使用することはありません。" },
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
  return copy.lookupJoin([...search, "Bangumi", copy.steamStore]);
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

export function DesignConsentPrompt({
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
export function ConsentPrompt({ text, lineup: choice, onChoose, onAccept, onDecline }: { text: string; lineup: GodChatLineup; onChoose: (lineup: GodChatLineup) => void; onAccept: (lineup: GodChatLineup) => void; onDecline: () => void }) {
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

export type VendorPending = { lineup: GodChatLineup; text: string | null; from: "god" | "send" };

// 只列一家厂商：神档要用 Anthropic（from god），或用还没同意过的阵容发消息（from send）；都带着那条消息。
export function VendorConsentPrompt({ pending, onAccept, onDecline }: { pending: VendorPending; onAccept: () => void; onDecline: () => void }) {
  const copy = CONSENT_COPY[textLanguage(pending.text ?? "")];
  const destination = pending.lineup === "deepseek" ? copy.deepseek : pending.from === "god" ? copy.anthropicGod : copy.anthropicAll;
  return (
    <ConsentFrame copy={copy} text={pending.text} destinations={[destination]}>
      <ConsentChoice copy={copy} onAccept={onAccept} onDecline={onDecline} />
    </ConsentFrame>
  );
}

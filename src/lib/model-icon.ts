import { SITE_ASSETS_PREFIX } from "@/lib/site-assets";

export type ModelIconMapping = { icon: string; keywords: readonly string[] };

// 排在 LobeHub 上游表之前：站点自己的品牌取舍（Claude 用 Anthropic 标）、上游还没收录的模型家族、
// 上游锚定写法认不出的 ID 形状（Cursor 上报 `cursor-grok-4.6-…`）。
// 值是 `@lobehub/icons/es/<名字>` 的目录名；关键字与上游同义：不区分大小写的正则，对整个模型 ID 测试。
export const SITE_MODEL_ICONS = [
  { icon: "Anthropic", keywords: ["claude"] },
  { icon: "Devin", keywords: ["(^|[/-])swe-\\d"] },
  { icon: "Grok", keywords: ["(^|[/-])grok-"] },
] as const satisfies readonly ModelIconMapping[];

// 常见的几家作为组件随卡片打包；其余厂商由 `pnpm assets` 渲染成 `MODEL_ICON_DIR` 下的 SVG，按 CSS mask 着色。
// 不走 React.lazy：首页 SSR 很大，React 会把 Suspense 边界外移到文档末尾流式补上，图标首绘为空、水合时还会闪没。
export const BUNDLED_MODEL_ICONS = ["Anthropic", "Cursor", "Devin", "Grok", "OpenAI"] as const;

export type BundledModelIcon = (typeof BUNDLED_MODEL_ICONS)[number];

export const MODEL_ICON_DIR = `${SITE_ASSETS_PREFIX}/model-icons`;

export function modelIconUrl(icon: string) {
  return `${MODEL_ICON_DIR}/${icon}.svg`;
}

// 上报方会给模型 ID 加来源前缀，如 Pi 的 `[pi] kimi-k3`；上游关键字多以 `^` 锚定，先去掉。
function normalizeModelId(model: string) {
  return model.trim().toLowerCase().replace(/^\[[^\]]*\]\s*/, "");
}

export function modelIconResolver(upstream: readonly ModelIconMapping[]) {
  const rules = [...SITE_MODEL_ICONS, ...upstream].map(({ icon, keywords }) => ({
    icon,
    patterns: keywords.map((keyword) => new RegExp(keyword, "i")),
  }));
  const cache = new Map<string, string | null>();
  return (model: string): string | null => {
    const id = normalizeModelId(model);
    if (!cache.has(id)) {
      cache.set(id, rules.find((rule) => rule.patterns.some((pattern) => pattern.test(id)))?.icon ?? null);
    }
    return cache.get(id) ?? null;
  };
}

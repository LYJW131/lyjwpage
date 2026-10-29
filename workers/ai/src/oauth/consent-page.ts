import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { site } from "@shared/site";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

// 这页由 ai Worker 直接出，拿不到站点带哈希的样式表；色值照抄站点主题，consent-page.test.ts 逐个对照 src/app/styles/theme.css。
export const PAGE_TOKENS = {
  light: {
    background: "oklch(0.94 0.007 92)",
    foreground: "oklch(0.19 0.006 80)",
    muted: "oklch(0.965 0.008 92)",
    "muted-foreground": "oklch(0.48 0.008 80)",
    surface: "oklch(0.995 0.006 92)",
    "surface-hover": "oklch(0.945 0.012 90)",
    line: "oklch(0.19 0.006 80 / 24%)",
    "line-strong": "oklch(0.19 0.006 80 / 88%)",
    "paper-shadow": "oklch(0.19 0.006 80 / 18%)",
    "signal-orange-ink": "oklch(0.56 0.16 45)",
  },
  dark: {
    background: "oklch(0.15 0.008 85)",
    foreground: "oklch(0.93 0.012 90)",
    muted: "oklch(0.205 0.008 85)",
    "muted-foreground": "oklch(0.66 0.012 90)",
    surface: "oklch(0.185 0.008 85)",
    "surface-hover": "oklch(0.235 0.01 85)",
    line: "oklch(0.93 0.012 90 / 20%)",
    "line-strong": "oklch(0.93 0.012 90 / 76%)",
    "paper-shadow": "oklch(0 0 0 / 52%)",
    "signal-orange-ink": "#d66b35",
  },
} as const;

const vars = (tokens: Record<string, string>) => Object.entries(tokens).map(([name, value]) => `--${name}: ${value};`).join(" ");

const STYLE = `
  :root { color-scheme: light; ${vars(PAGE_TOKENS.light)} }
  :root.dark { color-scheme: dark; ${vars(PAGE_TOKENS.dark)} }
  @media (prefers-color-scheme: dark) { :root:not(.light) { color-scheme: dark; ${vars(PAGE_TOKENS.dark)} } }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 16px;
    background-color: var(--background); color: var(--foreground);
    background-image:
      linear-gradient(to right, color-mix(in oklab, var(--foreground) 3%, transparent) 1px, transparent 1px),
      linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 3%, transparent) 1px, transparent 1px);
    background-size: 24px 24px;
    font: 14px/1.5 "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;
    font-variant-numeric: tabular-nums slashed-zero;
    -webkit-font-smoothing: antialiased;
  }
  :root.dark body { background-image: none; }
  @media (prefers-color-scheme: dark) { :root:not(.light) body { background-image: none; } }
  main { width: 100%; max-width: 24rem; border: 1px solid var(--line-strong); background: var(--surface); box-shadow: 3px 3px 0 var(--paper-shadow); }
  .label { font-size: 11px; line-height: 1; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted-foreground); }
  header { min-height: 36px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 16px; background: var(--muted); border-bottom: 1px solid var(--line); }
  .body { display: flex; flex-direction: column; gap: 16px; padding: 16px; }
  h1 { margin: 0; font-size: 18px; line-height: 1.4; font-weight: 600; text-wrap: balance; }
  dl { margin: 0; display: flex; flex-direction: column; gap: 12px; }
  dl div { display: flex; flex-direction: column; gap: 4px; }
  dd { margin: 0; overflow-wrap: break-word; }
  .note { margin: 0; font-size: 12px; color: var(--muted-foreground); }
  .warn { color: var(--signal-orange-ink); }
  .actions { display: flex; border-top: 1px solid var(--line); }
  button { flex: 1; min-height: 44px; border: 0; background: none; color: var(--foreground); font: inherit; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; transition: background-color 120ms ease; }
  button + button { border-left: 1px solid var(--line); }
  button:hover { background: var(--surface-hover); }
  button:focus-visible { outline: 2px solid var(--foreground); outline-offset: -2px; }
  @media (min-width: 1024px) { header { padding-inline: 20px; } .body { padding: 20px; gap: 20px; } h1 { font-size: 20px; } }
`;

// 跟站点同一个 localStorage 键：lyjw 在站点上手选的明暗在这页也生效；读不到就跟系统。
const THEME = `try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")document.documentElement.classList.add(t)}catch(e){}`;

function page(title: string, label: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escape(title)} · ${escape(site.name)}</title><script>${THEME}</script><style>${STYLE}</style></head>
<body><main><header><span class="label">${escape(label)}</span><span class="label">${escape(new URL(site.url).host)}</span></header>${body}</main></body></html>`;
}

function row(label: string, value: string, note?: { text: string; warn?: true }): string {
  return `<div><dt class="label">${label}</dt><dd>${value}</dd>${note ? `<dd class="note${note.warn ? " warn" : ""}">${note.text}</dd>` : ""}</div>`;
}

// 客户端名字由对方自报，只有 CIMD 的域名经过核实；同意页把两者分开写，回环回调另加提醒。
export function consentPage(details: ConsentDescription, handle: string, action: string): string {
  const client = details.clientName ? escape(details.clientName) : escape(details.clientId);
  const identity = details.clientDomain
    ? row("Client", client, { text: `Verified at ${escape(details.clientDomain)}` })
    : row("Client", client, { text: "Self-registered; this name is not verified.", warn: true });
  const returnsTo = details.redirectIsLoopback
    ? row("Returns to", `An app on this device (${escape(details.redirectHost)})`, { text: "Only continue if you just started this sign-in.", warn: true })
    : row("Returns to", escape(details.redirectHost));
  return page("Allow access", "MCP sign-in", `
<div class="body">
  <h1>Allow ${client} to read private history?</h1>
  <dl>${identity}${returnsTo}${row("Access", "Private history archive, read only")}</dl>
  <p class="note">You will sign in with GitHub next. Only ${escape(site.shortName)}'s account can finish.</p>
</div>
<form method="post" action="${escape(action)}">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <div class="actions"><button name="decision" value="deny">Deny</button><button name="decision" value="approve">Allow</button></div>
</form>`);
}

export function messagePage(status: number, title: string, detail: string): Response {
  return new Response(page(title, "MCP sign-in", `<div class="body"><h1>${escape(title)}</h1><p class="note">${escape(detail)}</p></div>`), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

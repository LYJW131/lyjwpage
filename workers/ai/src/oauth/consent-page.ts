import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { site } from "@shared/site";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

const STYLE = `
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
  main { width: min(28rem, calc(100% - 2rem)); padding: 1.5rem; border: 1px solid GrayText; border-radius: 0.75rem; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  p, li { line-height: 1.5; }
  .warn { color: #b45309; }
  .actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
  button { flex: 1; padding: 0.625rem; border-radius: 0.5rem; border: 1px solid GrayText; font: inherit; cursor: pointer; }
  button[value="approve"] { background: CanvasText; color: Canvas; }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escape(title)} · ${escape(site.name)}</title><style>${STYLE}</style></head>
<body><main>${body}</main></body></html>`;
}

// 客户端名字由对方自报，只有 CIMD 的域名经过核实；同意页把两者分开写，回环回调另加提醒。
export function consentPage(details: ConsentDescription, handle: string, action: string): string {
  const client = details.clientName ? escape(details.clientName) : escape(details.clientId);
  const identity = details.clientDomain
    ? `<li>Client identity verified at <strong>${escape(details.clientDomain)}</strong>.</li>`
    : `<li class="warn">This client registered itself; its name is not verified.</li>`;
  const loopback = details.redirectIsLoopback
    ? `<li class="warn">It returns to an app on this device (${escape(details.redirectHost)}). Only continue if you just started this sign-in.</li>`
    : `<li>It returns to <strong>${escape(details.redirectHost)}</strong>.</li>`;
  return page("Allow access", `
<h1>Allow ${client} to read private history?</h1>
<ul>${identity}${loopback}<li>You will sign in with GitHub next. Only ${escape(site.shortName)}'s account can finish.</li></ul>
<form method="post" action="${escape(action)}">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <div class="actions"><button name="decision" value="deny">Deny</button><button name="decision" value="approve">Allow</button></div>
</form>`);
}

export function messagePage(status: number, title: string, detail: string): Response {
  return new Response(page(title, `<h1>${escape(title)}</h1><p>${escape(detail)}</p>`), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

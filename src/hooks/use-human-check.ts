import { useEffect, useRef, useState } from "react";

import { GOD_CHAT_PASS_PATTERN, GOD_CHAT_TURNSTILE_ACTION } from "@shared/god-chat";

type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

export type HumanProof = { humanPass: string } | { turnstileToken: string };
export type HumanCheckState = "idle" | "checking" | "interactive";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SITE_KEY = process.env.PUBLIC_TURNSTILE_SITE_KEY ?? "";
const PASS_KEY = "lyjw.chat.pass";
// 快到期的通行证不拿去用：请求路上过期会白挨一次 403。
const PASS_MARGIN_MS = 60_000;
// Turnstile token 五分钟过期；早跑出来的 token 留一点余量，过了就重跑。
const TOKEN_TTL_MS = 270_000;
const LOAD_TIMEOUT_MS = 15_000;
export const HUMAN_CHECK_UNAVAILABLE = "Human verification couldn't load. Check your connection or ad blocker, then reload the page.";
const HUMAN_CHECK_FAILED = "Human verification failed. Send again to retry.";

type StoredPass = { pass: string; expiresAt: number };
let passInMemory: StoredPass | null = null;

function readPass(): StoredPass | null {
  let value: unknown = passInMemory;
  try {
    value = JSON.parse(window.localStorage.getItem(PASS_KEY) ?? "null") ?? passInMemory;
  } catch {
  }
  const pass = value as StoredPass | null;
  return pass && typeof pass.pass === "string" && GOD_CHAT_PASS_PATTERN.test(pass.pass) && typeof pass.expiresAt === "number" && pass.expiresAt - PASS_MARGIN_MS > Date.now() ? pass : null;
}

function writePass(pass: StoredPass | null) {
  passInMemory = pass;
  try {
    if (pass) window.localStorage.setItem(PASS_KEY, JSON.stringify(pass));
    else window.localStorage.removeItem(PASS_KEY);
  } catch {
  }
}

let scriptLoad: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptLoad ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    const failed = () => {
      scriptLoad = null;
      script.remove();
      reject(new Error(HUMAN_CHECK_UNAVAILABLE));
    };
    const timer = setTimeout(failed, LOAD_TIMEOUT_MS);
    script.addEventListener("load", () => {
      clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else failed();
    }, { once: true });
    script.addEventListener("error", () => {
      clearTimeout(timer);
      failed();
    }, { once: true });
    script.src = SCRIPT_SRC;
    script.async = true;
    document.head.appendChild(script);
  });
  return scriptLoad;
}

type Widget = { id: string; turnstile: Turnstile };
type Waiter = { resolve: (token: string) => void; reject: (error: Error) => void };

// 通行证在手就不碰 Turnstile；没有时才跑一次挑战，换来的通行证存在 localStorage，跨标签页、重开浏览器都还在。
// 挑战用 execution: "execute"，只在 run() 时才跑；交互挑战超时不当成失败，消息不退回输入框。
export function useHumanCheck() {
  const slotRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<Widget | null>(null);
  const runningRef = useRef(false);
  const tokenRef = useRef<{ token: string; at: number } | null>(null);
  const waiterRef = useRef<Waiter | null>(null);
  const [state, setState] = useState<HumanCheckState>("idle");

  useEffect(() => () => {
    const widget = widgetRef.current;
    widgetRef.current = null;
    if (widget) widget.turnstile.remove(widget.id);
  }, []);

  function fail(message: string) {
    runningRef.current = false;
    tokenRef.current = null;
    setState("idle");
    const widget = widgetRef.current;
    if (widget) widget.turnstile.reset(widget.id);
    const waiter = waiterRef.current;
    waiterRef.current = null;
    waiter?.reject(new Error(message));
  }

  async function widget(): Promise<Widget> {
    if (widgetRef.current) return widgetRef.current;
    if (!SITE_KEY) throw new Error(HUMAN_CHECK_UNAVAILABLE);
    const turnstile = await loadTurnstile();
    if (widgetRef.current) return widgetRef.current;
    const el = slotRef.current;
    if (!el) throw new Error(HUMAN_CHECK_UNAVAILABLE);
    const id = turnstile.render(el, {
      sitekey: SITE_KEY,
      action: GOD_CHAT_TURNSTILE_ACTION,
      appearance: "interaction-only",
      execution: "execute",
      theme: "auto",
      language: "en",
      retry: "never",
      "refresh-expired": "never",
      "refresh-timeout": "never",
      callback: (token: string) => {
        runningRef.current = false;
        setState("idle");
        const waiter = waiterRef.current;
        waiterRef.current = null;
        if (waiter) waiter.resolve(token);
        else tokenRef.current = { token, at: Date.now() };
      },
      "expired-callback": () => { tokenRef.current = null; },
      // 组件自带的超时刷新会把 execute 模式打回「没执行」，挑战不再继续，这里自己接手：访客已发消息就再出一个复选框，
      // 还在读隐私说明就先停下，等发送时 run() 重跑。
      "timeout-callback": () => {
        runningRef.current = false;
        setState(waiterRef.current ? "checking" : "idle");
        if (waiterRef.current) void run().catch((error: unknown) => fail(error instanceof Error ? error.message : HUMAN_CHECK_UNAVAILABLE));
        else if (widgetRef.current) widgetRef.current.turnstile.reset(widgetRef.current.id);
      },
      "before-interactive-callback": () => setState("interactive"),
      "after-interactive-callback": () => setState(waiterRef.current ? "checking" : "idle"),
      "error-callback": () => { fail(HUMAN_CHECK_FAILED); return true; },
      "unsupported-callback": () => fail(HUMAN_CHECK_UNAVAILABLE),
    });
    widgetRef.current = { id, turnstile };
    return widgetRef.current;
  }

  async function run() {
    if (runningRef.current) return;
    const current = await widget();
    if (runningRef.current) return;
    runningRef.current = true;
    tokenRef.current = null;
    current.turnstile.reset(current.id);
    current.turnstile.execute(current.id);
  }

  return {
    slotRef,
    state,
    hasPass: () => readPass() !== null,
    storePass: (pass: StoredPass) => writePass(pass),
    clearPass: () => writePass(null),
    // 访客快要发消息时（隐私说明弹出）先在后台跑挑战，点接受时多半已拿到 token。
    prepare() {
      if (readPass() || !SITE_KEY) return;
      if (tokenRef.current && Date.now() - tokenRef.current.at < TOKEN_TTL_MS) return;
      void run().catch(() => {});
    },
    async proof(signal: AbortSignal): Promise<HumanProof> {
      const pass = readPass();
      if (pass) return { humanPass: pass.pass };
      const cached = tokenRef.current;
      tokenRef.current = null;
      if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return { turnstileToken: cached.token };
      const token = new Promise<string>((resolve, reject) => {
        waiterRef.current?.reject(new Error(HUMAN_CHECK_FAILED));
        waiterRef.current = { resolve, reject };
        signal.addEventListener("abort", () => {
          if (waiterRef.current?.reject !== reject) return;
          waiterRef.current = null;
          runningRef.current = false;
          setState("idle");
          const widget = widgetRef.current;
          if (widget) widget.turnstile.reset(widget.id);
          reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
        }, { once: true });
      });
      setState((current) => (current === "interactive" ? current : "checking"));
      run().catch((error: unknown) => fail(error instanceof Error ? error.message : HUMAN_CHECK_UNAVAILABLE));
      return { turnstileToken: await token };
    },
  };
}

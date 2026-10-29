import path from "node:path";
import { parseArgs as utilParseArgs } from "node:util";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");

export type Flags = { [key: string]: string | boolean | undefined; url: string };
export type Box = { x: number; y: number; width: number; height: number };
export type Viewport = { width: number; height: number };

export const errorText = (error: unknown) => String((error as { message?: unknown } | null)?.message ?? error);
export const stringFlag = (value: string | boolean | undefined) => (typeof value === "string" ? value : undefined);

export const DEFAULT_URL = `http://localhost:${process.env.DEV_SITE_PORT || "3211"}`;
export const WORKER_URL = (process.env.DEV_WORKER_URL || "http://localhost:8788").replace(/\/+$/, "");
const HEIGHT_BY_WIDTH: Record<number, number> = { 375: 812, 768: 1024, 820: 1180, 1024: 768, 1280: 900, 1440: 900 };

type OptionSpec = { type: "string" | "boolean"; reject?: (value: string) => string | null };

const text: OptionSpec = { type: "string" };
const flag: OptionSpec = { type: "boolean" };
const oneOf = (...allowed: string[]): OptionSpec => ({ type: "string", reject: (value) => (allowed.includes(value) ? null : `要 ${allowed.join("|")}`) });
const number = (min: number, max: number, integer = false): OptionSpec => ({
  type: "string",
  reject: (value) => {
    const n = Number(value);
    if (!/^-?\d+(\.\d+)?$/.test(value) || (integer && !Number.isInteger(n)) || n < min || n > max) return `要 ${min}～${max} 的${integer ? "整数" : "数字"}`;
    return null;
  },
});
const url: OptionSpec = {
  type: "string",
  reject: (value) => {
    try {
      return /^https?:$/.test(new URL(value).protocol) ? null : "只收 http(s) 地址";
    } catch {
      return "要完整的 http(s) 地址";
    }
  },
};

const common = { url, compact: flag, chrome: text, help: flag };
const engine = oneOf("chromium", "webkit");
const size = number(200, 4000, true);
const settle = number(0, 120_000);
const watch = number(100, 120_000);

const COMMAND_OPTIONS: Record<string, Record<string, OptionSpec>> = {
  help: common,
  doctor: common,
  cards: { ...common, card: text, width: size, height: size, theme: oneOf("dark", "light"), settle, ssr: flag, engine, dpr: number(0.5, 4) },
  shot: { ...common, widths: text, card: text, viewport: flag, theme: oneOf("dark", "light", "both"), dpr: number(0.5, 4), out: text, settle, ssr: flag, engine, height: size },
  reload: { ...common, engine, width: size, height: size, theme: oneOf("dark", "light"), skew: number(-1440, 1440), latency: number(0, 60_000), watch, grace: number(0, 60_000), out: text },
  "readme-cards": { ...common, card: text, theme: oneOf("dark", "light") },
  skew: { ...common, "old-html": text, engine, width: size, height: size, watch, out: text },
  override: { ...common, endpoint: text, fixture: text, clear: flag, on: flag, off: flag, list: flag, "dry-run": flag },
};

export const COMMANDS = Object.keys(COMMAND_OPTIONS).filter((name) => name !== "help");

export function parseCommand(argv: string[]): { command: string | null; flags: Flags } {
  const [command, ...rest] = argv;
  if (command === undefined) return { command: null, flags: { url: DEFAULT_URL } };
  if (command === "--help" && rest.length === 0) return { command: null, flags: { help: true, url: DEFAULT_URL } };
  const specs = COMMAND_OPTIONS[command];
  if (!specs) fail(command.startsWith("-") ? `子命令要放在最前面：${command}` : `未知子命令：${command}`, `可用：${COMMANDS.join(" / ")}；--help 看全部选项`, 2);
  let values: Record<string, string | boolean | undefined>;
  try {
    values = utilParseArgs({ args: rest, options: specs, allowPositionals: false, strict: true }).values;
  } catch (error) {
    return fail(errorText(error), `${command} 的选项见 --help`, 2);
  }
  for (const [name, value] of Object.entries(values)) {
    const problem = typeof value === "string" ? specs[name]?.reject?.(value) : null;
    if (problem) fail(`--${name} ${problem}，收到 ${JSON.stringify(value)}`, `${command} 的选项见 --help`, 2);
  }
  return { command, flags: { ...values, url: String(values.url || DEFAULT_URL).replace(/\/+$/, "") } };
}

export function parseWidths(value: unknown): Viewport[] | null {
  const list = String(value ?? "1280,375").split(",").map((w) => Number(w.trim()));
  if (list.some((w) => !Number.isInteger(w) || w < 200 || w > 4000)) return null;
  return list.map((width) => ({ width, height: HEIGHT_BY_WIDTH[width] ?? 900 }));
}

export function print(payload: unknown, flags: Partial<Flags> = {}) {
  console.log(flags.compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
}

// fail 只抛不调 process.exit：直接 exit 会跳过 try/finally，浏览器关不掉；退出码统一在入口映射。
export class ExitError extends Error {
  code: number;
  constructor(code: number) {
    super(`exit ${code}`);
    this.code = code;
  }
}

export function fail(message: string, next?: string, code = 1): never {
  print({ ok: false, error: message, next });
  throw new ExitError(code);
}

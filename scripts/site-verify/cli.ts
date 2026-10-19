import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");

export type Flags = { [key: string]: string | boolean | undefined; url: string };
export type Box = { x: number; y: number; width: number; height: number };
export type Viewport = { width: number; height: number };

export const errorText = (error: unknown) => String((error as { message?: unknown } | null)?.message ?? error);
export const stringFlag = (value: string | boolean | undefined) => (typeof value === "string" ? value : undefined);

export const DEFAULT_URL = `http://localhost:${process.env.DEV_SITE_PORT || "3211"}`;
export const WORKER_URL = (process.env.DEV_WORKER_URL || "http://localhost:8788").replace(/\/+$/, "");
const HEIGHT_BY_WIDTH: Record<number, number> = { 375: 812, 768: 1024, 820: 1180, 1024: 768, 1280: 900, 1440: 900 };

export function parseArgs(argv: string[]): { flags: Record<string, string | true>; positional: string[] } {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !(argv[i + 1] ?? "").startsWith("--")) {
      flags[arg.slice(2)] = argv[i + 1] ?? "";
      i += 1;
    } else {
      flags[arg.slice(2)] = true;
    }
  }
  return { flags, positional };
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

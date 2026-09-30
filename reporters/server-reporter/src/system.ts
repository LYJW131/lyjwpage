import { readFileSync, statfsSync } from "node:fs";
import { hostname as osHostname, networkInterfaces, release, type as osType } from "node:os";

import { config } from "./config.js";

const root = config.hostRoot;

export type CpuTimes = [number, number];

export function readOs(): string {
  try {
    for (const line of readFileSync(`${root}/etc/os-release`, "utf8").split("\n")) {
      if (line.startsWith("PRETTY_NAME=")) return line.slice(12).trim().replace(/^"|"$/g, "") || osType();
    }
  } catch {
  }
  return osType();
}

export function kernel(): string {
  return release();
}

// /proc/stat 的 guest 已计入 user，再加会重复计数。
export function cpuTimes(): CpuTimes {
  const first = readFileSync("/proc/stat", "utf8").split("\n", 1)[0] ?? "";
  const nums = first.trim().split(/\s+/).slice(1, 9).map(Number);
  const idle = (nums[3] ?? 0) + (nums[4] ?? 0);
  return [idle, nums.reduce((sum, n) => sum + n, 0)];
}

export function cpuPercent(prev: CpuTimes, cur: CpuTimes): number {
  const idle = cur[0] - prev[0];
  const total = cur[1] - prev[1];
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - idle / total) * 100));
}

export function memBytes(): { total: number; used: number; available: number } {
  const info = new Map<string, number>();
  for (const line of readFileSync("/proc/meminfo", "utf8").split("\n")) {
    const [key, value] = line.split(/\s+/);
    if (key && value) info.set(key.replace(/:$/, ""), Number(value) * 1024);
  }
  const total = info.get("MemTotal") ?? 0;
  const available = info.get("MemAvailable") ?? 0;
  return { total, used: total - available, available };
}

export function hostName(): string {
  if (root) {
    try {
      const name = readFileSync(`${root}/etc/hostname`, "utf8").split("\n", 1)[0]?.trim();
      if (name) return name;
    } catch {
    }
  }
  return osHostname();
}

// 容器中的 / 是 overlay；必须量宿主机挂载目录所在的文件系统。
export function diskBytes(): { total: number; used: number } {
  const stat = statfsSync(root ? `${root}/etc` : "/");
  const total = stat.bsize * stat.blocks;
  return { total, used: total - stat.bsize * stat.bfree };
}

export function loadavg(): [number, number, number] {
  const parts = readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/).map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function uptimeSeconds(): number {
  return Number(readFileSync("/proc/uptime", "utf8").trim().split(/\s+/)[0]);
}

export function defaultIface(): string {
  for (const line of readFileSync("/proc/net/route", "utf8").split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length >= 2 && fields[1] === "00000000" && fields[0]) return fields[0];
  }
  throw new Error("找不到默认路由网卡");
}

export function ifaceIpv4(iface: string): string {
  const address = networkInterfaces()[iface]?.find((entry) => entry.family === "IPv4" && !entry.internal)?.address;
  if (!address) throw new Error(`网卡 ${iface} 上没有 IPv4`);
  return address;
}

export function netBytes(iface: string): [number, number] {
  for (const line of readFileSync("/proc/net/dev", "utf8").split("\n")) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith(`${iface}:`)) continue;
    const parts = trimmed.replace(":", " ").split(/\s+/);
    return [Number(parts[1]), Number(parts[9])];
  }
  throw new Error(`网卡 ${iface} 不在 /proc/net/dev 里`);
}

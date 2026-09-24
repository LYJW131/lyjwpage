/**
 * 读这台机器的 /proc。
 *
 * 跑在容器里时 /proc 拿到的本来就是宿主机的数（Docker 不虚拟化 /proc），CPU、内存、
 * 负载、运行时间、内核都不用管；网卡那几项靠 `network_mode: host` 落在宿主机的网络
 * 命名空间里。剩下三样容器内会看到自己那份 —— 系统名、主机名、根分区容量 ——
 * 由 `HOST_ROOT` 指向宿主机挂进来的那份目录来纠正，见 README。
 */
import { readFileSync, statfsSync } from "node:fs";
import { hostname as osHostname, networkInterfaces, release, type as osType } from "node:os";

import { config } from "./config.js";

const root = config.hostRoot;

/** 两次 /proc/stat 读数：[idle + iowait, 总 jiffies] */
export type CpuTimes = [number, number];

export function readOs(): string {
  try {
    for (const line of readFileSync(`${root}/etc/os-release`, "utf8").split("\n")) {
      if (line.startsWith("PRETTY_NAME=")) return line.slice(12).trim().replace(/^"|"$/g, "") || osType();
    }
  } catch {
    // 读不到就退回内核名
  }
  return osType();
}

export function kernel(): string {
  return release();
}

/** guest 已经含在 user 里，不算进总和 */
export function cpuTimes(): CpuTimes {
  const first = readFileSync("/proc/stat", "utf8").split("\n", 1)[0] ?? "";
  const nums = first.trim().split(/\s+/).slice(1, 9).map(Number);
  const idle = (nums[3] ?? 0) + (nums[4] ?? 0);
  return [idle, nums.reduce((sum, n) => sum + n, 0)];
}

/** 两次读数之间的平均占用，0–100。纯函数 */
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

/** 容器里 gethostname() 是容器 ID，读宿主机挂进来的 /etc/hostname 才是真名 */
export function hostName(): string {
  if (root) {
    try {
      const name = readFileSync(`${root}/etc/hostname`, "utf8").split("\n", 1)[0]?.trim();
      if (name) return name;
    } catch {
      // 退回 gethostname
    }
  }
  return osHostname();
}

/** 根分区容量。容器里量 "/" 量到的是 overlay，改量宿主机 /etc 所在的那块盘 */
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

/** 默认路由那块网卡 */
export function defaultIface(): string {
  for (const line of readFileSync("/proc/net/route", "utf8").split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length >= 2 && fields[1] === "00000000" && fields[0]) return fields[0];
  }
  throw new Error("找不到默认路由网卡");
}

/** 默认网卡上的 IPv4。这台落地节点的公网地址就配在这块卡上 */
export function ifaceIpv4(iface: string): string {
  const address = networkInterfaces()[iface]?.find((entry) => entry.family === "IPv4" && !entry.internal)?.address;
  if (!address) throw new Error(`网卡 ${iface} 上没有 IPv4`);
  return address;
}

/** 开机以来的收发字节 */
export function netBytes(iface: string): [number, number] {
  for (const line of readFileSync("/proc/net/dev", "utf8").split("\n")) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith(`${iface}:`)) continue;
    // 「iface: rx_bytes … tx_bytes」切开后下标 1 和 9
    const parts = trimmed.replace(":", " ").split(/\s+/);
    return [Number(parts[1]), Number(parts[9])];
  }
  throw new Error(`网卡 ${iface} 不在 /proc/net/dev 里`);
}

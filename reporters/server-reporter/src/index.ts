import { cpus } from "node:os";

import { config } from "./config.js";
import { geoFor } from "./geo.js";
import { failure, info, recovered } from "./log.js";
import { push, reporterBlock } from "./site.js";
import {
  cpuPercent, cpuTimes, defaultIface, diskBytes, hostName, ifaceIpv4, kernel, loadavg, memBytes, netBytes,
  readOs, uptimeSeconds, type CpuTimes,
} from "./system.js";
import { trafficAndWindow } from "./traffic.js";

/**
 * 这台机器的 CPU / 内存 / 磁盘 / 网速 → lyjwpage `/api/ingest/server`。
 *
 * 采集窗口就是上报间隔本身：上一轮 /proc 的读数留着，这一轮做差，得到的是这段时间的
 * 平均占用和平均速率，不是「这一瞬间的尖峰」。同一份差值还累加成计费周期的流量、
 * 攒成 12 小时的 CPU 窗口（见 traffic.ts）。固定每分钟推一次，这份快照本身就是心跳。
 *
 * 2026-09 前是 Python 标准库写的，为了和 agents-reporter 同一套结构改写成 TypeScript；
 * 报文字段和状态文件格式都没变。
 */

type Cursor = { cpu: CpuTimes; net: [number, number]; at: number };

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

async function snapshot(iface: string, prev: Cursor): Promise<{ payload: Record<string, unknown>; cursor: Cursor }> {
  const now = Date.now();
  const cpu = cpuTimes();
  const net = netBytes(iface);
  const elapsedMs = Math.max(now - prev.at, 1);
  const [rx, tx] = net;
  const uptime = uptimeSeconds();
  const memory = memBytes();
  const disk = diskBytes();
  const [load1, load5, load15] = loadavg();
  const publicIp = ifaceIpv4(iface);
  const geo = await geoFor(publicIp);
  const cpuPct = cpuPercent(prev.cpu, cpu);
  const { traffic, window } = await trafficAndWindow(iface, rx, tx, now, Math.round(now - uptime * 1000), cpuPct, elapsedMs);
  const payload = {
    version: 1,
    id: config.hostId,
    hostname: hostName(),
    publicIp,
    country: geo.country,
    city: geo.city || config.location || null,
    isp: geo.isp,
    asn: geo.asn,
    asnOrg: geo.asnOrg,
    os: readOs(),
    kernel: kernel(),
    cpuCores: cpus().length || 1,
    cpuUsagePercent: Math.round(cpuPct * 10) / 10,
    load1: round2(load1),
    load5: round2(load5),
    load15: round2(load15),
    memoryTotalBytes: memory.total,
    memoryUsedBytes: memory.used,
    memoryAvailableBytes: memory.available,
    diskTotalBytes: disk.total,
    diskUsedBytes: disk.used,
    networkInterface: iface,
    networkRxBytes: rx,
    networkTxBytes: tx,
    networkRxBytesPerSec: Math.max(0, ((rx - prev.net[0]) / elapsedMs) * 1000),
    networkTxBytesPerSec: Math.max(0, ((tx - prev.net[1]) / elapsedMs) * 1000),
    traffic,
    window,
    uptimeSeconds: Math.round(uptime),
    observedAt: now,
  };
  return { payload, cursor: { cpu, net, at: now } };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main() {
  info(`server-reporter 启动：${config.hostId} (${config.location}) → ${config.site.ingestUrl || "（没配 SITE_URL）"}`);
  if (!config.site.secret && !config.dryRun) info("没配 TELEMETRY_INGEST_SECRET —— 只有站点也没配时才可以这样");
  if (!config.dryRun && !config.site.ingestUrl) throw new Error("缺少环境变量 SITE_URL 或 SITE_INGEST_URL");

  const iface = defaultIface();
  const { intervalMs } = config;
  info(`网卡 ${iface}，每 ${intervalMs / 1000}s 推一次`);
  info(
    config.trafficStatePath
      ? `流量每月 ${config.cycleDay} 号归零，状态存 ${config.trafficStatePath}` +
          (config.quotaBytes ? `，配额 ${config.quotaBytes} 字节` : "，没配配额")
      : "TRAFFIC_STATE_PATH 留空，不攒流量，这张卡上不显示那一栏",
  );

  let cursor: Cursor = { cpu: cpuTimes(), net: netBytes(iface), at: Date.now() };
  // 先采 1 秒做出第一份，卡片不必干等到一个完整间隔
  await sleep(1_000);

  let backoff = intervalMs;
  for (;;) {
    try {
      const round = await snapshot(iface, cursor);
      if (config.dryRun) {
        process.stdout.write(`${JSON.stringify({ ...round.payload, reporter: await reporterBlock() }, null, 2)}\n`);
        return;
      }
      await push(round.payload);
      recovered("push");
      cursor = round.cursor;
      backoff = intervalMs;
      // 按轮的起点对齐：采集和推送花掉的时间从这一分钟里扣，不往后攒
      await sleep(Math.max(0, intervalMs - (Date.now() - round.cursor.at)));
    } catch (error) {
      if (config.dryRun) throw error;
      // 这一轮作废，进程不退：按退避表等，连错一次翻倍、5 分钟封顶
      failure("push", error);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 5 * 60_000);
    }
  }
}

// 容器里是 PID 1，Node 不给 PID 1 装默认的信号处理，不接的话 docker stop 要干等 10 秒
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    info(`收到 ${signal}，退出`);
    process.exit(0);
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

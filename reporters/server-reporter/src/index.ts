import { cpus } from "node:os";

import { config } from "./config.js";
import { geoFor } from "./geo.js";
import { failure, info, recovered } from "./log.js";
import { push, reporterBlock } from "./site.js";
import {
  cpuPercent, cpuTimes, defaultIface, diskBytes, hostName, ifaceIpv4, kernel, loadavg, memBytes, netBytes,
  readOs, uptimeSeconds, type CpuTimes,
} from "./system.js";
import { traffic as trafficReport } from "./traffic.js";


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
  const traffic = await trafficReport(iface, rx, tx, now, Math.round(now - uptime * 1000));
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
  info(`server-reporter 启动：${config.hostId} (${config.location}) → ${config.site.ingestUrl || "（没配 SITE_INGEST_URL）"}`);
  if (!config.dryRun && !config.site.ingestUrl) throw new Error("缺少环境变量 SITE_INGEST_URL");
  if (!config.dryRun && !(config.site.accessClientId && config.site.accessClientSecret)) {
    throw new Error("缺少环境变量 ACCESS_CLIENT_ID / ACCESS_CLIENT_SECRET");
  }

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
      await sleep(Math.max(0, intervalMs - (Date.now() - round.cursor.at)));
    } catch (error) {
      if (config.dryRun) throw error;
      failure("push", error);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 5 * 60_000);
    }
  }
}

// 容器 PID 1 不能依赖默认信号行为；显式处理退出，避免 docker stop 等到强杀。
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

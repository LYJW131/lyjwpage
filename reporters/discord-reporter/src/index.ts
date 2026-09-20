import { Client, Events, GatewayIntentBits } from "discord.js";

import { applicationCoverUrl } from "./application-cover.js";
import { config } from "./config.js";
import { resolveGameApplicationId } from "./game-id.js";
import { failure, info, recovered } from "./log.js";
import {
  describeActivities,
  reportFrom,
  type PresenceReport,
  type RawPresence,
} from "./presence.js";
import { push } from "./site.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildPresences],
});

type GatewayPacket = {
  t?: string | null;
  d?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function userIdOf(presence: Record<string, unknown>): string | null {
  const user = asRecord(presence.user);
  const id = user?.id;
  return typeof id === "string" ? id : null;
}

let lastPresence: RawPresence | undefined;
let dumpedInitial = false;
let pushedContent = "";
let pushedAt = 0;
let pushing = false;
let pending: { report: PresenceReport; reason: string } | null = null;

function fingerprint(report: PresenceReport): string {
  return JSON.stringify({ discordStatus: report.discordStatus, playing: report.playing });
}

async function withGameProfile(report: PresenceReport): Promise<PresenceReport> {
  const playing = report.playing;
  if (!playing) return report;
  const gameId = await resolveGameApplicationId({
    name: playing.name,
    applicationId: playing.applicationId,
    parentApplicationId: playing.parentApplicationId,
  });
  if (gameId !== playing.applicationId) {
    info(`游戏 id ${playing.applicationId ?? "无"} → ${gameId ?? "无"}（${playing.name}）`);
  }
  let largeImageUrl = playing.largeImageUrl;
  if (!largeImageUrl && gameId) {
    largeImageUrl = (await applicationCoverUrl(gameId)) ?? largeImageUrl;
  }
  return {
    ...report,
    playing: { ...playing, applicationId: gameId, largeImageUrl },
  };
}

async function deliver(report: PresenceReport, reason: string) {
  pending = { report, reason };
  if (pushing) return;
  pushing = true;
  try {
    while (pending) {
      const next = pending;
      pending = null;
      try {
        const decorated = await withGameProfile(next.report);
        // A newer Gateway event arrived while resolving the cover.
        if (pending) continue;
        const content = fingerprint(decorated);
        if (next.reason !== "heartbeat" && content === pushedContent && Date.now() - pushedAt < config.heartbeatIntervalMs) continue;
        const result = await push(decorated);
        pushedContent = content;
        pushedAt = Date.now();
        recovered("push");
        if (result.changed) info(`推送（${next.reason}）：${decorated.playing?.name ?? "没在玩"}`);
      } catch (error) {
        failure("push", error);
      }
    }
  } finally {
    pushing = false;
  }
}

function ingest(presence: RawPresence, reason: string) {
  lastPresence = presence;
  if (!dumpedInitial) {
    dumpedInitial = true;
    const status = typeof presence.status === "string" ? presence.status : "?";
    info(`初始 presence：${status} [${describeActivities(presence)}]`);
  }
  void deliver(reportFrom(presence), reason);
}

function ingestIfMine(value: unknown, reason: string) {
  const presence = asRecord(value);
  if (!presence) return;
  if (userIdOf(presence) !== config.discord.userId) return;
  ingest(presence, reason);
}

client.on(Events.Raw, (packet: GatewayPacket) => {
  if (packet.t === "PRESENCE_UPDATE") {
    ingestIfMine(packet.d, "presenceUpdate");
    return;
  }
  if (packet.t !== "GUILD_CREATE") return;
  const guild = asRecord(packet.d);
  const presences = guild?.presences;
  if (!Array.isArray(presences)) return;
  for (const presence of presences) ingestIfMine(presence, "guildCreate");
});

client.on(Events.ClientReady, (ready) => {
  recovered("gateway");
  info(`已登录 ${ready.user.tag}，盯 ${config.discord.userId}`);
  if (lastPresence) void deliver(reportFrom(lastPresence), "ready");
});

client.on(Events.Error, (error) => failure("gateway", error));
client.on(Events.ShardDisconnect, () => failure("gateway", new Error("shard disconnect")));

setInterval(() => {
  if (!client.isReady()) return;
  if (!lastPresence) {
    info("Gateway 已连接，尚未观察到目标用户的 presence");
    return;
  }
  void deliver(reportFrom(lastPresence), "heartbeat");
}, config.heartbeatIntervalMs).unref();

process.on("unhandledRejection", (error) => failure("unhandled", error));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    info(`收到 ${signal}，退出`);
    void client.destroy();
    process.exit(0);
  });
}

info(`discord-reporter 启动：Gateway → ${config.dryRun ? "dry-run（不写生产）" : config.site.ingestUrl}`);

void client.login(config.discord.token).catch((error) => {
  failure("login", error);
  process.exit(1);
});

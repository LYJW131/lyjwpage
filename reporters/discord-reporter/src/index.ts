import { Client, Events, GatewayIntentBits } from "discord.js";

import { config } from "./config.js";
import { GatewayState, type GatewayPacket } from "./gateway-state.js";
import { VerifiedHeartbeat } from "./heartbeat.js";
import { createMembershipCheck } from "./membership.js";
import { failure, info, recovered } from "./log.js";
import { ReportQueue } from "./report-queue.js";
import { createSitePush } from "./site.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildPresences],
  shards: [0],
  shardCount: 1,
});
const queue = new ReportQueue(
  createSitePush({ ...config.site, dryRun: config.dryRun, pushTimeoutMs: config.pushTimeoutMs }),
  (result, { presence, reason }) => {
    recovered("push");
    if (result.changed || config.dryRun) info(`推送（${reason}）：${presence.playing?.name ?? "没在玩"}`);
  },
  (error) => failure("push", error),
);

const state = new GatewayState(config.discord.userId, () => queue.clear());

function disconnect(): void {
  state.disconnect();
}

function ready(): void {
  recovered("gateway");
  const snapshot = state.markReady();
  if (snapshot) void queue.enqueue(snapshot, "ready");
}

client.on(Events.Raw, (packet: GatewayPacket) => {
  if (packet.t === "READY") {
    disconnect();
    return;
  }
  const snapshot = state.accept(packet);
  if (snapshot) void queue.enqueue(snapshot, packet.t ?? "presence");
});
client.on(Events.ClientReady, (readyClient) => {
  info(`已登录 ${readyClient.user.tag}，盯 ${config.discord.userId}`);
  ready();
});
client.on(Events.ShardReady, ready);
client.on(Events.ShardResume, ready);
client.on(Events.ShardDisconnect, () => {
  disconnect();
  failure("gateway", new Error("shard disconnect"));
});
client.on(Events.ShardReconnecting, disconnect);
client.on(Events.Invalidated, disconnect);
client.on(Events.Error, (error) => failure("gateway", error));
client.on(Events.ShardError, (error) => failure("gateway", error));

const verifiedHeartbeat = new VerifiedHeartbeat(
  state,
  createMembershipCheck({ token: config.discord.token, targetUserId: config.discord.userId, timeoutMs: config.pushTimeoutMs }),
  (snapshot) => { void queue.enqueue(snapshot, "heartbeat"); },
);
const heartbeat = setInterval(() => {
  if (client.isReady()) void verifiedHeartbeat.tick();
}, config.heartbeatIntervalMs);
heartbeat.unref();

process.on("unhandledRejection", (error) => failure("unhandled", error));
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    info(`收到 ${signal}，退出`);
    clearInterval(heartbeat);
    disconnect();
    void client.destroy();
    process.exit(0);
  });
}

info(`discord-reporter 启动：Gateway → ${config.dryRun ? "dry-run" : config.site.ingestUrl}`);
void client.login(config.discord.token).catch((error) => {
  failure("login", error);
  process.exit(1);
});

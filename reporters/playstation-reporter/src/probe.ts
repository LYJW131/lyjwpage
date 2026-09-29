import { createSocket, type Socket } from "node:dgram";

import type { ConsolePower } from "./cadence.js";

const DISCOVERY_PORT = 9302;
const PACKET = Buffer.from("SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00030010\n");

/** 发现回复的状态行：200 醒着，620 休息，其余当没醒。 */
export function parseDiscoveryResponse(packet: Buffer): ConsolePower {
  const line = packet.toString("utf8").split(/\r?\n/, 1)[0] ?? "";
  const code = Number(/^HTTP\/1\.[01] (\d+)/.exec(line)?.[1]);
  if (code === 200) return "awake";
  if (code === 620) return "standby";
  return "off";
}

function closeQuietly(socket: Socket): void {
  try {
    socket.close();
  } catch {
    // 已经关掉的套接字再关一次会抛，探测结果已经定了。
  }
}

/** 向一台 PS5 发一次发现包。超时或发不出去都是 `off`。 */
export function probeOnce(host: string, timeoutMs: number): Promise<ConsolePower> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    let settled = false;
    const finish = (power: ConsolePower) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      closeQuietly(socket);
      resolve(power);
    };
    const timer = setTimeout(() => finish("off"), timeoutMs);
    socket.once("error", () => finish("off"));
    socket.once("message", (message) => finish(parseDiscoveryResponse(message)));
    socket.bind(0, () => {
      socket.send(PACKET, DISCOVERY_PORT, host, (error) => {
        if (error) finish("off");
      });
    });
  });
}

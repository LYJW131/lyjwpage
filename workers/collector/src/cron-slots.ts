import { DurableObject } from "cloudflare:workers";

import type { Env } from "./env";
import { claimSlots } from "./schedule";

export const CRON_SLOTS_NAME = "global";

export class CronSlots extends DurableObject<Env> {
  // get 与 put 之间不能插别的 I/O：靠输入闸门保证两轮同时到时只有一轮认领到。
  async claim(slots: Record<string, number>): Promise<string[]> {
    const claimed = claimSlots(await this.ctx.storage.get<number>(Object.keys(slots)), slots);
    if (claimed.length) await this.ctx.storage.put(Object.fromEntries(claimed.map((name) => [name, slots[name]])));
    return claimed;
  }
}

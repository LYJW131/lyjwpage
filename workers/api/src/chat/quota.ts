import { DurableObject } from "cloudflare:workers";

import {
  GOD_CHAT_QUOTA,
  GOD_CHAT_TIERS,
  downgradeChain,
  type GodChatTier,
  type GodChatUsage,
} from "@shared/god-chat-tiers";

import type { Env } from "../runtime";

const visitorKey = (ip: string) => `v:${ip}`;
const tierVisitorKey = (tier: GodChatTier, ip: string) => `t:${tier}:${ip}`;
const tierAllKey = (tier: GodChatTier) => `a:${tier}`;

// 全站一个实例，所有对话的计数在这里串行：每次调用先清掉窗口外的命中，再数再记，读和扣在同一个同步事务里。
export class ChatQuota extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS hits (key TEXT NOT NULL, at INTEGER NOT NULL)");
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS hits_key_at ON hits (key, at)");
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS hits_at ON hits (at)");
  }

  private prune(now: number): void {
    this.ctx.storage.sql.exec("DELETE FROM hits WHERE at <= ?", now - GOD_CHAT_QUOTA.windowMs);
  }

  private count(key: string): number {
    return Number(this.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM hits WHERE key = ?", key).one().n);
  }

  private hit(key: string, now: number): void {
    this.ctx.storage.sql.exec("INSERT INTO hits (key, at) VALUES (?, ?)", key, now);
  }

  // 两步分开调：访客总量在 Clef 之前扣，超额的访客不再触发路由；档位等 Clef 选完再扣。enforce 为 false 时只记账不拦（本地调试开关）。
  admitVisitor(ip: string, enforce = true): boolean {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      this.prune(now);
      if (enforce && this.count(visitorKey(ip)) >= GOD_CHAT_QUOTA.visitor) return false;
      this.hit(visitorKey(ip), now);
      return true;
    });
  }

  // 返回实际作答的档位；从 wanted 往下逐档都满时返回 null。
  admitTier(ip: string, wanted: GodChatTier, enforce = true): GodChatTier | null {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      this.prune(now);
      for (const tier of downgradeChain(wanted)) {
        const limits = GOD_CHAT_QUOTA.tiers[tier];
        const free =
          !enforce ||
          (this.count(tierAllKey(tier)) < limits.everyone && this.count(tierVisitorKey(tier, ip)) < limits.visitor);
        if (!free) continue;
        this.hit(tierAllKey(tier), now);
        this.hit(tierVisitorKey(tier, ip), now);
        return tier;
      }
      return null;
    });
  }

  private oldest(where: string, ...bindings: string[]): number | null {
    return this.ctx.storage.sql.exec(`SELECT MIN(at) AS at FROM hits WHERE ${where}`, ...bindings).one().at as number | null;
  }

  // 倒计时到下一次「这位访客看到的数会变」：自己最早的一条命中过期，或某档全站已满时它最早的一条过期。
  // 全站没满的档不算进来，否则站上一忙，面板就几乎每秒重取一次。
  usage(ip: string): GodChatUsage {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      this.prune(now);
      const expiries = [
        this.oldest("key = ? OR key LIKE ?", visitorKey(ip), `t:%:${ip}`),
        ...GOD_CHAT_TIERS.filter((tier) => this.count(tierAllKey(tier)) >= GOD_CHAT_QUOTA.tiers[tier].everyone).map((tier) =>
          this.oldest("key = ?", tierAllKey(tier)),
        ),
      ].filter((at): at is number => at != null);
      const oldest = expiries.length ? Math.min(...expiries) : null;
      const tiers = Object.fromEntries(
        GOD_CHAT_TIERS.map((tier) => [
          tier,
          {
            visitor: { used: this.count(tierVisitorKey(tier, ip)), limit: GOD_CHAT_QUOTA.tiers[tier].visitor },
            everyone: { used: this.count(tierAllKey(tier)), limit: GOD_CHAT_QUOTA.tiers[tier].everyone },
          },
        ]),
      ) as GodChatUsage["tiers"];
      return {
        windowMs: GOD_CHAT_QUOTA.windowMs,
        resetInMs: oldest == null ? 0 : Math.max(0, oldest + GOD_CHAT_QUOTA.windowMs - now),
        visitor: { used: this.count(visitorKey(ip)), limit: GOD_CHAT_QUOTA.visitor },
        tiers,
      };
    });
  }
}

import type * as SentryCloudflare from "@sentry/cloudflare";

type CheckInSdk = Pick<typeof SentryCloudflare, "captureCheckIn" | "flush">;
type CheckInConfig = NonNullable<Parameters<typeof SentryCloudflare.captureCheckIn>[1]>;

const CHECK_IN_FLUSH_MS = 2_000;

// 不用 Sentry.withMonitor：它另开隔离作用域，丢了 @sentry/cloudflare 记在这次调用上的 waitUntil，
// 结束签到成了没人等的发送，调用一返回就被运行时掐掉，监控只剩 in_progress 直到超时。
// 每次签到当场 flush，开始签到也必定先于结束签到送达。
export function cronCheckIns(sdk: CheckInSdk) {
  return async <T>(monitorSlug: string, run: () => Promise<T>, config: CheckInConfig): Promise<T> => {
    const checkInId = sdk.captureCheckIn({ monitorSlug, status: "in_progress" }, config);
    await sdk.flush(CHECK_IN_FLUSH_MS);
    const startedAt = Date.now();
    const finish = async (status: "ok" | "error") => {
      sdk.captureCheckIn({ monitorSlug, status, checkInId, duration: (Date.now() - startedAt) / 1000 });
      await sdk.flush(CHECK_IN_FLUSH_MS);
    };
    try {
      const value = await run();
      await finish("ok");
      return value;
    } catch (error) {
      await finish("error");
      throw error;
    }
  };
}

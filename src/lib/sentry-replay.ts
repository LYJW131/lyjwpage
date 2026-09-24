import { addIntegration, replayIntegration } from "@sentry/nextjs";

/**
 * Session Replay 单独成块、页面空闲后再装，首屏不背它。
 *
 * 只在出错时留录像（init 里 replaysSessionSampleRate 0、replaysOnErrorSampleRate 1，
 * 免费档一个月 50 段）。页面上都是公开的状态数据，文字和封面不遮，录像才看得出
 * 出错时卡片是什么样；输入框照常遮。
 */
export function attachReplay(): void {
  addIntegration(
    replayIntegration({
      maskAllText: false,
      maskAllInputs: true,
      blockAllMedia: false,
    }),
  );
}

// 同一处不一致会在每次访问重复出现，抽样上报够看趋势。
export const RECOVERABLE_ERROR_SAMPLE_RATE = 0.1;

// Sentry 项目的入站过滤 react-hydration-errors 按异常文本匹配 React 原文和错误码链接，
// 原样上报会被整条丢掉；所以换成自己的文本，错误码放进 tag，原文（开发版里带 DOM 文本）不上报。
export const RECOVERABLE_ERROR_MESSAGE = "React re-rendered a subtree on the client after a recoverable render error";

export type RecoverableErrorReport = {
  error: Error;
  context: {
    tags: Record<string, string>;
    contexts: { react: { componentStack: string | null } };
    fingerprint: string[];
  };
};

function reactErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /react\.dev\/errors\/(\d+)/.exec(message)?.[1] ?? /React error #(\d+)/.exec(message)?.[1] ?? "unknown";
}

export function recoverableErrorReport(error: unknown, componentStack: string | undefined): RecoverableErrorReport {
  const report = new Error(RECOVERABLE_ERROR_MESSAGE);
  report.name = "RecoverableRenderError";
  const code = reactErrorCode(error);
  return {
    error: report,
    context: {
      tags: { hydration: "recoverable", reactError: code },
      contexts: { react: { componentStack: componentStack ?? null } },
      fingerprint: ["recoverable-render-error", code],
    },
  };
}

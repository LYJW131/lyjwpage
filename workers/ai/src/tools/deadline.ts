// readStatus 不接收取消信号。挂住的公开状态或文档读取到点就失败，不能占住整条回复。
export const TOOL_READ_TIMEOUT_MS = 8_000;

export function withTimeout<T>(work: Promise<T>, ms = TOOL_READ_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DOMException("The operation timed out.", "TimeoutError")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

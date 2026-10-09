export class EventRpcError extends Error {
  readonly code: number;
  readonly data?: Record<string, unknown>;

  constructor(code: number, message: string, data?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export type EventRpcReply =
  | { result: Record<string, unknown> }
  | { error: { code: number; message: string; data?: Record<string, unknown> } };

import { RpcTarget } from "cloudflare:workers";

import { sandboxModule } from "./code-mode";
import type { CodeRun, ToolIO } from "./registry";

class StatusRpc extends RpcTarget {
  readonly #read: (view: unknown) => Promise<unknown>;

  constructor(read: (view: unknown) => Promise<unknown>) {
    super();
    this.#read = read;
  }

  read(view: unknown) {
    return this.#read(view);
  }
}

// 没有网络（globalOutbound 为 null）、没有任何绑定，唯一的出口是 env.STATUS，它只能读白名单视图。
export function sandboxRunner(loader: WorkerLoader): NonNullable<ToolIO["runCode"]> {
  return async (code, read) => {
    const worker = loader.load({
      compatibilityDate: "2026-10-09",
      mainModule: "main.js",
      modules: { "main.js": sandboxModule(code) },
      env: { STATUS: new StatusRpc(read) },
      globalOutbound: null,
      limits: { cpuMs: 1_000, subRequests: 0 },
    });
    const response = await worker.getEntrypoint().fetch("http://sandbox/");
    return (await response.json()) as CodeRun;
  };
}

import { RpcTarget } from "cloudflare:workers";

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

// 结果先在沙箱里 JSON 序列化再带回：模型返回的值不一定能走 RPC 结构化克隆（函数、类实例），JSON 语义也和工具输出一致。
export function sandboxModule(code: string): string {
  return [
    'import { WorkerEntrypoint } from "cloudflare:workers";',
    "export default class extends WorkerEntrypoint {",
    "  async run(bridge) {",
    "    try {",
    "      const status = (view) => bridge.read(view);",
    "      const result = await (async () => {",
    code,
    "      })();",
    "      return JSON.stringify({ ok: true, result: result === undefined ? null : result });",
    "    } catch (error) {",
    "      return JSON.stringify({ ok: false, error: String(error && error.message || error) });",
    "    }",
    "  }",
    "}",
  ].join("\n");
}

// 没有网络（globalOutbound 为 null）、没有任何绑定。唯一的出口是作为 RPC 参数传进去的 StatusRpc，它只能读白名单视图；
// load() 的 env 只收可结构化克隆的值与 Service Binding，放 RpcTarget 进去会在加载时报错。
export function sandboxRunner(loader: WorkerLoader): NonNullable<ToolIO["runCode"]> {
  return async (code, read) => {
    const worker = loader.load({
      compatibilityDate: "2026-10-09",
      mainModule: "main.js",
      modules: { "main.js": sandboxModule(code) },
      env: {},
      globalOutbound: null,
      limits: { cpuMs: 1_000, subRequests: 0 },
    });
    const entrypoint = worker.getEntrypoint() as unknown as { run(bridge: StatusRpc): Promise<string> };
    return JSON.parse(await entrypoint.run(new StatusRpc(read))) as CodeRun;
  };
}

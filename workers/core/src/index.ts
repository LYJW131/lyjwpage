import originWorker, { LivePushRoom as LivePushRoomBase, StateHub as StateHubBase } from "./origin-worker";
import type { Env } from "./runtime";
import { DevOverrideReader as DevOverrideReaderBase } from "./dev-override-reader";
import { StateCore as StateCoreBase } from "./state-core";
import { PublicStatus as PublicStatusBase } from "./public-status";
import { installApiPorts } from "./ports";

installApiPorts();

// Wrangler 迁移按导出名识别 DO，这些导出名不能改。
export const LivePushRoom = LivePushRoomBase;
export const StateHub = StateHubBase;
export const StateCore = StateCoreBase;
export const PublicStatus = PublicStatusBase;
export const DevOverrideReader = DevOverrideReaderBase;
export type { Env } from "./runtime";

const coreWorker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return originWorker.fetch(request, env, ctx);
  },
};

export default coreWorker;

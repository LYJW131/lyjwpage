import { WorkerEntrypoint } from "cloudflare:workers";
import type { PrivateHistoryQuery, PrivateHistoryResult, PrivateHistoryRpc } from "@shared/private-history";

import { readPrivateHistory } from "./history-read";
import type { Env } from "./runtime";

export class PrivateHistory extends WorkerEntrypoint<Env> implements PrivateHistoryRpc {
  async readHistory(query: PrivateHistoryQuery): Promise<PrivateHistoryResult> {
    return readPrivateHistory(this.env.HISTORY, query);
  }
}

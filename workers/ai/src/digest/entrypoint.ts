import { WorkerEntrypoint } from "cloudflare:workers";

import type { DigestOutcome, DigestRequest, DigestRpc } from "@shared/digest";

import type { Env } from "../runtime";
import { clefPicker, composeDigest } from "./compose";

export class Digest extends WorkerEntrypoint<Env> implements DigestRpc {
  async compose(request: DigestRequest): Promise<DigestOutcome> {
    return composeDigest({
      readStatus: (path) => this.env.PUBLIC_STATUS.readStatus(path),
      pick: this.env.AI ? clefPicker(this.env.AI) : undefined,
      previousInputHash: typeof request?.previousInputHash === "string" ? request.previousInputHash : null,
      previousHeadline: typeof request?.previousHeadline === "string" ? request.previousHeadline : null,
      now: Date.now(),
    });
  }
}

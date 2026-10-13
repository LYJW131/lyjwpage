import Anthropic from "@anthropic-ai/sdk";
import { WorkerEntrypoint } from "cloudflare:workers";

import type { DigestOutcome, DigestRequest, DigestRpc } from "@shared/digest";

import { anthropicFetch } from "../chat/egress";
import type { Env } from "../runtime";
import { composeDigest } from "./compose";

export class Digest extends WorkerEntrypoint<Env> implements DigestRpc {
  async compose(request: DigestRequest): Promise<DigestOutcome> {
    if (!this.env.ANTHROPIC_API_KEY) return { status: "unconfigured" };
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY, fetch: anthropicFetch(this.env), maxRetries: 1, timeout: 45_000 });
    return composeDigest({
      readStatus: (path) => this.env.PUBLIC_STATUS.readStatus(path),
      createMessage: (params) => client.messages.create(params),
      previousInputHash: typeof request?.previousInputHash === "string" ? request.previousInputHash : null,
      now: Date.now(),
    });
  }
}

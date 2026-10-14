// agent 与 environment 按工作区隔离：用与 Worker 的 ANTHROPIC_API_KEY 同一工作区的 key 运行。
// 改模型、提示词或工具不用重跑这里，原因见 workers/ai/src/runtime.ts#DESIGN_AGENT_ID；改 DESIGN_WEB_HOSTS 要重跑，它会更新已有环境的放行主机。
import Anthropic from "@anthropic-ai/sdk";

import { GOD_CHAT_TIER_INFO } from "@shared/god-chat-tiers";

import { DESIGN_WEB_HOSTS } from "../src/chat/design-hosts";

const NAME = "lyjwpage-designer";
const api = new Anthropic();

const description = "Sandbox for the homepage design planner: github.com for an anonymous read-only clone, plus a few documentation sites.";
const config = { type: "cloud", networking: { type: "limited", allowed_hosts: [...DESIGN_WEB_HOSTS] } } as const;
const environments = await api.beta.environments.list();
const existing = environments.data.find((entry) => entry.name === NAME);
const environment = existing
  ? await api.beta.environments.update(existing.id, { description, config })
  : await api.beta.environments.create({ name: NAME, description, config });

const agents = await api.beta.agents.list();
const agent = agents.data.find((entry) => entry.name === NAME) ?? await api.beta.agents.create({
  name: NAME,
  description: "Shell for the homepage design planner; the Worker supplies the system prompt and tools per session.",
  model: GOD_CHAT_TIER_INFO.opus.model,
});

console.log(`DESIGN_AGENT_ID=${agent.id}\nDESIGN_ENVIRONMENT_ID=${environment.id}`);

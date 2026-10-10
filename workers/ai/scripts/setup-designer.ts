// agent 与 environment 按工作区隔离：用与 Worker 的 ANTHROPIC_API_KEY 同一工作区的 key 运行。
// agent 只是壳，模型、提示词和工具由 Worker 每个会话从代码覆盖，改提示词不用重跑这里。
import Anthropic from "@anthropic-ai/sdk";

import { GOD_CHAT_TIER_INFO } from "@shared/god-chat-tiers";

const NAME = "lyjwpage-designer";
const api = new Anthropic();

const environments = await api.beta.environments.list();
const environment = environments.data.find((entry) => entry.name === NAME) ?? await api.beta.environments.create({
  name: NAME,
  description: "Sandbox for the homepage design planner: only github.com is reachable, for an anonymous read-only clone.",
  config: { type: "cloud", networking: { type: "limited", allowed_hosts: ["github.com"] } },
});

const agents = await api.beta.agents.list();
const agent = agents.data.find((entry) => entry.name === NAME) ?? await api.beta.agents.create({
  name: NAME,
  description: "Shell for the homepage design planner; the Worker supplies the system prompt and tools per session.",
  model: GOD_CHAT_TIER_INFO.opus.model,
});

console.log(`DESIGN_AGENT_ID=${agent.id}\nDESIGN_ENVIRONMENT_ID=${environment.id}`);

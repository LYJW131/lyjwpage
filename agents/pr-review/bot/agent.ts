import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  model: {
    id: "grok-4.7",
    params: [
      { id: "effort", value: "xhigh" },
      { id: "fast", value: "true" },
    ],
  },
  tools: ["read", "grep", "glob", "ls"],
  local: {
    sandbox: true,
  },
  hosting: {
    // tarball 接口 302 到 codeload，主机要能连上才拿得到源码快照。
    egressDomains: ["codeload.github.com"],
  },
});

# WebMCP 试验

> 类型：runbook

站点页面经 [WebMCP](https://webmachinelearning.github.io/webmcp/) 把只读能力注册成浏览器里的工具，让浏览器内的 agent 在访客开着页面时直接调用，不用抓 HTML。它和公开的 [`/mcp`](../workers/ai/README.md#mcp) 互补：`/mcp` 给服务端和桌面端的 MCP 客户端，WebMCP 只在页面打开时存在。

## 现在注册了什么

- 入口：`src/components/site-webmcp.tsx#SiteWebMcp`（挂在 `src/app/root.tsx`），浏览器有 `document.modelContext` 才注册，卸载时经 `AbortSignal` 注销；没有这个 API 的浏览器什么都不做。
- 工具：`src/lib/webmcp.ts#siteTools`。目前只有 `get_site_status`：参数 `view` 取 `shared/status-views.ts#STATUS_VIEW_KEYS` 之一，读该视图的公开端点（与页面卡片同一份 JSON，经 `backendUrl`），原样返回文本，超长截断。标 `readOnlyHint` 与 `untrustedContentHint`（窗口标题、歌名等是外部文本）。
- 不做 `/mcp` 那套摘要、分页与本地时间换算：那些在 ai Worker 里，站点侧不复制。

## 调试

API 只在 Chrome 149 及以上可用。`https://lyjw.me` 已加入 origin trial（令牌在 `src/lib/webmcp.ts#WEBMCP_ORIGIN_TRIAL_TOKEN`，经 `src/app/root.tsx` 的 `origin-trial` meta 下发，到期时间是令牌里的 `expiry`），生产页面在普通 Chrome 里就有 API；分支预览与本地不在令牌的源里，仍要打开开关。

1. 打开 `chrome://flags/#enable-webmcp-testing`，设为 Enabled，重启 Chrome。要用 DevTools 的 WebMCP 面板再开 `chrome://flags/#devtools-webmcp-support`。
2. 打开 `https://lyjw.me` 或分支预览 `https://<预览名>.preview.lyjw.dev`（预览名由 `scripts/preview-worker-name.ts#previewWorkerName` 算）。
3. DevTools → Application → 左栏 WebMCP：Available tools 列出 `get_site_status` 与它的 schema；选中后填 `{"view":"nowListening"}`，点 Run tool，下方显示返回值或校验错误；Invoked tools 记录每次调用的输入、输出与状态。
4. 控制台也能直接调：

   ```js
   const [tool] = await document.modelContext.getTools();
   await document.modelContext.executeTool(tool, { view: "server" });
   ```

   Chrome 155 以前的版本只认 JSON 字符串参数，对象会报 `Failed to parse input arguments`，这时写 `executeTool(tool, JSON.stringify({ view: "server" }))`。工具抛错时 `executeTool` 只回笼统的 `UnknownError`，具体消息看控制台的 `WebMCP tool execution failed`。

5. 让 agent 调：Chrome 网上应用店的 Model Context Tool Inspector 扩展（填 Gemini API key），或 [chrome-devtools-mcp](https://developer.chrome.com/docs/devtools/agents/webmcp-debugging) 加 `--categoryExperimentalWebmcp` 后用 `list_webmcp_tools`、`execute_webmcp_tool`。
6. 本地或 Playwright 自带的 Chromium：启动参数加 `--enable-features=WebMCPTesting`，页面需是安全上下文（`https` 或 `localhost`）。

7. Lighthouse 的 Agentic Browsing 类别有三项 WebMCP 检查（已注册工具、schema 有效、表单覆盖）。PageSpeed Insights 测 `https://lyjw.me` 时有 origin trial 令牌；测分支预览时没有，三项都是「不适用」，要看结果就在本地跑，打开同一个开关：

   ```sh
   npx lighthouse@latest <页面地址> --only-categories=agentic-browsing \
     --chrome-flags="--headless=new --enable-features=WebMCPTesting"
   ```

   表单覆盖一项会列出首页对话的输入框没有声明式标注：它会调模型、要过人机验证，有意不注册成工具。

注册失败只在控制台打一条 `WebMCP registration failed`，不上报。

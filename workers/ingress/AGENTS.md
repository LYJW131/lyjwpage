# workers/ingress（上报入口）

外部上报器的唯一入口，无状态，没有 secret。人读的说明与回执表在 `README.md`，这里只写不变量、坑和须成对修改的文件。

## 不变量

- 回执是对上报器的契约：状态码、正文和检查顺序逐字保持（表见 `README.md#回执`）。改回执要同步所有上报器对状态码的处理（`reporters/`、Mac Hub、iPhone Hub、Home Assistant）。
- 校验与收敛（prepare）只在 `shared/ingest/`，本 Worker 与采集 Worker 打包它；`workers/api` 只 `import type`。命令形状变了要同时改 `workers/api/src/stores/`，上线顺序是 `workers/api` 先、这里后；`StateCore` 契约只加不改（`shared/state-core.ts`）。
- 一封上报按数据层拆开的顺序：状态核心（实时）→ D1 归档 → KV 可滞后层 → 凭据 KV。状态核心拒收时后三步都不做、回 400；唯一例外是 iPhone 训练收下、圆环被拒（见 `README.md#拆分`）。归档排在可滞后层之前，按自然键幂等，失败只记日志、不让上报器重发。
- 校验不过才问 `ready()`：未初始化的 503 优先于校验的 400；请求体不是 JSON 直接回 400、不问 `ready()`。大小按实际读到的字节限制（`shared/storage-contract.ts#STORAGE_MAX_BYTES`），不信 `Content-Length`，超限也是 400。
- 鉴权两层：Access 在边缘核对 service token，`src/access-auth.ts` 再验 JWT 的签名、受众、签发方与时效；只许写 `workers/ingress/wrangler.toml#ACCESS_CLIENTS` 里登记的来源，越权 403。不接受 Bearer 密钥。本地测试钥匙只在签发方是 `src/access-auth.ts#DEV_ACCESS_ISSUER` 时才被认。
- 预览与非生产分支构建关闭：`CORE` 指向生产 `api`，预览版收下的上报会直接写进生产状态；`[previews.vars]` 里的 `PREVIEW_WORKER` 是最后一道闸，预览版本只会拒收。
- 自定义域名 `ingest.homepage.lyjw.llc` 只写在本目录的 `wrangler.toml`（一个域名只写在一份配置）：Workers Builds 里 `wrangler deploy` 会直接接管挂在别的 Worker 上的自定义域名。
- OTLP 路由（`/api/ingest/agents/otlp`）只认 JSON（可 gzip），要专属权限 `ingest:agents-otlp`，`ingest:agents` 不能写它。云端遥测的环境变量只配在云端环境设置里，不进仓库、不配在本机。

## 新增来源要一起做

1. `shared/ingest/` 里写 prepare，登记进 `shared/ingest/prepare.ts#INGEST_SOURCES`，并让状态核心（`workers/api/src/stores/`）能提交它的命令。
2. Zero Trust 控制台新建 service token、加进「lyjwpage ingest」策略，把 client id 与权限 `ingest:<来源>` 登记进 `workers/ingress/wrangler.toml#ACCESS_CLIENTS`（规则见根 `AGENTS.md`「API 命名与跨端契约」）。
3. 补单测，更新 `README.md` 的端点表与鉴权说明，控制台侧的事实记进 `docs/ops-facts.md`。

## 本地开发与验证

- 本地没有 Access：先 `node scripts/dev-access.mjs init`，把它打印的 `ACCESS_DEV_JWKS=` 填进本目录的 `.dev.vars`（不是 api 那份），推送时带 `node scripts/dev-access.mjs header` 打出的 `Cf-Access-Jwt-Assertion` 头（10 分钟有效）。`pnpm dev:worker`（仓库根）会把 `/api/ingest/*` 与 `/api/internal/site-deployed` 转到这里。
- 验证：`pnpm --dir workers/ingress typecheck`、`pnpm --dir workers/ingress test`、`node scripts/verify-api-worker.mjs`（经 Service Binding 打隔离的 api，从上报验到公开读取与推送）。

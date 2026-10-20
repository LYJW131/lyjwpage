# scripts/

- 新写或改动命令行参数解析时用 `node:util` 的 `parseArgs`（`strict: true`）：带值选项缺值、选项后面紧跟另一个选项、未知选项它都会抛错；`allowPositionals` 只在命令要位置参数时打开，打开了就自己校验个数。抛错一律接住，按用法错误退出 2。手写解析容易在缺值时悄悄回落到默认值，检查因此误判通过。
- 改了 `scripts/rules-check.ts` 或 `scripts/rules-check/` 下的规则，同步入口文件头的清单与根 `AGENTS.md`「规则 → 由什么强制」表，跑 `node --test --experimental-strip-types scripts/rules-check.test.ts`。
- 门禁与核验脚本（`pr-gate.ts`、`verify-receipt.ts`，skill 目录里的检查脚本同理）按不通过收口：查询失败、该有的检查或评审没出现、构建被跳过、参数或取值认不出，一律判不通过或报错退出，不当作通过、不悄悄回落到更松的默认值；每种情形配一条测试。

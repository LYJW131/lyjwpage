# scripts/

- 新写或改动命令行参数解析时用 `node:util` 的 `parseArgs`（`strict: true`）：带值选项缺值、选项后面紧跟另一个选项、未知选项它都会抛错；`allowPositionals` 只在命令要位置参数时打开，打开了就自己校验个数。抛错一律接住，按用法错误退出 2；改了选项后用一个未知选项、一个非法取值各跑一次，确认都退出 2。手写解析容易在缺值时悄悄回落到默认值，检查因此误判通过。
- 改了 `scripts/rules-check.ts` 或 `scripts/rules-check/` 下的规则，同步入口文件头的清单与根 `AGENTS.md`「规则 → 由什么强制」表，跑 `node --test --experimental-strip-types scripts/rules-check.test.ts`。
- 门禁、核验与签发脚本（`pr-gate.ts`、`verify-receipt.ts`、`verify-action.ts`、`guard-merge-method.ts`，skill 目录里的检查脚本同理）按不通过收口：查询失败、该有的检查或评审没出现、构建被跳过、模型回答不完整、截图或产物没传上去、参数或取值认不出，一律判不通过或报错退出，不当作通过、不悄悄回落到更松的默认值，报告里也不写成「全过」；每种情形配一条测试。
- 只给建议的检查（`comment-check.ts`、实验任务）反过来：自身出错、令牌或额度失败只标出来，不挡合并（workflow 里那一步加 `continue-on-error`）；它的结论仍照上一条，不完整的不写成「没有建议」。

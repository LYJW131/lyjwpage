# scripts/

- 新写或改动命令行参数解析时用 `node:util` 的 `parseArgs`（`strict: true`，写法见 `scripts/build-actions.ts`）：带值选项缺值、选项后面紧跟另一个选项、未知选项、多余的位置参数它都会抛错，接住后按用法错误退出 2。手写解析容易在缺值时悄悄回落到默认值，检查因此误判通过。
- 改了 `scripts/rules-check.ts` 的规则，同步它的文件头清单与根 `AGENTS.md`「规则 → 由什么强制」表，跑 `node --test --experimental-strip-types scripts/rules-check.test.ts`。

---
name: verify-probes
description: 写差分探针与构造反例的做法：怎么在仓库里 import 改动的模块跑一段脚本、怎么用 compare_base 对照目标分支、针对量词与边界造输入、文档同步的关键词怎么取。验证逻辑改动、准备写探针时读。
---

# 差分探针与反例

## 探针脚本

探针放在 `$TMPDIR`，不写进仓库。用相对仓库根的路径动态 import 改动的模块，这样同一个脚本在 HEAD 与目标分支的检出上各自加载自己那份代码：

```ts
// $TMPDIR/probe.mts
import path from "node:path";
import { pathToFileURL } from "node:url";
const mod = await import(pathToFileURL(path.resolve(process.cwd(), "src/lib/<改动的模块>.ts")).href);
for (const input of CASES) console.log(JSON.stringify(input), "→", JSON.stringify(mod.<被测函数>(input)));
```

运行命令（交给 compare_base，两边各跑一次）：

```bash
node --experimental-strip-types --import ./src/lib/testing/register-alias.mjs "$TMPDIR/probe.mts"
```

`--import` 用相对路径，两边各用自己目录里的 alias 加载器（`@/`、`@shared/`、`@core/` 都能解析）。模块在目标分支上不存在（新文件）时，那一边会报找不到模块，只看 HEAD 一边。

## 造输入

先把声明改写成「对任意输入都成立」的句子，再找让它不成立的输入：

- 量词：「最高」「最先」→ 造两个以上候选、让该选的那个不在默认顺序的第一位；「只」「不再」→ 造落在被排除那一类里的输入；「全部」「每个」→ 造多于上限、或有一个特殊成员的集合。
- 阈值：正好等于、差一点、超一点；0、1、空、超长。
- 文本：大小写、全角半角、首尾空白、转义与特殊字符。
- 时间：本地凌晨（00:00–05:59）、跨日、跨月、Unix 秒与毫秒混用。
- 状态：多个条件同时满足、缺字段、旧格式数据。

两边输出不同的那些输入，逐个对照 PR 声称的行为判断：是声明要的变化，还是带进来的问题。

## 文档同步的关键词

给 docs_sync 的 keywords：改名前的旧名、删掉的常量与环境变量、工作流与 job 名、配置键、PR 标题里的名词、改了的数值与上限写法。命中文件标着「这次没改」、内容又仍是旧说法的，就是漏了同步。

---
name: lyjwpage-formal-model
description: lyjwpage 里查竞态、顺序、重试类 bug 时用：复现不稳、像是几个 Worker、Durable Object 或例程交错写状态出的错，就给出问题的那一块写 TLA+ 模型，让 TLC 穷举交错找反例，再回真代码复现和修。改了多方参与的协议后重跑现成模型也用。不做常驻检查。
---

# 按需建 TLA+ 模型找竞态

## 先分清它查的是什么

- TLA+ 不读代码。照代码手写一份简化模型：有哪些状态、每一步能怎么变、哪些规则不能破。TLC 把所有步骤顺序走一遍；规则被破时给出一串具体步骤，叫反例。
- 模型通过，只说明设计没问题，不证明代码照设计写对了。反例在真代码里复现出来才算 bug。
- 不用 Lean：本项目的难点在并发与状态，纯函数的性质用单测。ESBMC、Kani 这类直接查源码的工具不支持 TypeScript。

## 什么时候用

- `lyjwpage-diagnose` 第 2 步造不出稳定回路，症状像交错：重复派发、状态回退、先后顺序错、重试后重复写、「过一会儿就好了」。
- 改了多方参与的协议（例：访客构建 `workers/ai/src/build/coordinator.ts#BuildCoordinator`）后，重跑现成模型。
- 不用于：单个请求里的逻辑错；读、判、写已在同一个 `transactionSync` 里的 Durable Object 方法（模型里就是一步，没有交错）；CI 或定时检查。

## 四步

照 [Boris Cherny 的做法](https://x.com/bcherny/status/2102898067133595992)，复制到状态行：

```
- [ ] 1 建模出问题的那一块
- [ ] 2 TLC 找反例，并证明检查会失败
- [ ] 3 在真代码里复现反例
- [ ] 4 修、补回归测试
```

### 1. 建模

- 只建出问题的那一块，参与者两三个、计数上限小，TLC 几秒到几分钟跑完。超过 10 分钟就缩模型。
- 原子性照代码定：一次 `transactionSync` 记一步；每个 `fetch`、GitHub 请求、KV 或 R2 写各记一步，其他参与者可以插在任意两步之间。
- 模型文件头写清对应的 `文件#符号` 和建模时的提交 SHA。
- 规则（`INVARIANT`）写成症状的反面，例：「同一构建最多派发一次」。规则从 lyjw 描述的症状或代码里已写明的约束来；自己推出来的规则在汇报里标出来，因为规则错了，机器查得再全也没用。

### 2. 跑 TLC

```sh
curl -fsSL -o tla2tools.jar https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar
echo "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88  tla2tools.jar" | sha256sum -c - && \
java -XX:+UseParallelGC -cp tla2tools.jar tlc2.TLC -workers auto -config X.cfg X.tla
```

- jar 放 scratchpad。云端容器自带 `java`。
- 版本和散列固定在上面这两行，散列不对就不运行。升级时改版本号，自己下载新 jar 用 `sha256sum` 重算散列再一起提交，不照抄 release 页面上的值。
- 输出 `No error has been found` 为通过；反例打印为 `Invariant <名> is violated` 加逐步的状态序列。
- 证明检查会失败：加 `CONSTANT MUT`，每个取值对应一处故意的代码错误（例：去掉某个判断）。`MUT = "none"` 必须通过，每个改坏变体都必须报错。有变体没报错，要么模型漏了东西，要么那处另有保护，写明是哪处。

### 3. 复现

- 把反例的步骤顺序翻成真代码里的回路，按 `lyjwpage-diagnose` 第 2 步的标准：单测里按反例顺序调用，或对本地 Worker 栈并发发请求。
- 复现不出来，先怀疑模型：对着代码改模型，不改代码。

### 4. 修

回到 `lyjwpage-diagnose` 第 5 步。回归测试按反例的顺序写；PR 正文用一两句人话写反例（「A 读了状态，B 写入，A 按旧值写回」）。

## 模型放哪

- 放 Claude 项目共享目录 `/mnt/project-files/formal-verification/<主题>/`，不进仓库：模型要随代码维护，常驻不划算。
- 现成模型：`build-run/`，访客构建的派发、发布、清扫、超时与关 PR 交错，按 f0927832 建模。结果与取舍见 `docs/references.md` 的 create-formal-verification-skill 一条。重跑前对照 `BuildCoordinator` 有没有改动，改了先更新模型。

## 汇报

给 lyjw 的回复写：建模了哪块、几条规则、结果、反例有没有在真代码复现。lyjw 不熟形式化，第一次提时用一句话说清「模型查设计，不查代码」。

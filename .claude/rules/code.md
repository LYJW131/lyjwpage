---
paths:
  - "src/**"
  - "workers/**"
  - "shared/**"
  - "reporters/**"
  - "scripts/**"
---

# 写代码

- 等待都带上限，写代码同理：外部请求带 `AbortSignal.timeout`，互不依赖的请求并行，日志这类收尾交给 `ctx.waitUntil`。
- 改动碰到超过约 20 KB 的源码文件时，顺手按职责拆出一块，原路径留作入口；切不出自然边界就不拆，汇报里说一句。锁文件、Markdown、生成物与讲解动画不算。

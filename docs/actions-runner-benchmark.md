# 自建 Actions runner 实测

> 类型：record
> 按 c33d1fbd05998f3e045eb7d440111010a073095e 2026-10-11 核对，快照不维护，不当现状引用。

## 方法与边界

固定基准输入是 PR #107 的 head `aa8e472450dee5739cfa2342bebc1222a711c1e3`，由下面的 Actions 记录保留。文首核对戳对应 main 的配置与运行记录快照。重跑该 PR 的 CI 与 CodeQL，对比同一提交、同一工作流的不同 attempt。基线是 GitHub 托管机的成功运行；自建机配置与回退入口见 [仓库外事实](./ops-facts.md) 的「GitHub」及「机器与部署位置」。固定提交各 attempt 的工作流源码没有修改。后续工作流优化的验证单独记录，不与固定提交混作同码比较。

时间取 GitHub jobs API 的 `completed_at - started_at`，单位为秒，包含 job 准备和收尾，不包含取得 runner 前的排队时间。取样为单次运行，不能当成长期平均值。CI 与两项 CodeQL 并行执行。

自建机测速期间，同机另一项 apt 安装正在安装 GTK、WebKit 和编译工具。读取 `/proc/pressure/io` 与 CPU 计数发现明显 I/O 阻塞，CPU 仍有空闲；该安装任务没有被停止。表里的自建机结果均受这个并行负载影响，没有得到安装结束后的空闲机器基线。

## 结果

| 运行条件 | CI | CodeQL javascript-typescript | CodeQL actions | 结果 |
| --- | ---: | ---: | ---: | --- |
| GitHub 托管机，attempt 1 | 81 | 69 | 38 | 全部成功 |
| 自建机，磁盘工作目录，attempt 2 | 422 | 278 | 96 | 全部成功 |
| 自建机，内存工作目录，attempt 3 | 103 | 118 | 56 | 全部成功 |
| 自建机，内存工作目录与独立 HOME，attempt 4 | 71 | 110 | 51 | 全部成功 |
| 自建机，16 GiB 与统一工作路径，attempt 6 | 100 | 114 | 52 | 全部成功 |
| 自建机，缓存下载超时修正，attempt 7 | — | 88 | 54 | CodeQL 成功，CI 未重复执行 |
| 自建机，单任务资源预算，attempt 9 | — | 84 | — | 仅重跑 javascript-typescript，成功 |

attempt 4 的 CI 比托管机少 10 秒，约 12%；两项 CodeQL 仍较慢。日志进一步确认两侧的扫描模式不同：托管机命中 overlay 增量数据库，自建机在 attempt 4 因临时盘可用空间低于 CodeQL 要求而全量提取。attempt 6 修正容量与路径后命中相同缓存，但下载触发 CodeQL 的单段超时，仍退回全量提取。attempt 7 将缓存下载的单段超时覆盖为 30 秒后成功恢复增量数据库，javascript-typescript 比 attempt 4 少 22 秒。attempt 9 使用每个 CodeQL 任务八线程、16 GiB 内存预算，javascript-typescript 用时 84 秒；相对 attempt 7 的差异较小，不将一次取样当成线程调优的稳定收益。托管机与自建机的网络、并行负载不同，不能把这组结果当成纯硬件性能比较。

## 工作流优化验证

提交 `c1fb96622392165a904a3543fcaace25d473fb5c` 的 [CI](https://github.com/LYJW131/lyjwpage/actions/runs/38124887421) 在自建机成功完成，用时 55 秒。工作流显式关闭自建机的 setup-node 自动包管理器缓存，并以四组并发运行主站、四个 Worker 与五个 reporter 的测试；日志确认十组测试及脚本测试全部成功，收尾没有压缩上传 pnpm store。此项验证使用优化后的工作流及其源码提交，不是上表固定提交的重跑。

该提交的 [CodeQL](https://github.com/LYJW131/lyjwpage/actions/runs/38124887328) 也成功完成，javascript-typescript 86 秒、actions 53 秒。工作流配置变化产生新缓存键，此次不是缓存命中的增量基准。

main 提交 `c33d1fbd05998f3e045eb7d440111010a073095e` 的 [CodeQL 重跑](https://github.com/LYJW131/lyjwpage/actions/runs/38124964435/attempts/2) 成功。javascript-typescript 用时 188 秒，包含全量生成 overlay-base 数据库；其中扫描结果上传及增量缓存上传后，完整数据库的归档上传与额外体积测量占用约 55 秒。工作流设置 `upload-database: false` 跳过这份可下载归档，安全扫描结果上传与 overlay-base 缓存分别执行，继续保留。

## pnpm store 核对

[main CI](https://github.com/LYJW131/lyjwpage/actions/runs/38125726614) 的安装日志是 `reused 0, downloaded 957`，pnpm 自报 6.7 秒。此时持久 store 的配置意图没有生效：SSH 在各 runner 服务的 mount namespace 内以实际 HOME、PNPM_HOME 执行 `pnpm store path`，结果落在临时的 pnpm/action-setup 安装目录；HOME 下的 store 链接不控制这个路径。CI 以 `CI_CACHE_DIR` 显式设置 `--store-dir`，持久位置见 [仓库外事实](./ops-facts.md)。

使用相同源码在两份全新目录中执行 `pnpm install --frozen-lockfile --offline --store-dir`，两次都复用全部 957 个包，下载为零。首次读取持久磁盘 store 用时 19.6 秒，第二次用时 4 秒；磁盘冷读受同机 I/O 影响，不能只引用第二次暖缓存结果。

自建机的 `scripts/setup-ci-pnpm.sh` 按 `package.json#packageManager` 选择精确版本，工具安装落在各 runner 的持久工具缓存；版本之间隔离，安装加锁并先写临时目录。实测首次安装 2.1 秒、复用 0.45 秒。托管机继续使用 pnpm/action-setup 与 setup-node 的 pnpm 缓存。

主站 tsconfig 的 `incremental` 已启用，CI 从持久缓存恢复 `tsconfig.tsbuildinfo`，完整 workspace typecheck 成功后再原子保存。远端主站 `next typegen` 用时 0.9 秒，`tsc --noEmit` 首次 11.2 秒、复用 3 秒。修改已经检查过的源文件、注入 `string = 42` 后，增量检查以 TS2322 失败；还原后通过。所有 workspace 的检查仍执行，Next 路由类型仍每次生成。

## CI 分步耗时

| 步骤 | 托管机 attempt 1 | 自建机 attempt 4 |
| --- | ---: | ---: |
| checkout | 3 | 2 |
| pnpm/action-setup | 4 | 4 |
| setup-node | 8 | 2 |
| install | 4 | 7 |
| lint | 17 | 2 |
| workspace typecheck | 18 | 13 |
| 主站单测 | 6 | 1 |
| setup-node 收尾 | 0 | 14 |

表中省略 Worker、reporter、脚本单测和其他 job 准备、收尾步骤；这些检查均成功。分步数据来自 GitHub 的秒级时间戳，不要求省略后的行之和等于完整 job 耗时。

## 运行证据

- CI：[托管机](https://github.com/LYJW131/lyjwpage/actions/runs/38122620026/attempts/1)、[自建机磁盘目录](https://github.com/LYJW131/lyjwpage/actions/runs/38122620026/attempts/2)、[内存目录](https://github.com/LYJW131/lyjwpage/actions/runs/38122620026/attempts/3)、[独立 HOME](https://github.com/LYJW131/lyjwpage/actions/runs/38122620026/attempts/4)、[容量与路径修正](https://github.com/LYJW131/lyjwpage/actions/runs/38122620026/attempts/6)。
- CodeQL：[托管机](https://github.com/LYJW131/lyjwpage/actions/runs/38122620033/attempts/1)、[自建机磁盘目录](https://github.com/LYJW131/lyjwpage/actions/runs/38122620033/attempts/2)、[内存目录](https://github.com/LYJW131/lyjwpage/actions/runs/38122620033/attempts/3)、[独立 HOME](https://github.com/LYJW131/lyjwpage/actions/runs/38122620033/attempts/4)、[容量与路径修正](https://github.com/LYJW131/lyjwpage/actions/runs/38122620033/attempts/6)、[缓存下载修正](https://github.com/LYJW131/lyjwpage/actions/runs/38122620033/attempts/7)、[资源预算](https://github.com/LYJW131/lyjwpage/actions/runs/38122620033/attempts/9)。
- 正常 main 提交 ca0de38e811860fa14b3039cf75cac1ffef82c97 也在自建机通过了 [CI](https://github.com/LYJW131/lyjwpage/actions/runs/38123013323) 与 [CodeQL](https://github.com/LYJW131/lyjwpage/actions/runs/38123013322)。

## 配置验证

GitHub runners API 确认 runner 在线、标签匹配，仓库变量启用。实际 job 的 `runner_name` 指向自建机。

在空闲 runner 上停止服务、卸载工作目录及工具缓存的 bind mount，再单独启动服务，systemd 自动恢复两层挂载，创建独立 HOME。Node 工具缓存仍可使用。未重启整台机器。

安装初期 main 的一次 CodeQL 扫描因系统 PATH 缺少 Node 而失败；补齐 Node 后，正常 main 与固定提交重跑均成功。一次 main CI 基准重跑被新的 main 推送按并发规则取消，因此正式对比使用独立 PR 的固定提交。

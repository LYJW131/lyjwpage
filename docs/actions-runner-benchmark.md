# 自建 Actions runner 实测

> 类型：record
> 按 aa8e472450dee5739cfa2342bebc1222a711c1e3 2026-10-11 核对，快照不维护，不当现状引用。

## 方法与边界

重跑已有 PR #107 的 CI 与 CodeQL，对比同一提交、同一工作流的不同 attempt。基线是 GitHub 托管机的成功运行；自建机配置与回退入口见 [仓库外事实](./ops-facts.md) 的「GitHub」及「机器与部署位置」。固定提交各 attempt 的工作流源码没有修改。后续工作流优化的验证单独记录，不与固定提交混作同码比较。

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

attempt 4 的 CI 比托管机少 10 秒，约 12%；两项 CodeQL 仍较慢。日志进一步确认两侧的扫描模式不同：托管机命中 overlay 增量数据库，自建机在 attempt 4 因临时盘可用空间低于 CodeQL 要求而全量提取。attempt 6 修正容量与路径后命中相同缓存，但下载触发 CodeQL 的单段超时，仍退回全量提取。这些结果不能当成相同扫描模式下的硬件性能比较。

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
- CodeQL：[托管机](https://github.com/LYJW131/lyjwpage/actions/runs/38122620033/attempts/1)、[自建机磁盘目录](https://github.com/LYJW131/lyjwpage/actions/runs/38122620033/attempts/2)、[内存目录](https://github.com/LYJW131/lyjwpage/actions/runs/38122620033/attempts/3)、[独立 HOME](https://github.com/LYJW131/lyjwpage/actions/runs/38122620033/attempts/4)、[容量与路径修正](https://github.com/LYJW131/lyjwpage/actions/runs/38122620033/attempts/6)。
- 正常 main 提交 ca0de38e811860fa14b3039cf75cac1ffef82c97 也在自建机通过了 [CI](https://github.com/LYJW131/lyjwpage/actions/runs/38123013323) 与 [CodeQL](https://github.com/LYJW131/lyjwpage/actions/runs/38123013322)。

## 配置验证

GitHub runners API 确认 runner 在线、标签匹配，仓库变量启用。实际 job 的 `runner_name` 指向自建机。

在空闲 runner 上停止服务、卸载工作目录及工具缓存的 bind mount，再单独启动服务，systemd 自动恢复两层挂载，创建独立 HOME 与共享 store 链接。Node 工具缓存仍可使用。未重启整台机器。

安装初期 main 的一次 CodeQL 扫描因系统 PATH 缺少 Node 而失败；补齐 Node 后，正常 main 与固定提交重跑均成功。一次 main CI 基准重跑被新的 main 推送按并发规则取消，因此正式对比使用独立 PR 的固定提交。

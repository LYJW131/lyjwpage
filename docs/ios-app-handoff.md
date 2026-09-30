# iOS App 上机验证

> 类型：runbook

给在 Mac 上接手 [`apps/ios`](../apps/ios/README.md) 的 agent：把这个 App 第一次编过、测过、装上手机，并把验证结果写回仓库。App 是什么、怎么分层见它的 README；硬约束见 [`apps/ios/AGENTS.md`](../apps/ios/AGENTS.md)。做完一项就从本文删掉对应条目，全部做完后删掉本文并从 [docs/README.md](./README.md) 撤下登记。

## 验证入口

构建、测试和安装命令见 [App README](../apps/ios/README.md#目录与验证)。本机编译、模拟器交互及装机结果见 [验证记录](./ios-app-verification.md)；记录是快照，不能代替下面的设备验收。

## 前置

- 带 iOS 27 SDK 的 Xcode、`xcodegen`；Xcode 里登录着 Team `2VTXNMR2GL` 的 Apple ID，Mac 解锁（锁屏时钥匙串读不出账号，自动签名会退回通配描述文件，报缺 HealthKit 能力）。
- iPhone 与 Mac 配对、同一网络、解锁。手机上现在装着同一 bundle id 的旧版，覆盖安装后授权和钥匙串里的密钥都还在。

## 步骤

1. **系统音乐播放**：Mac 或 HomePod 播歌时，点迷你播放器展开；点 Listen Along，允许 Media & Apple Music 授权。确认系统音乐 App 播放同一首歌、从当前进度开始，后续曲目与单曲循环正确。系统音乐接手后不在后台持续同步来源设备；回到 App 后再点一次重新对齐。
2. **设备端摘要**：在 Apple Intelligence 模型可用的设备上，Pulse 的 Day in Review 能生成；模型不可用时不显示这张卡。
3. **覆盖安装与健康上报**：`./build-install.sh`。
   - 覆盖安装后「iPhone」页 Last report 有值、Settings 里地址和 Client ID 还在；按 Report Now 显示 Delivered。
   - 「Now」的 Activity 卡和「iPhone」页的本机圆环对得上。
   - 桌面加 Listening 与 Activity Rings 小组件，锁屏加圆形与长条；主屏切到着色 / 透明外观看封面与圆环是否可读。
   - 快捷指令 App 里跑 Report Telemetry（不打开 App 就完成），可绑到操作按钮；问 Siri「What's playing on lyjwpage」。
4. **后台唤醒**：装好、手动报一次后别再开 App，几小时后看站点上的圆环卡时间往前走了没有；不走按 [README「后台到底有没有在报」](../apps/ios/README.md#后台到底有没有在报) 查。
5. **收尾**：修过的地方提交（提交说明写清是哪条编译错误、怎么改的）；按根 AGENTS.md 的部署流程合进 main。App 不走任何自动部署，装到手机就是上线。

## 装上之后要回填的仓库事实

- `/explainer` 讲解动画里 iPhone 那一格还叫 iPhone Telemetry Hub（`docs/explainer/v2/ch01.js`、`docs/explainer/scenes-1.js`、`docs/explainer/SCRIPT.md`）；要不要改名随下一版动画定，事实基线已在 [FACTS.md](./explainer/FACTS.md) 注明。

## 已知取舍

- **没做控制中心按钮**：控件要在小组件扩展里引用意图，而意图的执行体（上报器、HealthKit、钥匙串）只在主 App；按 `IntentExecutionTargets` 的文档，跨目标复用意图要把它放进共享框架。现在用快捷指令 + 操作按钮覆盖这个需求。
- **没用 iPhone Duo 的 `ArrangementView`、铰链与保留区域 API**：它们在 27.1 beta；布局靠尺寸类自适应，宽窗口两列。
- **图标还是脚本画的 PNG**（`apps/ios/Tools/generate-icon.swift`），没做 Icon Composer 的分层图标。
- **没做实时活动**：要服务端推送令牌，站点没有这条链路。
- 歌词只做了行级高亮；充电曲线每次取整份，没用 `?since=` 增量。

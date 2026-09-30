# apps/ios

站点的原生 iOS 客户端 + iPhone 上报器。人读的说明在 `README.md`；首次上机步骤与待验证清单在 `docs/ios-app-handoff.md`。

## 不变量

- **bundle id 不改**（`project.yml` 的 `PRODUCT_BUNDLE_IDENTIFIER`）：改了 HealthKit 授权、钥匙串里的 Access 密钥、带 HealthKit 能力的描述文件全要重来。小组件 id 是它的后缀。
- **看只在前台**：`LiveStore` 回前台 `activate()`、进后台 `deactivate()`；后台不取任何状态、不连推送（连着会算进站点的 Online now）。
- **上报链路的两条规矩**不单改：失败不补发（站点整份替换，没有顺序闸）；HealthKit 观测回调等上报结束再交差。见 README「两条不能单独改的规矩」。
- **回前台那次上报挂在 App 层**（`LyjwpageApp.swift#HubForeground`），不挂在某个 Tab 的视图上：没点开的 Tab 视图可能根本没建。
- `Core/` 不 import 任何 UI 框架（SwiftUI、UIKit、HealthKit、WidgetKit）：它要能在 Linux 上 `swift test`。
- 小组件目标不编 `Core/Live/`，也不编 `App/`；两边都要的界面放 `SharedUI/`。
- 液态玻璃只用在控件层（系统栏、浮在媒体上的按钮），内容层用分组背景。
- 界面文案英文，数字与日期 en-US（根 AGENTS.md「界面与交互」）。

## 须与站点成对修改

| 这里 | 站点 |
| --- | --- |
| `Core/Models/*.swift` | `src/lib/types.ts` 等载荷类型 |
| `Core/LiveEvent.swift` | `src/lib/live-events.ts#LiveEvent` |
| `Core/Live/FeedSchedule.swift` | `src/lib/status-views.ts#STATUS_VIEWS`、`src/lib/poll-schedule.ts` |
| `Core/Freshness.swift`、`Core/Live/LiveStore+Derived.swift` | `src/lib/freshness.ts`、`src/lib/home-layout.ts` |
| `App/Hub/**` 的上报载荷 | `shared/ingest/phone.ts#KNOWN_MODULES`、`shared/ingest/activity.ts`、`shared/ingest/workouts.ts` |

Swift 里抄过来的常量逐个标了 `源：path#symbol`。站点重命名字段时直接替换，不留兼容分支（根 AGENTS.md「变更完成条件」）。

## 坑

- 主 App 目标把 `App/`、`Core/`、`SharedUI/` 编进同一个模块：三处的类型名不能重复（上报器的载荷叫 `ActivityReport`，站点读回来的叫 `ActivityPayload`），`swift test` 只编 `Core/` 查不出来。
- 块注释 `/** … */` 里别写 `/*`（比如路径通配 `/api/status/*`）：Swift 的块注释可嵌套，会把后面整个文件吞掉。
- 站点状态端点失败时照样回 200、信封里 `ok: false`；解码信封时 `data` 只在 `ok` 为真时存在。
- 推送 `/ws` 握手必须带白名单里的 `Origin`；状态 GET 反过来别带。
- `swiftc -parse` 默认 Swift 5 模式，不认 `/…/` 正则字面量；要加 `-swift-version 6`。

## 本地验证

- `swift test`（本目录）：编 `Core/` 并跑 `Tests/`，Linux 与 macOS 都行；对着 `Tests/Fixtures/` 与 `workers/api/dev-fixtures/` 解码。
- `xcodegen generate && xcodebuild -project Lyjwpage.xcodeproj -scheme Lyjwpage -destination 'generic/platform=iOS Simulator' build`：界面层只能在 Mac 上编。
- `xcodebuild … -scheme Lyjwpage -destination 'platform=iOS Simulator,name=<机型>' test`：同一批测试在 Xcode 里跑。
- 装到真机：`./build-install.sh`（要对着具体设备编，见 README「装不上的两种」）。
- 改了注释以外的 Swift 就在 Mac 上至少编一次；Xcode 编译通过不能代替真机授权和后台唤醒验证。

/**
 * 「这一路还没收到过数据」。
 *
 * **不是故障**：上报器还没起来、设备还没连上、快照过了 TTL —— 都会落到这里，而站点
 * 该做的就是发一个降级信封让卡片显示提示。所以它和「取数真的炸了」必须在日志里分开：
 * 前者一行就够，后者要带栈。前者既不是 bug 也无从修（充电头没插而已），带栈打会把
 * 真正的报错淹掉，本机开发时 Next 的浮层也会被一条「尚未收到充电头遥测推送」长期糊着。
 */
export class AwaitingReport extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AwaitingReport";
  }
}

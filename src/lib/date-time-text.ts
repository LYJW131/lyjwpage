// V8（workerd 里的 SSR）与 JavaScriptCore 的语言数据拼「日期 + 时间」的连接词不同（", " 对 " at "），
// 一个 formatter 同时带日期和时间字段时首屏文本在 Safari 上对不上，整页退回客户端渲染；日期、时间分开格式化再固定用 ", " 拼。
export function dateTimeText(at: number | Date, date: Intl.DateTimeFormat, time: Intl.DateTimeFormat): string {
  return `${date.format(at)}, ${time.format(at)}`;
}

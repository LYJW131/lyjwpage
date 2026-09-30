// 类型导入仍会检查共用 fetch 代码；Workers 类型库缺少 cache 声明。
interface RequestInit {
  cache?: string;
}

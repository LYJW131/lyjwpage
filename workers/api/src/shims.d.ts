// 共用模块含受 typeof 守卫的浏览器类型；Workers 的类型库缺少这些声明。
declare const document: { querySelector<T>(selectors: string): T | null } | undefined;
type HTMLMetaElement = { content: string };

interface RequestInit {
  cache?: string;
}

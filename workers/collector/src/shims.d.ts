// Workers fetch 接受 cache，但其类型库未声明，需补齐共用模块的类型。
interface RequestInit {
  cache?: string;
}

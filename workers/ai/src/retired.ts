import { DurableObject } from "cloudflare:workers";

// 生产里这个类的命名空间是从旧 api Worker 经 transferred_classes 转来的；wrangler 的迁移校验不把转来的类算作已存在，
// 追加 deleted_classes 会被拒（"Cannot apply deleted_classes migration to non-existent class"）。所以只留空类导出，
// 不绑定、不再有调用；wrangler 认转来的类之后再用 deleted_classes 删掉。
export class AnthropicEgress extends DurableObject {}

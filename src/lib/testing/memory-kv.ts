/** 测试用的内存 KV：只实现 shared/lag、shared/credentials 用到的那几个方法 */
export class MemoryKv {
  readonly values = new Map<string, string>();
  writes = 0;

  async get(key: string, _type?: "text"): Promise<string | null> {
    void _type;
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.writes += 1;
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

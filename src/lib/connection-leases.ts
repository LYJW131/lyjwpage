/** 能被连接租约管理的最小客户端形状。 */
export interface Disconnectable {
  disconnect(): void;
}

/**
 * 进程内连接租约。
 *
 * scope 表示一整个请求 / 缓存重建还在使用连接；operation 表示一条 Redis
 * 命令或 pipeline 还没结束。两者都归零后立刻断开，避免 serverless 实例被暂停
 * 时把一条空闲 TCP 一直挂在数据库上。
 */
export class ConnectionLeases<Client extends Disconnectable> {
  private client: Client | null = null;
  private scopes = 0;
  private operations = 0;

  current(): Client | null {
    return this.client;
  }

  use(client: Client): Client {
    if (this.client && this.client !== client) {
      throw new Error("连接租约已有客户端");
    }
    this.client = client;
    return client;
  }

  async scope<T>(run: () => Promise<T>): Promise<T> {
    this.scopes += 1;
    try {
      return await run();
    } finally {
      this.scopes -= 1;
      this.closeIfIdle();
    }
  }

  async operation<T>(
    acquire: () => Client | null,
    run: (client: Client) => Promise<T>,
    fallback: T,
  ): Promise<T> {
    this.operations += 1;
    try {
      const client = acquire();
      return client ? await run(client) : fallback;
    } finally {
      this.operations -= 1;
      this.closeIfIdle();
    }
  }

  /** 出错时立即丢掉当前客户端，也阻止它继续在后台自动重连。 */
  disconnect(client: Client): void {
    if (this.client !== client) return;
    this.client = null;
    client.disconnect();
  }

  private closeIfIdle(): void {
    if (this.scopes !== 0 || this.operations !== 0 || !this.client) return;

    // 先清引用：disconnect 会同步发事件，事件处理器不能再拿到这条旧连接。
    const idle = this.client;
    this.client = null;
    idle.disconnect();
  }
}

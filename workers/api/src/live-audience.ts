export type AudienceLink = {
  told(): Promise<boolean | undefined>;
  tell(watched: boolean): Promise<void>;
  remember(watched: boolean): Promise<void>;
};

// 同一时刻只有一条通知在途；在途期间的翻转只改目标值，由同一个循环补发，保证 StateHub 最终收到的是最新状态。
export class AudienceSync {
  private wanted = true;
  private running: Promise<void> | null = null;
  private readonly link: AudienceLink;

  constructor(link: AudienceLink) {
    this.link = link;
  }

  update(watched: boolean): Promise<void> {
    this.wanted = watched;
    this.running ??= this.drain();
    return this.running;
  }

  // 退出判断与清空 running 之间不能有 await，否则这段空档里的翻转会挂到即将结束的循环上而丢失。
  private async drain(): Promise<void> {
    try {
      while (true) {
        const told = await this.link.told();
        const wanted = this.wanted;
        if (told === wanted) {
          this.running = null;
          return;
        }
        await this.link.tell(wanted);
        await this.link.remember(wanted);
      }
    } catch (error) {
      this.running = null;
      throw error;
    }
  }
}

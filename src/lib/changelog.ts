/**
 * 更新日志。手写的，不从 `git log` 生成 —— 两个理由：
 *
 * 1. **构建期读不到完整历史。** Vercel 是浅克隆，EdgeOne 那份的克隆深度也不由
 *    这个仓库决定。`git rev-parse HEAD` 深度 1 就够（页脚那个 sha 因此没事，见
 *    next.config.ts），`git log -50` 不够 —— 同一份代码在三份部署上会给出不同
 *    长度的日志、甚至空日志，而且页面上看不出来它是错的。
 * 2. **提交信息不是给访客看的。** 50 个提交里 `docs` / `style` / `refactor` 占
 *    了 13 个，而 `refactor(env): configure Worker origins` 也不是人话。摘要手写、
 *    真相在 git，两边各干各的、不重复：每条带一个 commit，渲染时和上一条拼成
 *    GitHub 的 compare 链接，想看细节的人自己点过去。
 *
 * 这个文件不引 `@/` 下的任何东西：它要能被 `node --test` 直接 import
 * （见 changelog.test.mts），那边没有路径别名。仓库地址在渲染侧拼，见
 * components/changelog.tsx。
 */

/**
 * 一条改动的类型。只有三种，且**只按访客看得见的影响分**，不照搬 conventional
 * commit 的那七八种 —— `refactor` 和 `perf` 对着页面看是同一件事：变快了或者没变。
 */
export type ChangeKind = "new" | "fix" | "tune";

export const KIND_LABEL: Record<ChangeKind, string> = {
  new: "新增",
  fix: "修复",
  tune: "优化",
};

export type ChangelogNote = {
  kind: ChangeKind;
  text: string;
};

export type ChangelogEntry = {
  /**
   * 递增整数，**新旧判定只比这一个值**。
   *
   * 不用语义化版本：这个站没有 API、没有兼容性承诺，major/minor/patch 三段里
   * 有两段永远填不出有意义的数。也不用日期当版本 —— 同一天写两条就撞了。
   */
  version: number;
  /**
   * `YYYY-MM-DD`，展示用的字符串，不是时间戳。
   *
   * 所以**不要拿它去 `new Date()`**：手写的日期没有「那一刻」这回事，塞进 Date
   * 会被当成 UTC 午夜，再按访客时区格式化就可能倒退一天，而且服务端和浏览器
   * 各算各的必然水合不一致。原样切成 `2026/08/18` 就够（页脚那个构建时刻是另一
   * 回事，它是真时间戳，按站点时区格式化，见 lib/build-info）。
   */
  date: string;
  title: string;
  notes: readonly ChangelogNote[];
  /**
   * 这一条覆盖到哪个提交为止。区间的**起点是上一条的 commit**，不重复写。
   *
   * 可以不填 —— 描述的就是「加这条日志」本身时，那个提交此刻还不存在，填不了。
   * 不填就只是少一个链接，别为了凑一个链接去填一个近似的 sha：那会把不相干的
   * 提交划进这一条的区间里，而且不会有人发现。
   */
  commit?: string;
};

/**
 * 最新的在最前面 —— 展示顺序就是这个顺序，渲染时不排序。
 * 版本号必须严格递减、日期必须不递增，changelog.test.mts 会拦。
 */
export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: 9,
    date: "2026-08-18",
    title: "有更新的时候会主动说一声",
    notes: [
      { kind: "new", text: "页脚上方多了一条窄条，只在有你还没看过的条目时出现" },
      { kind: "new", text: "点开是完整的更新日志，并标出你上次看到哪一条" },
    ],
  },
  {
    version: 8,
    date: "2026-08-18",
    title: "正在听和额度那两处的细节",
    notes: [
      { kind: "new", text: "额外额度那行显示套餐名和距离重置还有多久" },
      {
        kind: "new",
        text: "靠播放进度推断出来的「正在播放」标上 inferred，不再和真播放混作一谈",
      },
    ],
    commit: "503c468",
  },
  {
    version: 7,
    date: "2026-08-17",
    title: "国内那份不再慢半拍",
    notes: [
      {
        kind: "fix",
        text: "状态接口的缓存加了个按部署填的开关，国内那份关掉、直读数据库，实测能少落后几十秒",
      },
      { kind: "new", text: "额外额度那栏认得 Grok 的图标了" },
    ],
    commit: "f653bf6",
  },
  {
    version: 6,
    date: "2026-08-16",
    title: "两份线上部署靠传播上报对齐",
    notes: [
      {
        kind: "new",
        text: "收到上报的那份会把同一个请求原样转给对面，两边各写各的库，不再共用一份跨海的存储",
      },
      { kind: "tune", text: "落库、推送、转发全挪到响应之后，上报的那侧不再为这些等待" },
      { kind: "tune", text: "存活窗口放宽，心跳可以慢到 90 秒一次" },
      { kind: "fix", text: "采集侧停了就灭掉 agent 活动灯；首帧也不再把离线画成在线" },
    ],
    commit: "a207f83",
  },
  {
    version: 5,
    date: "2026-08-16",
    title: "实时推送换成自己托管",
    notes: [
      { kind: "new", text: "自建的 live-push Worker 接管了全部长连接，不再用 Pusher" },
      { kind: "new", text: "页脚的在线人数走 Durable Objects，按活跃连接实时计数" },
      { kind: "new", text: "正在听那行认得单曲循环了" },
      { kind: "fix", text: "Worker 真的按来源白名单拦了" },
      { kind: "tune", text: "Worker 地址全部挪进环境变量，源码里不再写死" },
    ],
    commit: "8f9d0a7",
  },
  {
    version: 4,
    date: "2026-08-15",
    title: "前台应用和页头",
    notes: [
      { kind: "new", text: "藏在后面没有窗口的应用也画出来了" },
      { kind: "new", text: "页头那朵 Claude Code 菊花会跳了" },
      { kind: "new", text: "页脚可以从环境变量再挂一行文案" },
      { kind: "fix", text: "活动状态切换不再等图标加载完" },
    ],
    commit: "93e388c",
  },
  {
    version: 3,
    date: "2026-08-15",
    title: "页签图标和贡献热力图",
    notes: [
      { kind: "new", text: "页签图标在构建时从 GitHub 最新头像生成" },
      { kind: "tune", text: "GitHub 贡献热力图压成五条路径，省掉几百个格子" },
      { kind: "fix", text: "图片地址按部署解析，两份线上各取各的交付域" },
      { kind: "fix", text: "Mac 的正在播放按字段落库，一次心跳不会盖掉一次切歌" },
    ],
    commit: "e0f5c07",
  },
  {
    version: 2,
    date: "2026-08-15",
    title: "正在听的封面动起来了",
    notes: [
      { kind: "new", text: "Apple Music 的动态封面，由一个自建 Worker 取回来" },
      { kind: "tune", text: "封面淡入放缓，播放中的进度条上色" },
      { kind: "fix", text: "暂停时进度条直接切灰，不再闪一下彩虹" },
    ],
    commit: "9732fa7",
  },
  {
    version: 1,
    date: "2026-08-15",
    title: "充电宝上线，和充电头共用一格",
    notes: [
      { kind: "new", text: "充电宝：电量、电池健康、进出功率，底座当作 B 口" },
      { kind: "new", text: "充电头和充电宝共用一格，两台都在供电时那一格才分开，切换带过渡" },
      { kind: "tune", text: "电池条、额定能量那行和两张卡的高度都重排过" },
      { kind: "tune", text: "落库和推送改成并行，不再串着等" },
    ],
    commit: "fe56985",
  },
];

/** 最新那条的版本号。「有没有没看过的」比的就是它 */
export const LATEST_VERSION = CHANGELOG[0].version;

/**
 * 第 `index` 条覆盖的提交区间，相对仓库地址的一段路径。
 *
 * 起点取下一条（更旧那条）的 commit；没有更旧的就退成「从头到这里」。
 * 拼完整地址要 site.repo，那是渲染侧的事 —— 这个文件不引别名。
 */
export function compareRef(index: number): string | null {
  const entry = CHANGELOG[index];
  if (!entry?.commit) return null;

  const previous = CHANGELOG[index + 1];
  return previous?.commit
    ? `compare/${previous.commit}...${entry.commit}`
    : `commits/${entry.commit}`;
}

/** `2026-08-18` → `2026/08/18`。纯字符串替换，见 ChangelogEntry.date 上的注释 */
export function displayDate(date: string): string {
  return date.replace(/-/g, "/");
}

/**
 * 还没看过的条目数。
 *
 * `seen` 是 null 表示这台浏览器没有记录 —— 第一次来的人没有「上一次」，
 * 给他弹一条「3 项更新」是没有意义的，所以算 0 条，由调用方顺手记下当前进度。
 */
export function unreadCount(seen: number | null): number {
  if (seen == null) return 0;
  return CHANGELOG.filter((entry) => entry.version > seen).length;
}

/**
 * 站点配置。
 *
 * 个人信息展示（hero / 关于 / 项目 / 时间线）暂时从页面上撤掉了，
 * 撤掉的组件和数据在 git 里（见 README「回滚」）。
 */

export const site = {
  /** 用于 header 和 <head> metadata */
  name: "LYJW's Homepage",
  /** 窄屏页头只留这四个字母 */
  shortName: "LYJW",
  url: "https://lyjw.me",
  description: "实时展示设备、应用、音乐、影视与 AI 编程状态的个人主页。",
  /** 页脚的 commit 链接拼在它后面 */
  repo: "https://github.com/LYJW131/lyjwpage",
  githubLogin: "LYJW131",
  github: "https://github.com/LYJW131",
  /**
   * 只剩回退用途：卡片上那张头像正常走构建期内联的 data URI（见
   * lib/github-avatar-icon 的 githubAvatarDataUri），拉不到才用这个 URL
   * 过 next/image 优化器回源。页签图标又是另一份，见 icon.tsx。
   */
  githubAvatar: "https://avatars.githubusercontent.com/LYJW131?s=192",
  email: "admin@lyjw.me",

  /** Mac 时区遥测不可用时，时间卡片回退到这个后端默认时区。 */
  timezone: "Asia/Shanghai",
} as const;

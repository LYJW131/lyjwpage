/**
 * 站点配置。
 *
 * 个人信息展示（hero / 关于 / 项目 / 时间线）暂时从页面上撤掉了，
 * 撤掉的组件和数据在 git 里（见 README「回滚」）。
 */

export const site = {
  /** 用于 header 和 <head> metadata */
  name: "LYJW",
  url: "https://lyjw131.com",
  /** 占位：会进 <meta description> */
  tagline: "折腾流媒体、自建服务和一切会发光的小玩意。",

  // 以下几项当前没有引用，等 hero 加回来时会用到，先留着
  fullName: "LYJW",
  domain: "lyjw131.com",
  timezone: "Asia/Shanghai",
} as const;

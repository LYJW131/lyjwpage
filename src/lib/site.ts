/**
 * 站点内容配置 —— 所有文案集中在这里改，组件不写死内容。
 * TODO(占位): 带 “占位” 注释的都是我先填的示例文案，按自己的情况替换即可。
 */

export const site = {
  name: "LYJW",
  /** 占位 */
  fullName: "梁杨俊炜",
  domain: "lyjw131.com",
  url: "https://lyjw131.com",
  /** 占位：一句话介绍，会出现在 hero 和 <meta description> */
  tagline: "折腾流媒体、自建服务和一切会发光的小玩意。",
  /** 占位：hero 下方的自我介绍，支持多段 */
  bio: [
    "你好，我是 LYJW。一个喜欢把家里所有设备联网、然后再给它们做个看板的人。",
    "平时在写代码、看番、听歌，以及研究充电头到底能跑到多少瓦。",
  ],
  /** 占位：所在地，会显示在 hero 的状态条上 */
  location: "中国",
  timezone: "Asia/Shanghai",
  email: "lyjw2007@gmail.com",
} as const;

export type SocialLink = {
  label: string;
  href: string;
  /** lucide 图标名，见 components/icon.tsx 的映射 */
  icon: "github" | "mail" | "rss" | "link" | "music" | "clapperboard";
};

/** 占位：换成你自己的链接 */
export const socials: SocialLink[] = [
  { label: "GitHub", href: "https://github.com/", icon: "github" },
  { label: "Email", href: "mailto:lyjw2007@gmail.com", icon: "mail" },
  { label: "Emby", href: "https://emby.lyjw131.com", icon: "clapperboard" },
];

export type Project = {
  name: string;
  description: string;
  href?: string;
  tags: string[];
  /** 用于卡片右上角的状态点 */
  status?: "active" | "wip" | "archived";
};

/** 占位：把这几个换成你真正想展示的项目 */
export const projects: Project[] = [
  {
    name: "AMDL",
    description: "Apple Music 下载与曲库管理，带任务队列和 Web 控制台。",
    href: "https://amdl.lyjw131.com",
    tags: ["Go", "React", "Apple Music API"],
    status: "active",
  },
  {
    name: "Homelab",
    description: "Emby / qBittorrent / Homepage 一套自建流媒体与下载链路。",
    tags: ["Docker", "Emby", "NAS"],
    status: "active",
  },
  {
    name: "Anker Prime Exporter",
    description: "把桌面充电头的实时功率读出来，喂给看板和这个主页。",
    tags: ["BLE", "HTTP", "Metrics"],
    status: "wip",
  },
];

export type TimelineItem = {
  date: string;
  title: string;
  description: string;
};

/** 占位：时间线 / 近况 */
export const timeline: TimelineItem[] = [
  {
    date: "2026",
    title: "在做一些看得见的东西",
    description: "把自建服务的数据整理成这个主页，顺便重学了一遍前端。",
  },
  {
    date: "2025",
    title: "开始折腾 Homelab",
    description: "从一台 NAS 开始，慢慢长成了一整套媒体库与自动化流程。",
  },
];

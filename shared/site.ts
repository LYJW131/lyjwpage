
export const CLOUDFLARE_DASH_URL = "https://dash.cloudflare.com/209f2c881b1c494fec50851c067b3266";

export const site = {
  name: "LYJW's Homepage",
  shortName: "LYJW",
  url: "https://lyjw.me",
  description: "A personal homepage with live status of devices, apps, music, media and AI coding.",
  repo: "https://github.com/LYJW131/lyjwpage",
  cloudflare: `${CLOUDFLARE_DASH_URL}/workers-and-pages`,
  githubLogin: "LYJW131",
  githubId: 153256373,
  github: "https://github.com/LYJW131",
  githubAvatar: "https://avatars.githubusercontent.com/LYJW131?s=192",
  email: "admin@lyjw.me",

  timezone: "Asia/Shanghai",
} as const;

export const ogImage = {
  width: 1200,
  height: 630,
  type: "image/png",
  alt: `${site.name} — live status of devices, music, media and AI coding`,
} as const;

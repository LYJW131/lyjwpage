import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { THEME_COLOR_LIGHT } from "@/lib/theme-chrome";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: site.name,
    short_name: site.shortName,
    description: site.description,
    lang: "en",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLOR_LIGHT,
    theme_color: THEME_COLOR_LIGHT,
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}

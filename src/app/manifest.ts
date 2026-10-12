import { site } from "@shared/site";
import { STABLE_ASSET_CACHE_CONTROL } from "@/lib/site-policy";

export function loader() {
  return new Response(
    JSON.stringify({
      id: "/",
      name: site.name,
      short_name: site.shortName,
      description: site.description,
      lang: "en",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#ffffff",
      icons: [
        { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      ],
    }),
    {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": STABLE_ASSET_CACHE_CONTROL,
      },
    },
  );
}

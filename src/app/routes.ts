import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("page.tsx"),
  route("github-callback", "github-callback/page.tsx"),
  route("local/charging", "local/charging/page.tsx"),
  route("manifest.webmanifest", "manifest.ts"),
  route("api/version", "api/version/route.ts"),
  route("icon", "icon.tsx"),
  route("apple-icon", "apple-icon.tsx"),
  route("opengraph-image", "opengraph-image.tsx"),
  route("pwa/icon-192.png", "pwa/icon-192.png/route.ts"),
  route("pwa/icon-512.png", "pwa/icon-512.png/route.ts"),
  route("*", "not-found.tsx"),
] satisfies RouteConfig;

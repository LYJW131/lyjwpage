import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("page.tsx"),
  route("github-callback", "github-callback/page.tsx"),
  route("local/charging", "local/charging/page.tsx"),
  route("manifest.webmanifest", "manifest.ts"),
  route("api/version", "api/version/route.ts"),
  route("*", "not-found.tsx"),
] satisfies RouteConfig;

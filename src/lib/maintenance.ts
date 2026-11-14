// 开着时页面路由只渲染维护页并回 503（src/app/root.tsx 的 loader 与 ErrorBoundary），/api/*、/ws、资源路由与静态资源照常。
export const MAINTENANCE = false;

export function maintenanceResponse(): Response {
  return new Response(null, { status: 503 });
}

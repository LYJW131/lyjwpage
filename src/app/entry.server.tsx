import { renderToReadableStream } from "react-dom/server";
import * as Sentry from "@sentry/cloudflare";
import { ServerRouter, type EntryContext } from "react-router";

import { NO_STORE } from "@/lib/site-policy";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  let shellReady = false;
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        // 壳之后的错误由 Suspense 边界交给客户端重渲，页面仍可用：不改状态码，只不让这份降级 HTML 进缓存。
        if (shellReady) responseHeaders.set("Cache-Control", NO_STORE);
        else responseStatusCode = 500;
        console.error(error);
        Sentry.captureException(error);
      },
    },
  );
  shellReady = true;
  await body.allReady;
  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}

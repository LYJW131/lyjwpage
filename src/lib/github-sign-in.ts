import { GITHUB_APP_CLIENT_ID, GITHUB_CALLBACK_PATH, GITHUB_SIGN_IN_MESSAGE } from "@shared/github-issue";

const CANCELLED = "GitHub sign-in was cancelled.";

// window.open 必须在点击的同一个调用栈里同步发出，否则会被当成弹窗广告拦掉；所以它先于任何 await。
export function signInWithGithub(): Promise<string> {
  const state = crypto.randomUUID();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", GITHUB_APP_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${location.origin}${GITHUB_CALLBACK_PATH}`);
  url.searchParams.set("state", state);
  const popup = window.open(url, "github-sign-in", "popup,width=520,height=720");
  if (!popup) return Promise.reject(new Error("Allow pop-ups for this site to sign in with GitHub."));
  return new Promise((resolve, reject) => {
    const done = () => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; state?: unknown; code?: unknown } | null;
      if (event.origin !== location.origin || data?.type !== GITHUB_SIGN_IN_MESSAGE || data.state !== state) return;
      done();
      if (typeof data.code === "string" && data.code) resolve(data.code);
      else reject(new Error(CANCELLED));
    };
    const timer = setInterval(() => {
      if (!popup.closed) return;
      done();
      reject(new Error(CANCELLED));
    }, 500);
    window.addEventListener("message", onMessage);
  });
}

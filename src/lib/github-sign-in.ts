import { GITHUB_APP_CLIENT_ID, GITHUB_CALLBACK_PATH, GITHUB_SIGN_IN_MESSAGE, type GithubSignIn } from "@shared/github-issue";

const CANCELLED = "GitHub sign-in was cancelled.";
const UNAVAILABLE = "GitHub sign-in isn't available in this browser.";

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// window.open 必须在点击的同一个调用栈里同步发出，否则会被当成弹窗广告拦掉；PKCE 的 SHA-256 是异步的，所以先开空白弹窗，算完 challenge 再把它导去 GitHub。
export function signInWithGithub(): Promise<GithubSignIn> {
  if (!crypto.subtle) return Promise.reject(new Error(UNAVAILABLE));
  const state = crypto.randomUUID();
  const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const popup = window.open("about:blank", "github-sign-in", "popup,width=520,height=720");
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
      if (typeof data.code === "string" && data.code) resolve({ code: data.code, codeVerifier });
      else reject(new Error(CANCELLED));
    };
    const timer = setInterval(() => {
      if (!popup.closed) return;
      done();
      reject(new Error(CANCELLED));
    }, 500);
    window.addEventListener("message", onMessage);
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier)).then(
      (hash) => {
        const url = new URL("https://github.com/login/oauth/authorize");
        url.searchParams.set("client_id", GITHUB_APP_CLIENT_ID);
        url.searchParams.set("redirect_uri", `${location.origin}${GITHUB_CALLBACK_PATH}`);
        url.searchParams.set("state", state);
        url.searchParams.set("code_challenge", base64url(new Uint8Array(hash)));
        url.searchParams.set("code_challenge_method", "S256");
        if (!popup.closed) popup.location.href = url.href;
      },
      () => {
        done();
        popup.close();
        reject(new Error(UNAVAILABLE));
      },
    );
  });
}

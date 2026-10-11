import type { Metadata } from "next";

import { GITHUB_SIGN_IN_MESSAGE } from "@shared/github-issue";

export const metadata: Metadata = {
  title: "GitHub sign-in",
  robots: { index: false, follow: false },
};

// 只把 code 交给同源的打开者：别的站点即使自己打开这个授权弹窗，也收不到 code。读完参数先从地址栏和这条历史里抹掉 code 与 state，弹窗没关上时 URL 里也不留授权码。
const RELAY = `try{var p=new URLSearchParams(location.search);history.replaceState(null,"",location.pathname);if(window.opener){window.opener.postMessage({type:${JSON.stringify(GITHUB_SIGN_IN_MESSAGE)},code:p.get("code"),state:p.get("state")},location.origin);window.close()}}catch(e){}`;

export default function GithubCallbackPage() {
  return (
    <main id="content" tabIndex={-1}>
      <p className="p-6 text-sm text-muted-foreground">Finishing GitHub sign-in… you can close this window.</p>
      <script dangerouslySetInnerHTML={{ __html: RELAY }} />
    </main>
  );
}

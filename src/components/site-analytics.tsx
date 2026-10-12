"use client";

import { useEffect } from "react";

const AUTOMATED = /Chrome-Lighthouse|HeadlessChrome/;

function automated(): boolean {
  return typeof navigator !== "undefined" && AUTOMATED.test(navigator.userAgent);
}

const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

function beaconToken(): string | null {
  const raw = process.env.PUBLIC_CF_WEB_ANALYTICS_TOKENS;
  if (!raw) return null;
  try {
    const map: unknown = JSON.parse(raw);
    if (!map || typeof map !== "object" || Array.isArray(map)) return null;
    const token = (map as Record<string, unknown>)[location.hostname];
    return typeof token === "string" && token ? token : null;
  } catch {
    return null;
  }
}

export function SiteAnalytics() {
  const token = beaconToken();

  useEffect(() => {
    if (!token || automated()) return;
    if (document.querySelector("script[data-cf-beacon]")) return;
    const script = document.createElement("script");
    script.type = "module";
    script.src = BEACON_SRC;
    script.dataset.cfBeacon = JSON.stringify({ token });
    document.head.appendChild(script);
  }, [token]);

  return null;
}

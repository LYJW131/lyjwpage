"use client";

import { useEffect } from "react";

import { registerSiteTools } from "@/lib/webmcp";

export function SiteWebMcp() {
  useEffect(() => {
    const context = document.modelContext;
    if (!context) return;
    const controller = new AbortController();
    registerSiteTools(context, controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) console.warn("WebMCP registration failed", error);
    });
    return () => controller.abort();
  }, []);

  return null;
}

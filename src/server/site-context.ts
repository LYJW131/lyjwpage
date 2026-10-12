import { createContext } from "react-router";

import type { FirstScreen } from "@/lib/first-screen";
import type { StatusViewKey } from "@/lib/status-views";

export interface SiteServices {
  status<K extends StatusViewKey>(key: K): Promise<FirstScreen<K>>;
  lyrics(songId: string): Promise<import("@/lib/lyrics-ttml").LyricsResult | null>;
  image(url: string, px: number, fit: "cover" | "contain", quality?: number): Promise<string | null>;
  asset(path: string): Promise<Response>;
}

export const siteContext = createContext<SiteServices>();

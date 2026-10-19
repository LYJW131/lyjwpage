import { createContext } from "react-router";

import type { FirstScreen } from "@/lib/first-screen";
import type { StatusViewKey } from "@shared/status-views";

export interface SiteServices {
  status<K extends StatusViewKey>(key: K): Promise<FirstScreen<K>>;
  lyrics(songId: string): Promise<import("@shared/lyrics-ttml").LyricsResult | null>;
  image(url: string, px: number, fit: "cover" | "contain", quality?: number): Promise<string | null>;
  asset(src: string): Promise<string | null>;
}

export const siteContext = createContext<SiteServices>();

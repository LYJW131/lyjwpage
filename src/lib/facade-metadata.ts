import type { Metadata } from "next";

import { site } from "@/lib/site";

export function facadeMetadata(title: string, description: string, index = false): Metadata {
  return {
    title,
    description,
    robots: { index, follow: index },
    openGraph: {
      title: `${title} — ${site.name}`,
      description,
      siteName: site.name,
      locale: "en_US",
      type: "website",
    },
  };
}

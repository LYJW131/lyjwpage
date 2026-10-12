import type { MetaDescriptor } from "react-router";

import { LOCAL_CHARGING_STORAGE_KEY } from "@/lib/local-charging-arm";
import { site } from "@shared/site";

export function meta(): MetaDescriptor[] {
  return [
    { title: `Local Charging — ${site.name}` },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export default function LocalChargingArmPage() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `try{localStorage.setItem(${JSON.stringify(LOCAL_CHARGING_STORAGE_KEY)},"1")}catch(e){}location.replace("/")`,
      }}
    />
  );
}

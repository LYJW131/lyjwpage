import type { MetaDescriptor } from "react-router";

import { LOCAL_CHARGING_STORAGE_KEY } from "@/lib/local-charging-arm";
import { NO_STORE } from "@/lib/site-policy";

export function meta(): MetaDescriptor[] {
  return [
    { title: "Local Charging — LYJW's Homepage" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers() {
  return { "Cache-Control": NO_STORE };
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

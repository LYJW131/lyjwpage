import type { Metadata } from "next";

import { LOCAL_CHARGING_STORAGE_KEY } from "@/lib/local-charging-arm";

export const metadata: Metadata = {
  title: "Local Charging",
  robots: { index: false, follow: false },
};

export default function LocalChargingArmPage() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `try{localStorage.setItem(${JSON.stringify(LOCAL_CHARGING_STORAGE_KEY)},"1")}catch(e){}location.replace("/")`,
      }}
    />
  );
}

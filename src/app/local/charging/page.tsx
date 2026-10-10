import type { Metadata } from "next";
import Link from "next/link";

import { LOCAL_CHARGING_STORAGE_KEY } from "@/lib/local-charging-arm";

export const metadata: Metadata = {
  title: "Local Charging",
  robots: { index: false, follow: false },
};

export default function LocalChargingArmPage() {
  return (
    <main id="content" tabIndex={-1} className="flex flex-1 items-center justify-center p-6 text-center">
      <p className="text-sm text-muted-foreground">
        Returning home…{" "}
        <Link href="/" className="underline underline-offset-2">
          Back to home
        </Link>
      </p>
      <script
        dangerouslySetInnerHTML={{
          __html: `try{localStorage.setItem(${JSON.stringify(LOCAL_CHARGING_STORAGE_KEY)},"1")}catch(e){}location.replace("/")`,
        }}
      />
    </main>
  );
}

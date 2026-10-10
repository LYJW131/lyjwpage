import { facadeMetadata } from "@/lib/facade-metadata";
import { LOCAL_CHARGING_STORAGE_KEY } from "@/lib/local-charging-arm";

export const metadata = facadeMetadata("Local Charging", "Arms the local charging preview, then returns home.");

export default function LocalChargingArmPage() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `try{localStorage.setItem(${JSON.stringify(LOCAL_CHARGING_STORAGE_KEY)},"1")}catch(e){}location.replace("/")`,
      }}
    />
  );
}

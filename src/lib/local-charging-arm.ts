export const LOCAL_CHARGING_PATH = "/local/charging";
export const LOCAL_CHARGING_STORAGE_KEY = "local-charging";

export function readLocalChargingArmed(): boolean {
  try {
    return localStorage.getItem(LOCAL_CHARGING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

import { key } from "@/lib/storage";
import type { StateLane } from "@shared/pulse-timeline";

export const pulseLaneKey = (lane: StateLane) => key("pulse", "v2", lane);
export const pulseLaneOpenKey = (lane: StateLane) => key("pulse", "v2", lane, "open");
export const pulseListeningTracesKey = () => key("pulse", "v2", "listening-traces");
export const pulseChargingKey = () => key("pulse", "v2", "charging");
export const pulseActivityKey = () => key("pulse", "v2", "activity");
export const pulseActivityRangeKey = () => key("pulse", "v2", "activity", "range");
export const pulseActivityRevisionKey = () => key("pulse", "v2", "activity", "revision");
export const pulseWorkoutsKey = () => key("pulse", "v2", "workouts");

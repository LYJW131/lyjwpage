import type { ChargerStatus, ChargingDeviceInfo, PowerBankStatus } from "@/lib/types";

// 公开的充电头、充电宝只挑这些字段：序列号等上报带来的多余字段一律不出去，存储里已有的也一样。
function publicDevice({ firmwareVersion, model }: ChargingDeviceInfo): ChargingDeviceInfo {
  return { firmwareVersion, model };
}

export function publicChargerStatus(status: ChargerStatus): ChargerStatus {
  const { connected, totalPower, maxPower, ports, device, cover, updatedAt } = status;
  return { connected, totalPower, maxPower, ports, device: publicDevice(device), cover, updatedAt };
}

export function publicPowerBankStatus(status: PowerBankStatus): PowerBankStatus {
  const { connected, battery, charging, timeToFullMinutes, thermalLimited, batteryHealth, inputPower, outputPower, temperatures, ports, device, updatedAt } = status;
  return { connected, battery, charging, timeToFullMinutes, thermalLimited, batteryHealth, inputPower, outputPower, temperatures, ports, device: publicDevice(device), updatedAt };
}

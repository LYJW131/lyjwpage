import type { ServerStatus } from "@/lib/types";

// 公开的落地节点只挑这些字段：上报带来的 publicIp 等多余字段一律不出去，可滞后层里已有的也一样。
export function publicServer(status: ServerStatus): ServerStatus {
  const {
    id, hostname, country, city, isp, asn, asnOrg, os, kernel, cpuCores, cpuUsagePercent, load1, load5, load15,
    memoryTotalBytes, memoryUsedBytes, memoryAvailableBytes, diskTotalBytes, diskUsedBytes, networkInterface,
    networkRxBytes, networkTxBytes, networkRxBytesPerSec, networkTxBytesPerSec, traffic, uptimeSeconds, observedAt,
  } = status;
  return {
    id, hostname, country, city, isp, asn, asnOrg, os, kernel, cpuCores, cpuUsagePercent, load1, load5, load15,
    memoryTotalBytes, memoryUsedBytes, memoryAvailableBytes, diskTotalBytes, diskUsedBytes, networkInterface,
    networkRxBytes, networkTxBytes, networkRxBytesPerSec, networkTxBytesPerSec, traffic: traffic ?? null, uptimeSeconds, observedAt,
  };
}

type Tier = { div: number; unit: string; digits: number };

// 内存和磁盘跟操作系统一样按 1024 进位；流量配额是十进制，用 DECIMAL_TIERS。
export const BINARY_TIERS: readonly Tier[] = [
  { div: 1024 ** 3, unit: "GB", digits: 1 },
  { div: 1024 ** 2, unit: "MB", digits: 0 },
];

export const DECIMAL_TIERS: readonly Tier[] = [
  { div: 1e12, unit: "TB", digits: 2 },
  { div: 1e9, unit: "GB", digits: 1 },
  { div: 1e6, unit: "MB", digits: 0 },
];

function tierFor(tiers: readonly Tier[], bytes: number): Tier {
  return tiers.find((tier) => bytes >= tier.div) ?? tiers[tiers.length - 1];
}

function formatIn(tier: Tier, bytes: number): string {
  return `${(bytes / tier.div).toFixed(tier.digits)} ${tier.unit}`;
}

export function formatBytes(tiers: readonly Tier[], bytes: number): string {
  return formatIn(tierFor(tiers, bytes), bytes);
}

export function formatBytePair(tiers: readonly Tier[], used: number, total: number): string {
  const tier = tierFor(tiers, total);
  return `${(used / tier.div).toFixed(tier.digits)} / ${formatIn(tier, total)}`;
}

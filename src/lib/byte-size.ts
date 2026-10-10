type Tier = { div: number; unit: string; digits: number };

// 内存和磁盘跟操作系统一样按 1024 进位；流量配额是十进制，不走这里。
const BINARY_TIERS: readonly Tier[] = [
  { div: 1024 ** 3, unit: "GB", digits: 1 },
  { div: 1024 ** 2, unit: "MB", digits: 0 },
];

function tierIndex(bytes: number): number {
  const found = BINARY_TIERS.findIndex((tier) => bytes >= tier.div);
  return found < 0 ? BINARY_TIERS.length - 1 : found;
}

function formatBinary(bytes: number, tier: Tier): string {
  return `${(bytes / tier.div).toFixed(tier.digits)} ${tier.unit}`;
}

export function formatBinaryPair(used: number, total: number): string {
  const tier = BINARY_TIERS[tierIndex(total)];
  return `${(used / tier.div).toFixed(tier.digits)} / ${formatBinary(total, tier)}`;
}

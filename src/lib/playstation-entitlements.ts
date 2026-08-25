/** 当前这份 entitlement 来自 Plus 会员库，不是买断。 */
export function plusCatalog(service: string | null | undefined): boolean {
  return service === "ps_plus";
}

/** 合并多条 SKU 时 Plus 权益优先；其余原样保留第一条非空。 */
export function foldService(
  ...values: Array<string | null | undefined>
): string | null {
  if (values.some((value) => value === "ps_plus")) return "ps_plus";
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

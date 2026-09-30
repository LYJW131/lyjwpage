export function plusCatalog(service: string | null | undefined): boolean {
  return service === "ps_plus";
}

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

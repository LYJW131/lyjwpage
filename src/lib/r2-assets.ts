export function r2OriginUrl(objectKey: string): string | null {
  const base = process.env.R2_PUBLIC_BASE_URL;
  return base ? `${base.replace(/\/+$/, "")}/${objectKey}` : null;
}

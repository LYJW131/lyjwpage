import { ImagePolicyError, fetchImageUpstream, parseImageSource, readImageBytes } from "@/lib/image-proxy";

export async function remoteImageDataUri(raw: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const source = parseImageSource(raw);
  if (!source) throw new ImagePolicyError("source");
  const response = await fetchImageUpstream(source, fetchImpl);
  const bytes = await readImageBytes(response);
  const type = response.headers.get("Content-Type") ?? "application/octet-stream";
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

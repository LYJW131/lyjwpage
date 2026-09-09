import { createHash, createHmac, randomUUID } from "node:crypto";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g,
  (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/** Alibaba Cloud ACS3 signature; query values are already serialized per API metadata. */
export function signAliyunRequest(options: {
  endpoint: string;
  action: string;
  version: string;
  query: Record<string, string>;
  accessKeyId: string;
  accessKeySecret: string;
  date?: string;
  nonce?: string;
}): { url: string; headers: Record<string, string> } {
  const query = Object.keys(options.query).sort()
    .map((key) => `${encode(key)}=${encode(options.query[key])}`).join("&");
  const payloadHash = sha256("");
  const headers: Record<string, string> = {
    host: options.endpoint,
    "x-acs-action": options.action,
    "x-acs-content-sha256": payloadHash,
    "x-acs-date": options.date ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    "x-acs-signature-nonce": options.nonce ?? randomUUID(),
    "x-acs-version": options.version,
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const canonical = ["POST", "/", query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const signature = createHmac("sha256", options.accessKeySecret)
    .update(`ACS3-HMAC-SHA256\n${sha256(canonical)}`).digest("hex");
  headers.authorization = `ACS3-HMAC-SHA256 Credential=${options.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;
  return { url: `https://${options.endpoint}/?${query}`, headers };
}

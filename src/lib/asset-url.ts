/** R2/COS 共用的内容寻址图片对象键。 */
export const IMAGE_OBJECT_KEY = /^[a-f0-9]{64}\.(?:png|webp)$/;

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

export function assetUrl(base: string, objectKey: string): string {
  return `${trimSlash(base)}/${objectKey}`;
}

/**
 * 实时事件由接收上报的部署发出，里面的 URL 可能使用它自己的交付域。
 * 内容键固定在路径末段，客户端据此换成本页部署注入的公开地址。
 */
export function objectKeyFromAssetUrl(url: string): string | null {
  try {
    const objectKey = new URL(url).pathname.split("/").pop();
    return objectKey && IMAGE_OBJECT_KEY.test(objectKey) ? objectKey : null;
  } catch {
    return null;
  }
}

export const IMAGE_OBJECT_KEY = /^[a-f0-9]{64}\.(?:png|webp|jpe?g)$/;

export const IMAGE_PATH_PREFIX = "/img";

export function publicAssetPath(objectKey: string): string {
  return `${IMAGE_PATH_PREFIX}/${objectKey}`;
}

export function objectKeyFromAssetUrl(url: string): string | null {
  const objectKey = url.split(/[?#]/, 1)[0].split("/").pop();
  return objectKey && IMAGE_OBJECT_KEY.test(objectKey) ? objectKey : null;
}

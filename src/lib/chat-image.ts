import { GOD_CHAT_IMAGE_LIMITS, isGodChatImageType, type GodChatImage } from "@shared/god-chat";

export type ChatAttachment = { image: GodChatImage; preview: string };

export class ChatImageError extends Error {}

// 第二档质量只在第一档超限时用；仍超限就拒，不再往下压。
const JPEG_QUALITIES = [0.85, 0.6];

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// 一律经 canvas 重编码成 JPEG：EXIF（含定位）随之丢掉，GIF 只取第一帧。
export async function prepareChatImage(file: File): Promise<ChatAttachment> {
  if (!isGodChatImageType(file.type)) throw new ChatImageError("Unsupported image format. Use JPEG, PNG, WebP or GIF.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ChatImageError("Couldn't read that image.");
  }
  const scale = Math.min(1, GOD_CHAT_IMAGE_LIMITS.maxEdgePx / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new ChatImageError("Couldn't read that image.");
  }
  // JPEG 没有透明通道，透明处不铺底会变黑。
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of JPEG_QUALITIES) {
    const blob = await encode(canvas, quality);
    if (!blob) throw new ChatImageError("Couldn't read that image.");
    if (blob.size > GOD_CHAT_IMAGE_LIMITS.maxBytes) continue;
    const preview = await dataUrl(blob).catch(() => null);
    if (!preview) throw new ChatImageError("Couldn't read that image.");
    return { image: { mediaType: "image/jpeg", data: preview.slice(preview.indexOf(",") + 1) }, preview };
  }
  throw new ChatImageError("Image is too large.");
}

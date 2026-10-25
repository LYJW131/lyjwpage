// 精灵 JSON 契约：base 与每帧都是 w*h 个字符，数字是 palette 下标、"." 透明；deltas[i] 是第 i+1 帧相对上一帧的改动，逗号分隔的「36 进制下标 + 新字符」。
export type PixelSprite = { w: number; h: number; fps: number; palette: string[]; base: string; deltas: string[] };

const cell = (c: string) => (c === "." ? 255 : +c);

export function decodeFrames(sprite: PixelSprite): Uint8Array[] {
  const pixels = Uint8Array.from([...sprite.base].map(cell));
  const frames = [pixels.slice()];
  for (const delta of sprite.deltas) {
    if (delta)
      for (const entry of delta.split(",")) {
        const end = entry.length - 1;
        pixels[parseInt(entry.slice(0, end), 36)] = cell(entry[end]);
      }
    frames.push(pixels.slice());
  }
  return frames;
}

export function frameImages(sprite: PixelSprite): (index: number) => ImageData {
  const frames = decodeFrames(sprite);
  const rgb = sprite.palette.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const cache = new Map<number, ImageData>();
  return (index) => {
    const hit = cache.get(index);
    if (hit) return hit;
    const img = new ImageData(sprite.w, sprite.h);
    const data = frames[index];
    for (let i = 0; i < data.length; i++) {
      if (data[i] === 255) continue;
      const [r, g, b] = rgb[data[i]];
      img.data.set([r, g, b, 255], 4 * i);
    }
    cache.set(index, img);
    return img;
  };
}

export function frameCanvases(sprite: PixelSprite): (index: number) => HTMLCanvasElement {
  const image = frameImages(sprite);
  const cache = new Map<number, HTMLCanvasElement>();
  return (index) => {
    const hit = cache.get(index);
    if (hit) return hit;
    const c = document.createElement("canvas");
    c.width = sprite.w;
    c.height = sprite.h;
    c.getContext("2d")!.putImageData(image(index), 0, 0);
    cache.set(index, c);
    return c;
  };
}

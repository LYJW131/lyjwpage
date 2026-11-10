const SVG = "http://www.w3.org/2000/svg";

// 缝的形状：以 cx 为中心、半宽 half 的一段完全张开，两侧 fall 像素内按余弦收拢回一条线；amp 是张开的程度，over 让上沿在中心处多顶出去几像素。
export type RiftShape = { amp: number; cx: number; half: number; fall: number; over: number };

export function riftLines(band: HTMLElement) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;";
  const top = document.createElementNS(SVG, "path");
  const bottom = document.createElementNS(SVG, "path");
  for (const p of [top, bottom]) {
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "var(--color-line)");
    p.setAttribute("stroke-width", "1");
    svg.appendChild(p);
  }
  band.appendChild(svg);

  let shape: RiftShape = { amp: 0, cx: 0, half: 0, fall: 1, over: 0 };
  const size = () => ({ w: band.clientWidth, h: band.clientHeight });
  // 合上时两条线叠在带子正中那一像素上，和服务端画的那条线重合。
  const mid = () => Math.floor(size().h / 2) + 0.5;
  const reach = (x: number) => {
    const d = Math.abs(x - shape.cx);
    if (d <= shape.half) return 1;
    if (d >= shape.half + shape.fall) return 0;
    return 0.5 + 0.5 * Math.cos((Math.PI * (d - shape.half)) / shape.fall);
  };
  const topY = (x: number) => {
    const m = mid();
    const a = shape.amp * reach(x);
    return m - (m - 0.5 + shape.over * reach(x)) * a;
  };
  const bottomY = (x: number) => {
    const m = mid();
    return m + (size().h - 0.5 - m) * shape.amp * reach(x);
  };
  const samples = () => {
    const { w } = size();
    const xs = new Set<number>([0, w]);
    for (let x = 0; x <= w; x += 3) xs.add(x);
    for (const k of [-shape.half - shape.fall, -shape.half, shape.half, shape.half + shape.fall]) {
      const v = shape.cx + k;
      if (v > 0 && v < w) xs.add(v);
    }
    return [...xs].sort((a, b) => a - b);
  };
  const path = (fn: (x: number) => number) =>
    samples()
      .map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${fn(x).toFixed(2)}`)
      .join("");

  const draw = () => {
    top.setAttribute("d", path(topY));
    bottom.setAttribute("d", path(bottomY));
  };
  const ro = new ResizeObserver(draw);
  ro.observe(band);

  return {
    set(next: Partial<RiftShape>) {
      shape = { ...shape, ...next };
      draw();
    },
    bottomY,
    // 夹在两条线之间的区域，换成 dx、dy 偏移后的坐标系，给 clip-path 用；下沿多留一像素让脚踩住线。
    clip(dx: number, dy: number) {
      const xs = samples();
      const upper = xs.map((x) => `${(x - dx).toFixed(1)}px ${(topY(x) - dy).toFixed(1)}px`);
      const lower = xs.reverse().map((x) => `${(x - dx).toFixed(1)}px ${(bottomY(x) + 1 - dy).toFixed(1)}px`);
      return `polygon(${[...upper, ...lower].join(",")})`;
    },
    remove() {
      ro.disconnect();
      svg.remove();
    },
  };
}

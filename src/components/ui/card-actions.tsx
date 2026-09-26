"use client";

import { Expand, Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const PRESETS = [
  { label: "Square · 1080 × 1080", width: 1080, height: 1080 },
  { label: "Social · 1200 × 630", width: 1200, height: 630 },
  { label: "HD · 1920 × 1080", width: 1920, height: 1080 },
];

function validDimension(value: number) {
  return Number.isInteger(value) && value >= 320 && value <= 4096;
}

/** SVG-in-foreignObject loses CSS Color 4 (lab/oklch) and inherited theme vars.
 * Resolve only SVG paint to sRGB for the capture, then restore the live nodes. */
function prepareSvgPaint(card: HTMLElement): () => void {
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = 1;
  const context = colorCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) return () => {};
  const cache = new Map<string, string>();
  const toRgb = (value: string) => {
    if (!value || value === "none" || value.startsWith("url(")) return value;
    const cached = cache.get(value);
    if (cached) return cached;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    const result = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    cache.set(value, result);
    return result;
  };
  const paints = Array.from(card.querySelectorAll<SVGElement>("svg, svg *"), (element) => {
    const computed = getComputedStyle(element);
    return {
      element,
      values: ["color", "fill", "stroke", "stop-color"].map((property) => [property, computed.getPropertyValue(property)] as const),
      size: element instanceof SVGRectElement ? { width: computed.width, height: computed.height } : null,
    };
  });
  const saved: Array<{ element: SVGElement; property: string; value: string; priority: string }> = [];
  const sizes: Array<{ element: SVGRectElement; width: string | null; height: string | null }> = [];
  for (const { element, values, size } of paints) {
    for (const [property, value] of values) {
      if (!value || value === "none" || value.startsWith("url(")) continue;
      saved.push({ element, property, value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) });
      element.style.setProperty(property, toRgb(value), "important");
    }
    // Heatmap cell geometry lives in CSS; SVG-as-image needs explicit attributes.
    if (size && element instanceof SVGRectElement) {
      sizes.push({ element, width: element.getAttribute("width"), height: element.getAttribute("height") });
      element.setAttribute("width", size.width);
      element.setAttribute("height", size.height);
    }
  }
  return () => {
    for (const { element, property, value, priority } of saved) {
      if (value) element.style.setProperty(property, value, priority);
      else element.style.removeProperty(property);
    }
    for (const { element, width, height } of sizes) {
      if (width === null) element.removeAttribute("width"); else element.setAttribute("width", width);
      if (height === null) element.removeAttribute("height"); else element.setAttribute("height", height);
    }
  };
}

export function CardActions({ label }: { label: string }) {
  const expandRef = useRef<HTMLButtonElement>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1080);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onFullscreenChange = () => {
      const card = expandRef.current?.closest<HTMLElement>(".paper-card");
      const isThisCard = document.fullscreenElement === card;
      setExpanded(isThisCard);
      if (!document.fullscreenElement && card?.dataset.wasFullscreen === "true") {
        delete card.dataset.wasFullscreen;
        expandRef.current?.focus();
      }
    };
    const onFullscreenKey = (event: KeyboardEvent) => {
      const card = expandRef.current?.closest<HTMLElement>(".paper-card");
      if (event.key === "Escape" && document.fullscreenElement === card && !dialogRef.current?.open) {
        void document.exitFullscreen();
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("keydown", onFullscreenKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("keydown", onFullscreenKey);
    };
  }, []);

  useEffect(() => {
    if (!fallback) return;
    const card = expandRef.current?.closest<HTMLElement>(".paper-card");
    const expandButton = expandRef.current;
    if (!card) return;
    card.dataset.cardExpanded = "true";
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !dialogRef.current?.open) setFallback(false);
      if (event.key !== "Tab" || dialogRef.current?.open) return;
      const focusable = Array.from(card.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"))
        .filter((element) => element.getClientRects().length > 0 && !element.closest("[inert], dialog:not([open])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !card.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !card.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      delete card.dataset.cardExpanded;
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", onKeyDown);
      expandButton?.focus();
    };
  }, [fallback]);

  async function toggleExpand() {
    const card = expandRef.current?.closest<HTMLElement>(".paper-card");
    if (!card) return;
    setError("");
    try {
      if (fallback) { setFallback(false); return; }
      if (document.fullscreenElement === card) await document.exitFullscreen();
      else {
        card.dataset.wasFullscreen = "true";
        if (!card.requestFullscreen) { delete card.dataset.wasFullscreen; setFallback(true); return; }
        await card.requestFullscreen();
      }
    } catch {
      delete card.dataset.wasFullscreen;
      setFallback(true);
    }
  }

  function openExport() {
    const card = exportRef.current?.closest<HTMLElement>(".paper-card");
    if (card) {
      setWidth(Math.max(320, Math.min(4096, Math.round(card.getBoundingClientRect().width))));
      setHeight(Math.max(320, Math.min(4096, Math.round(card.getBoundingClientRect().height))));
    }
    setError("");
    dialogRef.current?.showModal();
  }

  async function exportPng() {
    if (!validDimension(width) || !validDimension(height)) {
      setError("Width and height must be whole pixels between 320 and 4096.");
      return;
    }
    const card = exportRef.current?.closest<HTMLElement>(".paper-card");
    if (!card) return;
    setBusy(true);
    setError("");
    try {
      await document.fonts.ready;
      const { toPng } = await import("html-to-image");
      const imageUrls = Array.from(card.querySelectorAll("img"), (image) => image.currentSrc || image.src).filter(Boolean);
      await Promise.all(imageUrls.map(async (url) => {
        const response = await fetch(url, { mode: "cors" });
        if (!response.ok) throw new Error("Image unavailable");
      }));
      const bounds = card.getBoundingClientRect();
      const scale = Math.min(width / bounds.width, height / bounds.height);
      const renderWidth = Math.max(1, Math.round(bounds.width * scale));
      const renderHeight = Math.max(1, Math.round(bounds.height * scale));
      const restoreSvg = prepareSvgPaint(card);
      let dataUrl: string;
      try {
        dataUrl = await toPng(card, {
          canvasWidth: renderWidth,
          canvasHeight: renderHeight,
          pixelRatio: 1,
          cacheBust: true,
          filter: (node) => !(node instanceof Element && node.hasAttribute("data-card-control")),
        });
      } finally {
        restoreSvg();
      }
      const link = document.createElement("a");
      if (!dataUrl.startsWith("data:image/png;base64,")) throw new Error("Invalid PNG");
      const rendered = new Image();
      rendered.src = dataUrl;
      await rendered.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = getComputedStyle(card).backgroundColor;
      context.fillRect(0, 0, width, height);
      context.drawImage(rendered, Math.round((width - renderWidth) / 2), Math.round((height - renderHeight) / 2), renderWidth, renderHeight);
      link.href = canvas.toDataURL("image/png");
      link.download = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card"}-${width}x${height}.png`;
      link.click();
      dialogRef.current?.close();
    } catch {
      setError("Export failed. Check that card images are available, then try again.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div data-card-control className="flex shrink-0 items-center gap-1">
      <button ref={expandRef} type="button" onClick={toggleExpand} aria-label={`${expanded || fallback ? "Exit fullscreen" : "Expand"} ${label}`} title={expanded || fallback ? "Exit fullscreen" : "Expand"} className="rounded p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
        {expanded || fallback ? <X size={14} aria-hidden /> : <Expand size={14} aria-hidden />}
      </button>
      <button ref={exportRef} type="button" onClick={openExport} aria-label={`Export ${label} as PNG`} title="Export PNG" className="rounded p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
        <Download size={14} aria-hidden />
      </button>
    </div>
    <dialog data-card-control ref={dialogRef} onClose={() => exportRef.current?.focus()} aria-label={`Export ${label}`} className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-line-strong bg-surface p-5 text-foreground shadow-xl backdrop:bg-black/60">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Export {label}</h2>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close export dialog" className="rounded p-1 hover:bg-muted"><X size={18} aria-hidden /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-muted-foreground">Width (px)<input type="number" min="320" max="4096" step="1" value={width} onChange={(event) => setWidth(Number(event.target.value))} className="mt-1 w-full rounded border border-line-strong bg-muted px-2 py-2 text-sm text-foreground" /></label>
          <label className="text-xs text-muted-foreground">Height (px)<input type="number" min="320" max="4096" step="1" value={height} onChange={(event) => setHeight(Number(event.target.value))} className="mt-1 w-full rounded border border-line-strong bg-muted px-2 py-2 text-sm text-foreground" /></label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">{PRESETS.map((preset) => <button key={preset.label} type="button" onClick={() => { setWidth(preset.width); setHeight(preset.height); }} className="rounded border border-line px-2 py-1 text-xs hover:bg-muted">{preset.label}</button>)}</div>
        {error && <p role="alert" className="mt-3 text-xs text-red-500">{error}</p>}
        <button type="button" disabled={busy || !validDimension(width) || !validDimension(height)} onClick={exportPng} className="mt-5 w-full rounded bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50">{busy ? "Exporting…" : "Download PNG"}</button>
      </dialog>
  </>;
}

"use client";

import { useEffect, useRef } from "react";

import styles from "./css-backdrop-demo.module.css";

/**
 * CSS backdrop-filter + 层叠高光的 Liquid Glass 演示。
 * 指针 / 触摸驱动高光，滚动驱动背景视差；无 SVG、无 WebGL。
 */
export function CssBackdropDemo() {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const root = stage;
    let raf = 0;
    let targetX = 0.52;
    let targetY = 0.38;
    let currentX = targetX;
    let currentY = targetY;
    let scrollY = 0;

    const paint = () => {
      raf = 0;
      currentX += (targetX - currentX) * 0.14;
      currentY += (targetY - currentY) * 0.14;
      root.style.setProperty("--ptr-x", currentX.toFixed(4));
      root.style.setProperty("--ptr-y", currentY.toFixed(4));
      root.style.setProperty("--scroll-y", `${scrollY.toFixed(1)}px`);
      if (
        Math.abs(targetX - currentX) > 0.0004 ||
        Math.abs(targetY - currentY) > 0.0004
      ) {
        raf = requestAnimationFrame(paint);
      }
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

    const onPointer = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      targetX = (event.clientX - rect.left) / rect.width;
      targetY = (event.clientY - rect.top) / rect.height;
      schedule();
    };

    const onScroll = () => {
      scrollY = window.scrollY;
      // 滚动时轻微拖动高光，模拟液面倾斜
      targetY = Math.min(0.92, Math.max(0.08, 0.32 + scrollY / 2400));
      schedule();
    };

    root.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    schedule();

    return () => {
      root.removeEventListener("pointermove", onPointer);
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={stageRef} className={styles.stage}>
      <div className={styles.sky} aria-hidden="true">
        <div className={`${styles.blob} ${styles.blobA}`} />
        <div className={`${styles.blob} ${styles.blobB}`} />
        <div className={`${styles.blob} ${styles.blobC}`} />
        <div className={styles.grid} />
        <div className={styles.ribbon} />
        <div className={styles.orb} />
      </div>

      <header className={styles.header}>
        <p className={styles.kicker}>技术演示 · CSS only</p>
        <h1 className={styles.title}>Liquid Glass</h1>
        <p className={styles.lead}>
          用 <code>backdrop-filter</code> 模糊背后场景，再叠半透明色层与跟随指针的镜面高光。
          桌面移动指针、手机滑动手指或上下滚动，观察液面高光与背景视差。
        </p>
      </header>

      <div className={styles.playground}>
        <article className={`${styles.glass} ${styles.panelHero}`}>
          <div className={styles.glassFill} />
          <div className={styles.glassSpecular} />
          <div className={styles.glassRim} />
          <div className={styles.glassContent}>
            <h2>层叠玻璃面板</h2>
            <p>
              底层：模糊 + 饱和；中层：冷暖半透明折射色；顶层：径向高光随指针滑动。
            </p>
            <div className={styles.chipRow}>
              <span className={`${styles.glass} ${styles.chip}`}>
                <span className={styles.glassFill} />
                <span className={styles.glassSpecular} />
                <span className={styles.glassRim} />
                <span className={styles.chipLabel}>blur</span>
              </span>
              <span className={`${styles.glass} ${styles.chip}`}>
                <span className={styles.glassFill} />
                <span className={styles.glassSpecular} />
                <span className={styles.glassRim} />
                <span className={styles.chipLabel}>saturate</span>
              </span>
              <span className={`${styles.glass} ${styles.chip}`}>
                <span className={styles.glassFill} />
                <span className={styles.glassSpecular} />
                <span className={styles.glassRim} />
                <span className={styles.chipLabel}>highlight</span>
              </span>
            </div>
          </div>
        </article>

        <aside className={`${styles.glass} ${styles.panelSide}`}>
          <div className={styles.glassFill} />
          <div className={styles.glassSpecular} />
          <div className={styles.glassRim} />
          <div className={styles.glassContent}>
            <h2>可拖动的液态按钮</h2>
            <p>嵌套更小的玻璃块，边缘用 inset 高光模拟厚度。</p>
            <button type="button" className={`${styles.glass} ${styles.cta}`}>
              <span className={styles.glassFill} />
              <span className={styles.glassSpecular} />
              <span className={styles.glassRim} />
              <span className={styles.ctaLabel}>按住感受高光</span>
            </button>
          </div>
        </aside>

        <div className={`${styles.glass} ${styles.floatPill}`} aria-hidden="true">
          <div className={styles.glassFill} />
          <div className={styles.glassSpecular} />
          <div className={styles.glassRim} />
          <div className={styles.pillGlyph} />
        </div>
      </div>

      <section className={styles.notes}>
        <div className={`${styles.glass} ${styles.noteCard}`}>
          <div className={styles.glassFill} />
          <div className={styles.glassSpecular} />
          <div className={styles.glassRim} />
          <div className={styles.glassContent}>
            <h2>实现要点</h2>
            <ul>
              <li>
                <code>backdrop-filter: blur() saturate() brightness()</code> 负责「透过玻璃看世界」
              </li>
              <li>半透明渐变叠色模拟折射染色，不依赖 SVG displacement</li>
              <li>径向高光与 inset 边光跟随 <code>--ptr-x / --ptr-y</code></li>
              <li>滚动写入 <code>--scroll-y</code>，背景色块做视差漂移</li>
            </ul>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <p>路由 <code>/demos/liquid-glass/css-backdrop</code> · 非 SVG / 非 WebGL</p>
      </footer>
    </div>
  );
}

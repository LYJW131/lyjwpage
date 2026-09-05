"use client";

import {
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import { ArrowRight, ArrowLeft, ArrowUpRight, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useExpiryRefetch, useStatus } from "@/hooks/use-status";
import { useLiveEvents } from "@/hooks/use-live-events";
import { NOW_LISTENING_PATH, LISTENING_PATH } from "@/lib/paths";
import type {
  ListeningPayload,
  NowListeningPayload,
  StatusResponse,
} from "@/lib/types";
import "./signal.css";
import "./scenes.css";

const scenes = [
  { id: "now", label: "此刻", en: "INDEX" },
  { id: "music", label: "音乐", en: "RECORDS" },
  { id: "cinema", label: "影像", en: "SCREENING" },
  { id: "games", label: "游戏", en: "COLLECTION" },
  { id: "systems", label: "动向", en: "TRANSMISSION" },
  { id: "about", label: "关于", en: "CONTACT" },
] as const;
type SceneId = (typeof scenes)[number]["id"];
function readScene(): SceneId {
  return scenes.find((s) => s.id === location.hash.slice(1))?.id ?? "now";
}
function subscribeScene(callback: () => void) {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  return () => {
    window.removeEventListener("hashchange", callback);
    window.removeEventListener("popstate", callback);
  };
}
const serverScene = (): SceneId => "now";

function Frequency({ active }: { active: boolean }) {
  return (
    <span className={`frequency ${active ? "active" : ""}`} aria-hidden="true">
      {Array.from({ length: 58 }, (_, i) => (
        <i
          key={i}
          style={
            {
              "--height": `${4 + ((i * 11) % 15)}px`,
              "--delay": `${-i * 0.067}s`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

/** Original vector scenery: monumental letterforms, perspective wires and print texture. */
function Scenery() {
  return (
    <div className="signal-scenery" aria-hidden="true">
      <svg
        className="monoliths"
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="monolith-face" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="currentColor" stopOpacity=".075" />
            <stop offset="1" stopColor="currentColor" stopOpacity=".015" />
          </linearGradient>
        </defs>
        <g fill="url(#monolith-face)" stroke="currentColor" strokeOpacity=".06">
          <path d="M580 -180 760 -180 320 1150 140 1150Z" />
          <path d="M865 20 1110 1020 910 1020 755 405Z" />
          <path d="M1280 -180 1510 -180 1080 1150 850 1150Z" />
          <path d="M1440 300 1670 1020 1485 1020 1350 540Z" />
        </g>
        <g
          className="scenery-wires"
          fill="none"
          stroke="currentColor"
          strokeWidth=".55"
          opacity=".065"
        >
          {Array.from({ length: 18 }, (_, i) => (
            <path
              key={i}
              d={`M-100 ${170 + i * 46} Q ${630 + i * 12} ${470 - i * 23} 1740 ${80 + i * 61}`}
            />
          ))}
        </g>
        <g stroke="currentColor" opacity=".065">
          <path d="M85 450h20m-10-10v20M1420 270h16m-8-8v16M1110 830h16m-8-8v16" />
        </g>
      </svg>
      <div className="print-grain" />
      <div className="print-dots" />
      <div className="scenery-vignette" />
    </div>
  );
}

export function SignalExperience({
  listening,
  nowListening,
  desktop,
  music,
  cinema,
  games,
  systems,
  about,
  footer,
}: {
  listening: StatusResponse<ListeningPayload>;
  nowListening: StatusResponse<NowListeningPayload>;
  desktop: ReactNode;
  music: ReactNode;
  cinema: ReactNode;
  games: ReactNode;
  systems: ReactNode;
  about: ReactNode;
  footer: ReactNode;
}) {
  useLiveEvents();
  const selected = useSyncExternalStore(subscribeScene, readScene, serverScene);
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const wheel = useRef({ sum: 0, last: 0, lockedUntil: 0 });
  const [infoOpen, setInfoOpen] = useState(false);
  const { data: recent } = useStatus<ListeningPayload>(
    LISTENING_PATH,
    600_000,
    { fallback: listening },
  );
  const { data: current, error } = useStatus<NowListeningPayload>(
    NOW_LISTENING_PATH,
    60_000,
    { fallback: nowListening },
  );
  useExpiryRefetch(NOW_LISTENING_PATH, current?.expiresInMs);
  const track =
    !error && current && !current.idle && current.music?.state !== "stopped"
      ? current.music
      : null;
  const title = track?.title ?? recent?.items[0]?.title ?? "等待下一段旋律";
  const index = scenes.findIndex((s) => s.id === selected);
  const slots = { music, cinema, games, systems, about };
  function navigate(id: SceneId, event?: MouseEvent<HTMLAnchorElement>) {
    if (
      event &&
      (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    )
      return;
    event?.preventDefault();
    if (id !== selected) {
      history.pushState(null, "", `#${id}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    setInfoOpen(false);
  }
  function change(step: number) {
    navigate(scenes[(index + step + scenes.length) % scenes.length].id);
  }
  function handleWheel(event: WheelEvent) {
    if (
      event.ctrlKey ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
      infoOpen
    )
      return;
    // Lists own their scrolling. The background and unused stage space turn pages.
    if (
      (event.target as Element).closest('[data-scroll], input, [role="dialog"]')
    )
      return;
    const now = performance.now();
    if (now < wheel.current.lockedUntil) return;
    if (now - wheel.current.last > 180) wheel.current.sum = 0;
    wheel.current.last = now;
    wheel.current.sum += event.deltaY;
    if (Math.abs(wheel.current.sum) > 100) {
      change(wheel.current.sum > 0 ? 1 : -1);
      wheel.current = { sum: 0, last: now, lockedUntil: now + 1100 };
    }
  }
  return (
    <div className={`signal-site is-${selected}`} onWheel={handleWheel}>
      <a
        className="signal-skip"
        href="#scene-content"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        跳至内容
      </a>
      <Scenery />
      <header className="signal-header">
        <a
          className="signal-brand"
          href="#now"
          aria-label="LYJW 首页"
          onClick={(e) => navigate("now", e)}
        >
          <span className="brand-symbol">
            <i />
            <i />
            <i />
          </span>
          <span className="brand-name">LYJW</span>
        </a>
        <a
          className="header-transmission"
          href="#music"
          onClick={(e) => navigate("music", e)}
          aria-label={`查看音乐：${title}`}
        >
          <Frequency active={track?.state === "playing"} />
          <span>{title}</span>
          <span className="corner-marks" />
        </a>
        <nav
          className="signal-nav"
          aria-label="场景导航"
          ref={navRef}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
              return;
            const links = Array.from(
              navRef.current?.querySelectorAll("a") ?? [],
            );
            const focused = links.indexOf(
              document.activeElement as HTMLAnchorElement,
            );
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? 5
                  : (focused + (e.key === "ArrowRight" ? 1 : -1) + 6) % 6;
            e.preventDefault();
            links[next]?.focus();
          }}
        >
          {scenes.map((s) => (
            <a
              href={`#${s.id}`}
              key={s.id}
              onClick={(e) => navigate(s.id, e)}
              aria-current={s.id === selected ? "page" : undefined}
            >
              <span data-text={s.label}>{s.label}</span>
              <small>{s.en}</small>
            </a>
          ))}
        </nav>
        <ThemeToggle />
      </header>
      <main
        id="scene-content"
        ref={mainRef}
        tabIndex={-1}
        className="signal-main"
      >
        <section
          className="signal-scene scene-now"
          hidden={selected !== "now"}
          aria-label="此刻"
        >
          <div className="index-copy">
            <span className="micro index-welcome">WELCOME TO MY EVERYDAY</span>
            <h1>
              <span className="index-logotype">
                LYJW<span>131</span>
              </span>
              <span className="index-wordmark">
                PERSONAL
                <br />
                RECORDS
              </span>
            </h1>
            <h2>日常档案</h2>
            <p>一 个 持 续 发 生 的 世 界</p>
            <a
              className="index-entry"
              href="#music"
              onClick={(e) => navigate("music", e)}
            >
              <span>
                {track ? "NOW PLAYING" : "LAST ON REPEAT"}
                <b>{title}</b>
              </span>
              <ArrowUpRight size={25} />
            </a>
          </div>
          <div className="index-coordinate">
            <span>PRIVATE LIFE / PUBLIC FREQUENCY</span>
            <span>01 — ∞</span>
          </div>
          <div className="index-desktop">
            <span className="micro">ON MY DESK</span>
            {desktop}
          </div>
        </section>
        {scenes.slice(1).map((s) => (
          <section
            key={s.id}
            className={`signal-scene scene-${s.id}`}
            hidden={selected !== s.id}
            aria-label={s.label}
          >
            {slots[s.id as keyof typeof slots]}
          </section>
        ))}
      </main>
      <aside className="scene-rail" aria-label="快速切换场景">
        {scenes.map((s, i) => (
          <button
            key={s.id}
            aria-label={s.label}
            aria-current={s.id === selected ? "page" : undefined}
            onClick={() => navigate(s.id)}
          >
            <span>0{i + 1}</span>
            <i />
          </button>
        ))}
      </aside>
      <footer className="signal-footer">
        <span className="footer-motto">A LIFE FAMILIARLY UNKNOWN</span>
        <button
          className="site-info-toggle"
          onClick={() => setInfoOpen(!infoOpen)}
          aria-expanded={infoOpen}
        >
          站点信息
        </button>
        <div className="scene-pagination">
          <button onClick={() => change(-1)} aria-label="上一个场景">
            <ArrowLeft size={25} />
          </button>
          <span>
            <b>0{index + 1}</b> / 06
          </span>
          <button onClick={() => change(1)} aria-label="下一个场景">
            {index === 0 ? "EXPLORE" : "NEXT"}
            <ArrowRight size={32} />
          </button>
        </div>
      </footer>
      <div
        className="site-info-panel"
        hidden={!infoOpen}
        role="dialog"
        aria-label="站点信息"
      >
        <button aria-label="关闭站点信息" onClick={() => setInfoOpen(false)}>
          <X size={20} />
        </button>
        {footer}
      </div>
    </div>
  );
}

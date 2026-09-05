"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { exhibitDetail, exhibitHash } from "@/lib/signal-presentation";

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  return () => {
    window.removeEventListener("hashchange", callback);
    window.removeEventListener("popstate", callback);
  };
}

const serverDetail = () => null;

const compactQuery = "(min-width: 801px) and (max-height: 800px)";
function subscribeCompact(callback: () => void) {
  const query = matchMedia(compactQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const readCompact = () => matchMedia(compactQuery).matches;
const serverCompact = () => false;
export function useCompactExhibit() {
  return useSyncExternalStore(subscribeCompact, readCompact, serverCompact);
}

/** Detail is a browser-history level; pagination replaces that level. */
export function useExhibitDetail(
  scene: "music" | "games",
  enabled: boolean,
  knownIds: readonly string[] | null,
) {
  const read = useCallback(
    () => (enabled ? exhibitDetail(location.hash, scene) : null),
    [enabled, scene],
  );
  const rawId = useSyncExternalStore(subscribe, read, serverDetail);
  const invalid =
    rawId !== null && knownIds !== null && !knownIds.includes(rawId);
  const id = invalid ? null : rawId;
  const rootRef = useRef<HTMLDivElement>(null);
  const previous = useRef<string | null>(null);
  const origin = useRef<{
    trigger: HTMLElement | null;
    main: number;
    matrix: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!invalid) return;
    history.replaceState(history.state, "", `#${scene}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, [invalid, scene]);

  const open = useCallback(
    (next: string) => {
      const current = exhibitDetail(location.hash, scene);
      if (!current) {
        origin.current = {
          trigger:
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null,
          main: document.getElementById("scene-content")?.scrollTop ?? 0,
          matrix:
            rootRef.current?.querySelector(".cover-matrix")?.scrollTop ?? 0,
        };
        history.pushState(
          { ...history.state, exhibitParent: scene },
          "",
          exhibitHash(scene, next),
        );
      } else {
        history.replaceState(history.state, "", exhibitHash(scene, next));
      }
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    },
    [scene],
  );

  const close = useCallback(() => {
    if (!exhibitDetail(location.hash, scene)) return;
    if (history.state?.exhibitParent === scene) history.back();
    else {
      history.replaceState(history.state, "", `#${scene}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  }, [scene]);

  useLayoutEffect(() => {
    const wasOpen = previous.current !== null;
    previous.current = id;
    const main = document.getElementById("scene-content");
    if (id && !wasOpen) {
      main?.scrollTo({ top: 0, behavior: "instant" });
      rootRef.current
        ?.querySelector<HTMLElement>(".detail-back")
        ?.focus({ preventScroll: true });
    } else if (!id && wasOpen && location.hash.split("?")[0] === `#${scene}`) {
      main?.scrollTo({ top: origin.current?.main ?? 0, behavior: "instant" });
      rootRef.current
        ?.querySelector(".cover-matrix")
        ?.scrollTo({ top: origin.current?.matrix ?? 0, behavior: "instant" });
      const trigger = origin.current?.trigger;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else
        rootRef.current
          ?.querySelector<HTMLElement>(".matrix-item")
          ?.focus({ preventScroll: true });
    }
  }, [id, scene]);

  const attachRoot = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
  }, []);
  return { id, open, close, attachRoot };
}

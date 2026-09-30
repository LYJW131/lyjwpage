"use client";

import { createContext, useContext, type ReactNode } from "react";

import { WebPlayerDialog } from "@/components/web-player/web-player-dialog";
import { useWebPlayerState, type WebPlayer } from "@/hooks/use-web-player";

const WebPlayerContext = createContext<WebPlayer | null>(null);

export function WebPlayerProvider({ children }: { children: ReactNode }) {
  const player = useWebPlayerState();

  return (
    <WebPlayerContext.Provider value={player}>
      {children}
      {player.open && player.item ? (
        <WebPlayerDialog key={player.item.id} player={player} />
      ) : null}
    </WebPlayerContext.Provider>
  );
}

export function useWebPlayer(): WebPlayer | null {
  return useContext(WebPlayerContext);
}

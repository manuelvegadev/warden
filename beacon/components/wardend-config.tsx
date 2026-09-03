"use client";

import { createContext, useContext } from "react";

const WardendConfig = createContext<{ wsUrl: string }>({ wsUrl: "ws://localhost:8080" });

/** Runtime values the browser needs about wardend, read by the (dynamic) dashboard layout on the server. */
export function WardendConfigProvider({ wsUrl, children }: { wsUrl: string; children: React.ReactNode }) {
  return <WardendConfig.Provider value={{ wsUrl }}>{children}</WardendConfig.Provider>;
}

/** wardend's public origin as a WebSocket URL (`ws://host:port`), the base of every socket endpoint. */
export function useWardendBaseUrl() {
  return useContext(WardendConfig).wsUrl;
}

/** The hub endpoint. The JWT is sent as the first message (see useWardendSocket), never in the URL. */
export function useWardendWsUrl() {
  return `${useWardendBaseUrl()}/api/v1/ws`;
}

/**
 * What players type in the Minecraft client: the daemon's public host plus the instance port
 * (dropped when it is the default 25565, which the client assumes).
 */
export function useServerAddress(port: number) {
  const host = new URL(useContext(WardendConfig).wsUrl).hostname;
  return port === 25565 ? host : `${host}:${port}`;
}

"use client";

import { createContext, useContext } from "react";

const WardendConfig = createContext<{ wsUrl: string }>({ wsUrl: "ws://localhost:8080" });

/** Runtime values the browser needs about wardend, read by the (dynamic) dashboard layout on the server. */
export function WardendConfigProvider({ wsUrl, children }: { wsUrl: string; children: React.ReactNode }) {
  return <WardendConfig.Provider value={{ wsUrl }}>{children}</WardendConfig.Provider>;
}

/** wardend WebSocket endpoint. The JWT is sent as the first message (see useWardendSocket), never in the URL. */
export function useWardendWsUrl() {
  return `${useContext(WardendConfig).wsUrl}/api/v1/ws`;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWardendWsUrl } from "@/components/wardend-config";
import { authClient } from "@/lib/auth-client";

export type WsMessage = { type: string; instance?: string; data?: unknown };
type Handler = (msg: WsMessage) => void;

/**
 * One WebSocket per page to wardend. Auth: fetch a short-lived JWT from Better Auth and send it as the
 * first message (docs/security.md). Reconnects with backoff. Subscriptions are re-sent after reconnect.
 */
export function useWardendSocket(instanceIds: string[], onMessage: Handler) {
  const url = useWardendWsUrl();
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onMessage);
  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);
  const idsKey = instanceIds.join(",");

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
      if (closed) return;
      const { data } = await authClient.token();
      if (!data?.token || closed) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: data.token }));
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as WsMessage;
        if (msg.type === "auth.ok") {
          attempt = 0;
          setConnected(true);
          for (const id of idsKey.split(",").filter(Boolean)) {
            ws.send(JSON.stringify({ type: "subscribe", instance: id }));
          }
          return;
        }
        handlerRef.current(msg);
      };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (closed) return;
        attempt += 1;
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt));
      };
      ws.onerror = () => ws.close();
    }
    void connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [idsKey, url]);

  const send = useCallback((msg: WsMessage & { data?: unknown }) => {
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  return { connected, send };
}

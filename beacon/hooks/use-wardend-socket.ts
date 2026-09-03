"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWardendWsUrl } from "@/components/wardend-config";
import { WardendSocket, type WsMessage } from "@/lib/wardend-socket";

export type { WsMessage };

type Handler = (msg: WsMessage) => void;

/**
 * One WebSocket per page to wardend (the hub). Auth and reconnects are `WardendSocket`'s;
 * subscriptions are re-sent after every reconnect.
 */
export function useWardendSocket(instanceIds: string[], onMessage: Handler) {
  const url = useWardendWsUrl();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WardendSocket | null>(null);
  const handlerRef = useRef(onMessage);
  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);
  const idsKey = instanceIds.join(",");

  useEffect(() => {
    const socket = new WardendSocket(url, {
      onAuthOk: (ws) => {
        setConnected(true);
        for (const id of idsKey.split(",").filter(Boolean)) {
          ws.send(JSON.stringify({ type: "subscribe", instance: id }));
        }
      },
      onMessage: (msg) => {
        if (!(msg instanceof ArrayBuffer)) handlerRef.current(msg);
      },
      onClose: () => setConnected(false),
    });
    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [idsKey, url]);

  const send = useCallback((msg: WsMessage & { data?: unknown }) => {
    socketRef.current?.send(msg);
  }, []);

  return { connected, send };
}

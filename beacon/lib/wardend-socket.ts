import { authClient } from "@/lib/auth-client";

export type WsMessage = { type: string; instance?: string; data?: unknown };

export interface WardendSocketHandlers {
  /** The daemon accepted the token: subscribe, or send the next hello, from here. */
  onAuthOk: (ws: WebSocket) => void;
  /** Every other message: parsed JSON for text frames, the raw buffer for binary ones. */
  onMessage: (msg: WsMessage | ArrayBuffer) => void;
  /** The socket dropped (a reconnect follows unless `close()` was called). */
  onClose?: () => void;
}

/**
 * A WebSocket to wardend with the panel's auth and reconnect policy (docs/security.md): fetch a
 * short-lived JWT from Better Auth, send it as the first message, and back off exponentially (capped
 * at 30 s) after a drop or a failed token fetch. `useWardendSocket` wraps it for the hub; the voice
 * socket composes it.
 */
export class WardendSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly url: string,
    private readonly handlers: WardendSocketHandlers,
    private readonly binary = false,
  ) {}

  connect(): void {
    this.closed = false;
    void this.open();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.ws?.close();
    this.ws = null;
  }

  send(msg: unknown): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private async open(): Promise<void> {
    if (this.closed) return;
    const { data } = await authClient.token();
    if (this.closed) return;
    if (!data?.token) {
      this.retry();
      return;
    }
    const ws = new WebSocket(this.url);
    if (this.binary) ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: data.token }));
    ws.onmessage = (ev: MessageEvent<ArrayBuffer | string>) => {
      if (ev.data instanceof ArrayBuffer) {
        this.handlers.onMessage(ev.data);
        return;
      }
      const msg = JSON.parse(ev.data) as WsMessage;
      if (msg.type === "auth.ok") {
        this.attempt = 0;
        this.handlers.onAuthOk(ws);
        return;
      }
      this.handlers.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.handlers.onClose?.();
      this.retry();
    };
    ws.onerror = () => ws.close();
  }

  private retry(): void {
    if (this.closed) return;
    this.attempt += 1;
    this.timer = setTimeout(() => void this.open(), Math.min(30_000, 1000 * 2 ** this.attempt));
  }
}

import { WardendSocket } from "@/lib/wardend-socket";
import { parseVoiceFrame, type VoiceFrame } from "./frames";

export type VoiceSocketState = "connecting" | "open" | "closed";

export interface VoiceSocketHandlers {
  onFrame: (frame: VoiceFrame) => void;
  onState: (state: VoiceSocketState) => void;
  /** An `error` message from the daemon (it closes the socket right after). */
  onError?: (message: string) => void;
}

/** The daemon's voice socket for one instance, from the base URL `useWardendBaseUrl()` returns. */
export function voiceSocketUrl(baseUrl: string, instanceId: string): string {
  return `${baseUrl}/api/v1/instances/${encodeURIComponent(instanceId)}/voice/ws`;
}

/** Keepalive period; the daemon answers `ping` with `pong`. */
const PING_MS = 25_000;

/**
 * The voice WebSocket (ADR-019 §3): one per instance while the viewer listens. On top of the
 * panel's socket (auth, reconnects), `voice.hello` opens the stream; binary frames are the agent's
 * kind-2 voice frames relayed untouched. Status travels on the hub, not here.
 */
export class VoiceSocket {
  private readonly socket: WardendSocket;
  private ping: ReturnType<typeof setInterval> | undefined;

  constructor(url: string, handlers: VoiceSocketHandlers) {
    this.socket = new WardendSocket(
      url,
      {
        onAuthOk: (ws) => ws.send(JSON.stringify({ type: "voice.hello", listen: true })),
        onMessage: (msg) => {
          if (msg instanceof ArrayBuffer) {
            try {
              handlers.onFrame(parseVoiceFrame(msg));
            } catch (e) {
              console.warn("voice:", e);
            }
            return;
          }
          switch (msg.type) {
            case "voice.ok":
              handlers.onState("open");
              this.startPing();
              break;
            case "error":
              handlers.onError?.((msg as { message?: string }).message ?? "voice error");
              break;
          }
        },
        onClose: () => {
          this.stopPing();
          handlers.onState("connecting");
        },
      },
      true,
    );
    this.handlers = handlers;
  }

  private readonly handlers: VoiceSocketHandlers;

  connect(): void {
    this.handlers.onState("connecting");
    this.socket.connect();
  }

  close(): void {
    this.stopPing();
    this.socket.close();
    this.handlers.onState("closed");
  }

  private startPing(): void {
    this.stopPing();
    this.ping = setInterval(() => this.socket.send({ type: "ping" }), PING_MS);
  }

  private stopPing(): void {
    if (this.ping) clearInterval(this.ping);
    this.ping = undefined;
  }
}

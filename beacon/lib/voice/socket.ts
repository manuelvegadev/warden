import { WardendSocket } from "@/lib/wardend-socket";
import { parseVoiceFrame, type VoiceFrame } from "./frames";

export type VoiceSocketState = "connecting" | "open" | "closed";

export interface VoiceSocketHandlers {
  onFrame: (frame: VoiceFrame) => void;
  onState: (state: VoiceSocketState) => void;
  /** An `error` message from the daemon (it closes the socket right after). */
  onError?: (message: string) => void;
}

export interface VoiceSocketOptions {
  /** Hear the players (needs `manager`); toggled later with `setListening`. */
  listen: boolean;
  /** Be allowed to speak (needs `operator`); frames flow while `setSpeaking(true)`. */
  speak: boolean;
}

/** The daemon's voice socket for one instance, from the base URL `useWardendBaseUrl()` returns. */
export function voiceSocketUrl(baseUrl: string, instanceId: string): string {
  return `${baseUrl}/api/v1/instances/${encodeURIComponent(instanceId)}/voice/ws`;
}

/** Keepalive period; the daemon answers `ping` with `pong`. */
const PING_MS = 25_000;

/**
 * The voice WebSocket (ADR-019 §3): one per instance while the viewer listens or speaks. On top of
 * the panel's socket (auth, reconnects), `voice.hello` opens the stream with what this session
 * wants; binary frames down are the agent's kind-2 voice frames relayed untouched, binary frames
 * up are kind-3 speak bodies. The listen and speak states are kept here so a reconnect restores
 * them. Status travels on the hub, not here.
 */
export class VoiceSocket {
  private readonly socket: WardendSocket;
  private readonly handlers: VoiceSocketHandlers;
  private ping: ReturnType<typeof setInterval> | undefined;
  private listening: boolean;
  private readonly speak: boolean;
  private speaking = false;
  private open = false;

  constructor(url: string, options: VoiceSocketOptions, handlers: VoiceSocketHandlers) {
    this.handlers = handlers;
    this.listening = options.listen;
    this.speak = options.speak;
    this.socket = new WardendSocket(
      url,
      {
        onAuthOk: (ws) => ws.send(JSON.stringify({ type: "voice.hello", listen: this.listening, speak: this.speak })),
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
              this.open = true;
              handlers.onState("open");
              this.startPing();
              // A reconnect mid-sentence: the daemon needs to hear the press again.
              if (this.speaking) this.socket.send({ type: "voice.speak", active: true });
              break;
            case "error":
              handlers.onError?.((msg as { message?: string }).message ?? "voice error");
              break;
          }
        },
        onClose: () => {
          this.open = false;
          this.stopPing();
          handlers.onState("connecting");
        },
      },
      true,
    );
  }

  connect(): void {
    this.handlers.onState("connecting");
    this.socket.connect();
  }

  close(): void {
    this.stopPing();
    this.socket.close();
    this.open = false;
    this.handlers.onState("closed");
  }

  /** Start or stop hearing the players; the daemon tells them and switches the agent's forwarding. */
  setListening(active: boolean): void {
    if (this.listening === active) return;
    this.listening = active;
    if (this.open) this.socket.send({ type: "voice.listen", active });
  }

  /** Push-to-talk pressed or released: a speak session on the daemon, the in-game notice, the audit event. */
  setSpeaking(active: boolean): void {
    if (this.speaking === active) return;
    this.speaking = active;
    if (this.open) this.socket.send({ type: "voice.speak", active });
  }

  /** One kind-3 body (`encodeSpeakBody`); dropped while the socket is not open. */
  sendBody(body: ArrayBuffer): void {
    if (this.open) this.socket.sendRaw(body);
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

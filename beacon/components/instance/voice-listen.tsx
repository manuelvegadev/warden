"use client";

import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { cn } from "@warden/ui/lib/utils";
import { Headphones } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useInstance } from "@/components/instance/instance-context";
import { useWardendBaseUrl } from "@/components/wardend-config";
import type { WsMessage } from "@/hooks/use-wardend-socket";
import { can } from "@/lib/access";
import { ApiError, instances, type VoiceStatus } from "@/lib/api";
import { VoiceReceiver } from "@/lib/voice/receiver";
import { VoiceSocket, type VoiceSocketState, voiceSocketUrl } from "@/lib/voice/socket";
import { VOICE_UNSUPPORTED, voiceSupported } from "@/lib/voice/support";

/**
 * The instance's voice status (ADR-019): fetched once, then kept current from the hub's
 * `voice.status` messages. `null` until known, or when the daemon has no voice for this instance.
 */
export function useVoiceStatus(id: string): VoiceStatus | null {
  const { subscribe } = useInstance();
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    instances
      .voice(id)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((e) => {
        if (cancelled || (e instanceof ApiError && e.status === 404)) return;
        console.warn("voice status:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  useEffect(
    () =>
      subscribe((msg: WsMessage) => {
        if (msg.type === "voice.status") setStatus(msg.data as VoiceStatus);
      }),
    [subscribe],
  );
  return status;
}

export interface VoiceListen {
  /** The socket is open (or reconnecting) and the receiver is playing. */
  listening: boolean;
  state: VoiceSocketState;
  /** Starts from a click (the AudioContext needs the gesture) or stops. */
  toggle: () => void;
  /** UUIDs of the players heard in the last moments; empty when not listening. */
  speaking: () => Set<string>;
}

/** Owns the voice socket and the receiver for one instance; both go away with the component. */
export function useVoiceListen(id: string): VoiceListen {
  const baseUrl = useWardendBaseUrl();
  const url = useMemo(() => voiceSocketUrl(baseUrl, id), [baseUrl, id]);
  // "closed" is the only state without a socket, so `listening` is derived rather than kept.
  const [state, setState] = useState<VoiceSocketState>("closed");
  const socketRef = useRef<VoiceSocket | null>(null);
  const receiverRef = useRef<VoiceReceiver | null>(null);

  const stop = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    receiverRef.current?.stop();
    receiverRef.current = null;
    setState("closed");
  }, []);

  const start = useCallback(async () => {
    const receiver = new VoiceReceiver();
    receiverRef.current = receiver;
    try {
      await receiver.start();
    } catch (e) {
      receiverRef.current = null;
      toast.error(e instanceof Error ? e.message : "Could not start audio");
      return;
    }
    const socket = new VoiceSocket(url, {
      onFrame: (f) => receiverRef.current?.push(f),
      onState: setState,
      onError: (message) => {
        toast.error(message);
        stop();
      },
    });
    socketRef.current = socket;
    socket.connect();
  }, [url, stop]);

  const toggle = useCallback(() => {
    if (socketRef.current) stop();
    else void start();
  }, [start, stop]);

  // The instance changed or the view went away: nothing keeps playing.
  useEffect(() => stop, [stop]);

  const speaking = useCallback(() => receiverRef.current?.speaking() ?? new Set<string>(), []);
  return { listening: state !== "closed", state, toggle, speaking };
}

/**
 * The "Listen" toggle for the live view's toolbar, or the hint explaining why there is none:
 * the browser lacks WebCodecs, or Simple Voice Chat is not on the server.
 */
export function VoiceListenButton({
  status,
  listen,
  className,
}: {
  status: VoiceStatus | null;
  listen: VoiceListen;
  className?: string;
}) {
  const { role } = useInstance();
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(voiceSupported()), []);
  if (!can(role, "voice.listen") || status === null || supported === null) return null;
  if (!supported) {
    return <span className={cn("text-xs text-muted-foreground", className)}>{VOICE_UNSUPPORTED}</span>;
  }
  if (!status.available) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>Install Simple Voice Chat to enable voice</span>
    );
  }
  const busy = listen.listening && listen.state !== "open";
  return (
    <Button
      size="sm"
      variant={listen.listening ? "secondary" : "outline"}
      onClick={listen.toggle}
      aria-pressed={listen.listening}
      title={
        listen.listening
          ? "Stop listening to the players' voice chat"
          : "Hear the players' voice chat; they are told you are listening"
      }
      className={cn(busy && "animate-pulse", className)}
    >
      <Headphones data-icon="inline-start" className={cn(listen.listening && "text-emerald-500")} />
      {listen.listening ? "Listening" : "Listen"}
    </Button>
  );
}

/** Who is listening from Beacon right now, for every viewer of the instance. */
export function VoiceListenersPill({ status, className }: { status: VoiceStatus | null; className?: string }) {
  if (!status?.listeners.length) return null;
  const names = status.listeners.join(", ");
  return (
    <Badge
      variant="secondary"
      className={cn("gap-1 bg-background/80 backdrop-blur", className)}
      title={`${names} listening`}
    >
      <Headphones className="size-3" aria-hidden="true" />
      {names} listening
    </Badge>
  );
}

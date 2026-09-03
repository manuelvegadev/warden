package io.github.manuelvega.warden.agent;

/**
 * How players learn, in-game, that somebody in Beacon is listening to the voice chat (ADR-019). One
 * implementation per rendering; every method runs on the main thread.
 */
public interface VoiceNotifier {
    /** A session started (or its owner changed). */
    void start(String by);

    /** The session ended. */
    void stop();
}

package io.github.manuelvega.warden.agent;

/**
 * How players learn, in-game, that somebody in Beacon is listening to or speaking into the voice
 * chat (ADR-019). One implementation per rendering; every method runs on the main thread.
 */
public interface VoiceNotifier {
    /** Who is listening now, as one display string; empty when nobody is. */
    void listening(String by);

    /** Somebody started ({@code on}) or stopped speaking. */
    void speaking(String by, boolean on);

    /** Everything off: the plugin is disabling. */
    void stop();

    /** Every rendering at once, in order. */
    static VoiceNotifier all(VoiceNotifier... notifiers) {
        return new VoiceNotifier() {
            @Override
            public void listening(String by) {
                for (VoiceNotifier n : notifiers) {
                    n.listening(by);
                }
            }

            @Override
            public void speaking(String by, boolean on) {
                for (VoiceNotifier n : notifiers) {
                    n.speaking(by, on);
                }
            }

            @Override
            public void stop() {
                for (VoiceNotifier n : notifiers) {
                    n.stop();
                }
            }
        };
    }
}

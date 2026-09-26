package io.github.manuelvega.warden.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class CommandRunnerTest {
    @Test
    void aReplyIsPlainTextOneEntryPerLine() {
        CommandRunner.Collector c = new CommandRunner.Collector(10);
        c.add("§aGeneration progress: §e12.34%");
        c.add("§aProcessed LODs: §e5§a / §e10\n§aTime elapsed: §e3s");
        assertEquals(List.of("Generation progress: 12.34%", "Processed LODs: 5 / 10", "Time elapsed: 3s"), c.lines());
    }

    @Test
    void aLongReplyIsCapped() {
        CommandRunner.Collector c = new CommandRunner.Collector(2);
        c.add("a");
        c.add("b");
        c.add("c");
        assertEquals(List.of("a", "b"), c.lines());
    }

    @Test
    void theCollectorWaitsForTheReplyToGoQuiet() throws InterruptedException {
        CommandRunner.Collector c = new CommandRunner.Collector(10);
        Thread late = new Thread(() -> {
            try {
                Thread.sleep(60);
            } catch (InterruptedException ignored) {
            }
            c.add("late line");
        });
        late.start();
        c.awaitQuiet(150, 1000);
        assertEquals(List.of("late line"), c.lines());
    }

    @Test
    void theQuietWaitCountsFromWhenTheCommandRanNotFromTheRequest() throws InterruptedException {
        CommandRunner.Collector c = new CommandRunner.Collector(10);
        Thread.sleep(250); // the main thread was busy for longer than the quiet period
        c.ranNow();
        Thread late = new Thread(() -> {
            try {
                Thread.sleep(60);
            } catch (InterruptedException ignored) {
            }
            c.add("reply a tick later");
        });
        late.start();
        c.awaitQuiet(150, 1000);
        late.join();
        assertEquals(List.of("reply a tick later"), c.lines());
    }

    @Test
    void theAnswerNamesItsRequest() {
        JsonObject ok = CommandRunner.result("4", List.of("x"));
        assertEquals("run.result", ok.get("type").getAsString());
        assertEquals("4", ok.get("id").getAsString());
        assertEquals(1, ok.getAsJsonArray("lines").size());
        JsonObject err = CommandRunner.error("5", "timeout");
        assertEquals("timeout", err.get("error").getAsString());
        assertFalse(err.has("lines"));
        assertTrue(CommandRunner.result("6", List.of()).getAsJsonArray("lines").isEmpty());
    }

    @Test
    void awaitQuietRespectsDeadlineWhenMaxIsLessThanQuiet() throws InterruptedException {
        CommandRunner.Collector c = new CommandRunner.Collector(10);
        long start = System.nanoTime();
        // Request 50ms max wait, but set quiet threshold to 200ms.
        // Should return in ~50ms, not wait for 200ms quiet (deadline-driven).
        c.awaitQuiet(200, 50);
        long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
        // Should complete around 50ms, allow margin for system timing
        assertTrue(elapsedMs < 150, "awaitQuiet should respect max deadline; took " + elapsedMs + "ms");
    }
}

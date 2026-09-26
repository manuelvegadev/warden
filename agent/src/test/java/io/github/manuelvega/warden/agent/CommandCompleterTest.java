package io.github.manuelvega.warden.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class CommandCompleterTest {
    @Test
    void anAnswerKeepsTheFirstOfEachSuggestionAndItsTooltip() {
        JsonObject o = CommandCompleter.result("7", List.of(
                new CommandCompleter.Suggestion("Steve", "online"),
                new CommandCompleter.Suggestion("Steve", ""),
                new CommandCompleter.Suggestion("", ""),
                new CommandCompleter.Suggestion("Alex", "")));
        assertEquals("complete.result", o.get("type").getAsString());
        assertEquals("7", o.get("id").getAsString());
        assertEquals(2, o.getAsJsonArray("suggestions").size());
        assertEquals("online", o.getAsJsonArray("suggestions").get(0).getAsJsonObject().get("tooltip").getAsString());
        assertFalse(o.getAsJsonArray("suggestions").get(1).getAsJsonObject().has("tooltip"));
        assertFalse(o.has("truncated"));
    }

    @Test
    void aLongAnswerIsCappedAndSaysSo() {
        List<CommandCompleter.Suggestion> many = new ArrayList<>();
        for (int i = 0; i < CommandCompleter.MAX + 10; i++) {
            many.add(new CommandCompleter.Suggestion("s" + i, ""));
        }
        JsonObject o = CommandCompleter.result("1", many);
        assertEquals(CommandCompleter.MAX, o.getAsJsonArray("suggestions").size());
        assertTrue(o.get("truncated").getAsBoolean());
    }

    @Test
    void anErrorNamesTheRequestItAnswers() {
        JsonObject o = CommandCompleter.error("9", "superseded");
        assertEquals("9", o.get("id").getAsString());
        assertEquals("superseded", o.get("error").getAsString());
        assertFalse(o.has("suggestions"));
    }
}

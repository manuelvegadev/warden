package io.github.manuelvega.warden.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.junit.jupiter.api.Test;

class CommandCatalogTest {
    private static final class Cmd extends Command {
        Cmd(String name, String description, String usage) {
            super(name, description, usage, List.of());
        }

        @Override
        public boolean execute(CommandSender sender, String label, String[] args) {
            return true;
        }
    }

    @Test
    void everyLabelOfOneCommandIsOneEntryWithItsAliases() {
        Cmd lp = new Cmd("lp", "Manage permissions", "/<command> user <player>");
        Map<String, Command> known = new LinkedHashMap<>();
        known.put("permissions", lp);
        known.put("lp", lp);
        known.put("luckperms", lp);
        known.put("luckperms:lp", lp);
        List<CommandCatalog.Entry> entries = CommandCatalog.entries(known);
        assertEquals(1, entries.size());
        CommandCatalog.Entry e = entries.get(0);
        assertEquals("lp", e.name());
        assertEquals(List.of("luckperms", "permissions"), e.aliases());
        assertEquals("Manage permissions", e.description());
        assertEquals("/lp user <player>", e.usage());
    }

    @Test
    void aCommandWhoseNameAnotherTookIsListedUnderItsShortestLabel() {
        Cmd mine = new Cmd("give", "", "");
        Cmd winner = new Cmd("give", "", "");
        Map<String, Command> known = new LinkedHashMap<>();
        known.put("give", winner);
        known.put("egive", mine);
        known.put("essentialsgive", mine);
        List<CommandCatalog.Entry> entries = CommandCatalog.entries(known);
        assertEquals(List.of("egive", "give"), entries.stream().map(CommandCatalog.Entry::name).toList());
        assertEquals(List.of("essentialsgive"), entries.get(0).aliases());
    }

    @Test
    void namespacedOnlyCommandsAreLeftOut() {
        Map<String, Command> known = new LinkedHashMap<>();
        known.put("minecraft:reload", new Cmd("reload", "", ""));
        assertTrue(CommandCatalog.entries(known).isEmpty());
    }

    @Test
    void theServersOwnCommandsHaveNoPlugin() {
        Map<String, Command> known = Map.of("version", new Cmd("version", "Shows the version", "/<command>"));
        JsonObject o = CommandCatalog.encode(CommandCatalog.entries(known)).getAsJsonArray("commands").get(0)
                .getAsJsonObject();
        assertEquals("version", o.get("name").getAsString());
        assertFalse(o.has("plugin"));
        assertFalse(o.has("usage"), "Bukkit's default /<command> says nothing");
        assertFalse(o.has("aliases"));
    }

    @Test
    void descriptionsLoseColourCodesAndExtraLines() {
        assertEquals("Teleports you", CommandCatalog.clean("§aTeleports §lyou\nSecond line"));
        assertEquals("", CommandCatalog.clean(null));
    }
}

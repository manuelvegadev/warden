package io.github.manuelvega.warden.agent;

import java.util.List;
import java.util.function.BooleanSupplier;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;
import org.bukkit.entity.Player;

/** {@code /warden voice allow|deny|status}: a player's own answer to Beacon's voice chat (ADR-019 §1). */
public final class WardenCommand implements TabExecutor {
    private final VoiceConsent consent;
    private final BooleanSupplier voiceAvailable;

    public WardenCommand(VoiceConsent consent, BooleanSupplier voiceAvailable) {
        this.consent = consent;
        this.voiceAvailable = voiceAvailable;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length < 1 || !args[0].equalsIgnoreCase("voice")) {
            sender.sendMessage(Component.text("Usage: /warden voice allow|deny|status", NamedTextColor.GRAY));
            return true;
        }
        if (!(sender instanceof Player p)) {
            sender.sendMessage(Component.text("Only players have a voice to give or withhold.", NamedTextColor.GRAY));
            return true;
        }
        if (!voiceAvailable.getAsBoolean()) {
            sender.sendMessage(Component.text(
                    "Voice chat is not available: Simple Voice Chat is not installed or not running.", NamedTextColor.GRAY));
            return true;
        }
        String what = args.length > 1 ? args[1].toLowerCase() : "status";
        switch (what) {
            case "allow" -> {
                consent.set(p.getUniqueId(), true);
                p.sendMessage(Component.text("Beacon may hear you and speak to you.", NamedTextColor.GRAY));
            }
            case "deny" -> {
                consent.set(p.getUniqueId(), false);
                p.sendMessage(Component.text("Beacon will neither hear you nor speak to you.", NamedTextColor.GRAY));
            }
            default -> {
                if (!consent.asks()) {
                    p.sendMessage(Component.text(
                            "This server tells you when Beacon listens or speaks; there is nothing to allow or deny.",
                            NamedTextColor.GRAY));
                    return true;
                }
                String state = consent.state(p.getUniqueId());
                p.sendMessage(Component.text(switch (state) {
                    case VoiceConsent.ALLOWED -> "Beacon may hear you and speak to you (/warden voice deny to change).";
                    case VoiceConsent.DENIED -> "Beacon neither hears you nor speaks to you (/warden voice allow to change).";
                    default -> "You have not answered yet; Beacon may hear you until you do (/warden voice allow|deny).";
                }, NamedTextColor.GRAY));
            }
        }
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length == 1) {
            return List.of("voice");
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("voice")) {
            return List.of("allow", "deny", "status");
        }
        return List.of();
    }
}

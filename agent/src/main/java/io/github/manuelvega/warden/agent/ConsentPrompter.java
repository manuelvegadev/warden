package io.github.manuelvega.warden.agent;

import io.papermc.paper.dialog.Dialog;
import io.papermc.paper.registry.data.dialog.ActionButton;
import io.papermc.paper.registry.data.dialog.DialogBase;
import io.papermc.paper.registry.data.dialog.action.DialogAction;
import io.papermc.paper.registry.data.dialog.body.DialogBody;
import io.papermc.paper.registry.data.dialog.type.DialogType;
import java.time.Duration;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickCallback;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.Plugin;

/**
 * The {@code ask} policy's rendering: players are asked whether Beacon may hear them and speak to
 * them, in a native dialog with Allow and Deny (Paper's Dialog API, 1.21.6+), shown to every online
 * player who has not answered when a Beacon session starts, and to players who join while one is
 * active. A player who dismisses it is asked again at the next session; {@code /warden voice} works
 * any time. Activity is derived from the same calls every notifier gets. Main thread only.
 */
public final class ConsentPrompter implements VoiceNotifier, Listener {
    private final Plugin plugin;
    private final VoiceConsent consent;
    /** Players asked during the current activity, so a dismissed dialog is not re-shown every push-to-talk. */
    private final Set<UUID> asked = new HashSet<>();
    private String listeners = "";
    private final Set<String> speakers = new LinkedHashSet<>();

    public ConsentPrompter(Plugin plugin, VoiceConsent consent) {
        this.plugin = plugin;
        this.consent = consent;
    }

    @Override
    public void listening(String by) {
        listeners = by == null ? "" : by;
        refresh();
    }

    @Override
    public void speaking(String by, boolean on) {
        if (on) {
            speakers.add(by);
        } else {
            speakers.remove(by);
        }
        refresh();
    }

    @Override
    public void stop() {
        listeners = "";
        speakers.clear();
        asked.clear();
    }

    /** Whose name the dialog carries: a speaker first, else the listeners; null when nothing is active. */
    private String activeBy() {
        if (!speakers.isEmpty()) {
            return speakers.iterator().next();
        }
        return listeners.isEmpty() ? null : listeners;
    }

    private void refresh() {
        String by = activeBy();
        if (by == null) {
            asked.clear();
            return;
        }
        for (Player p : Bukkit.getOnlinePlayers()) {
            ask(p, by);
        }
    }

    private void ask(Player p, String by) {
        UUID id = p.getUniqueId();
        if (!VoiceConsent.UNSET.equals(consent.state(id)) || !asked.add(id)) {
            return;
        }
        p.showDialog(dialog(by));
    }

    private Dialog dialog(String by) {
        ClickCallback.Options once = ClickCallback.Options.builder().uses(1).lifetime(Duration.ofMinutes(10)).build();
        ActionButton allow = ActionButton.builder(Component.text("Allow"))
                .tooltip(Component.text("Beacon may hear you and speak to you"))
                .action(DialogAction.customClick((view, audience) -> answer(audience, true), once))
                .build();
        ActionButton deny = ActionButton.builder(Component.text("Deny"))
                .tooltip(Component.text("Beacon neither hears you nor speaks to you"))
                .action(DialogAction.customClick((view, audience) -> answer(audience, false), once))
                .build();
        DialogBase base = DialogBase.builder(Component.text("Beacon voice chat"))
                .canCloseWithEscape(true)
                .body(List.of(DialogBody.plainMessage(Component.text(
                        by + " wants to use voice chat from Beacon: hear you and speak to you from the panel. Allow?"))))
                .build();
        return Dialog.create(f -> f.empty().base(base).type(DialogType.confirmation(allow, deny)));
    }

    private void answer(net.kyori.adventure.audience.Audience audience, boolean allowed) {
        if (!(audience instanceof Player p)) {
            return;
        }
        consent.set(p.getUniqueId(), allowed);
        asked.remove(p.getUniqueId());
        p.sendMessage(Component.text(
                allowed ? "Beacon may hear you and speak to you. Change it with /warden voice deny."
                        : "Beacon will neither hear you nor speak to you. Change it with /warden voice allow.",
                NamedTextColor.GRAY));
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent e) {
        if (activeBy() == null) {
            return;
        }
        // A tick later: the dialog needs the player fully in.
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            String by = activeBy();
            if (by != null && e.getPlayer().isOnline()) {
                ask(e.getPlayer(), by);
            }
        }, 20L);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent e) {
        asked.remove(e.getPlayer().getUniqueId());
    }
}

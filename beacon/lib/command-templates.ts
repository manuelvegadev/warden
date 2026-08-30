/**
 * Console command templates: the admin commands people look up every time, verified against the
 * Minecraft wiki and the Paper docs (docs/minecraft-admin.md). Angle-bracket tokens (`<player>`)
 * are placeholders for the admin to fill in. Multi-command templates are sent in order. Syntax is the 1.21.11+ one (snake_case game rules,
 * `below_name` display slot); older names are noted where they differ.
 */
import { PAPER_COMMANDS } from "@/lib/command-grammar";

export interface CommandTemplate {
  id: string;
  title: string;
  description: string;
  commands: string[];
}

export interface CommandGroup {
  title: string;
  templates: CommandTemplate[];
}

/** Paper-only templates are the ones whose first command is Paper-only (see PAPER_COMMANDS). */
export const isPaperTemplate = (t: CommandTemplate) => PAPER_COMMANDS.has(t.commands[0].split(" ")[0]);

export const COMMAND_GROUPS: CommandGroup[] = [
  {
    title: "Players",
    templates: [
      { id: "list", title: "Who is online", description: "Names of the connected players.", commands: ["list"] },
      {
        id: "gamemode",
        title: "Change a player's game mode",
        description: "survival, creative, adventure or spectator.",
        commands: ["gamemode <mode> <player>"],
      },
      {
        id: "tp",
        title: "Teleport a player to another",
        description: "Moves the first player next to the second.",
        commands: ["tp <player> <target>"],
      },
      {
        id: "give",
        title: "Give an item",
        description: "Item id and count, e.g. diamond 64.",
        commands: ["give <player> <item> <count>"],
      },
      {
        id: "effect",
        title: "Apply an effect",
        description: "Seconds may be a number or infinite; amplifier 0 is level I.",
        commands: ["effect give <player> <effect> <seconds> <amplifier>"],
      },
      {
        id: "kick",
        title: "Kick a player",
        description: "Disconnects them with a reason; they can rejoin. Bans and the whitelist live in Access.",
        commands: ["kick <player> <reason>"],
      },
      {
        id: "spawnpoint",
        title: "Set a player's respawn point",
        description: "Coordinates of where they respawn after dying.",
        commands: ["spawnpoint <player> <x> <y> <z>"],
      },
    ],
  },
  {
    title: "Chat",
    templates: [
      {
        id: "say",
        title: "Broadcast a message",
        description: "Shown to everyone in chat, prefixed with [Server].",
        commands: ["say <message>"],
      },
      {
        id: "tellraw",
        title: "Broadcast in red, bold",
        description: "Formatted chat message for everyone (JSON text; edit the text).",
        commands: ['tellraw @a {"text":"<message>","color":"red","bold":true}'],
      },
      {
        id: "title",
        title: "Show a title to everyone",
        description: "Big on-screen text with a fade in/stay/fade out of 10/70/20 ticks.",
        commands: ["title @a times 10 70 20", 'title @a title {"text":"<message>"}'],
      },
    ],
  },
  {
    title: "Scoreboard & TAB list",
    templates: [
      {
        id: "tab-hearts",
        title: "Show hearts in the TAB list",
        description: "Creates a health objective rendered as hearts next to every name in the player list.",
        commands: [
          "scoreboard objectives add health health",
          "scoreboard objectives modify health rendertype hearts",
          "scoreboard objectives setdisplay list health",
        ],
      },
      {
        id: "name-hearts",
        title: "Show health under name tags",
        description: "Same objective below each player's name in the world (belowName before 1.20.2).",
        commands: ["scoreboard objectives add health health", "scoreboard objectives setdisplay below_name health"],
      },
      {
        id: "kills",
        title: "Kill counter in the sidebar",
        description: "Player kills per player, shown on the right of the screen.",
        commands: ["scoreboard objectives add kills playerKillCount", "scoreboard objectives setdisplay sidebar kills"],
      },
      {
        id: "tab-clear",
        title: "Clear the TAB list and sidebar",
        description: "Removes whatever those slots display; the objectives stay.",
        commands: ["scoreboard objectives setdisplay list", "scoreboard objectives setdisplay sidebar"],
      },
    ],
  },
  {
    title: "World",
    templates: [
      { id: "day", title: "Set the time to day", description: "Sunrise for everyone.", commands: ["time set day"] },
      { id: "clear", title: "Clear the weather", description: "Stops rain and thunder.", commands: ["weather clear"] },
      {
        id: "difficulty",
        title: "Change the difficulty",
        description: "peaceful, easy, normal or hard. Persists in the world, not in server.properties.",
        commands: ["difficulty <level>"],
      },
      {
        id: "keep-inventory",
        title: "Keep inventory on death",
        description: "Players respawn with everything they carried (keepInventory before 1.21.11).",
        commands: ["gamerule keep_inventory true"],
      },
      {
        id: "no-cycle",
        title: "Freeze the day/night cycle",
        description: "Time stays put until you set it back to true (doDaylightCycle before 1.21.11).",
        commands: ["gamerule advance_time false"],
      },
      {
        id: "one-sleeper",
        title: "One sleeper skips the night",
        description: "A single player in bed is enough (playersSleepingPercentage before 1.21.11).",
        commands: ["gamerule players_sleeping_percentage 1"],
      },
      {
        id: "no-griefing",
        title: "Stop mobs breaking blocks",
        description: "No creeper craters or enderman theft (mobGriefing before 1.21.11).",
        commands: ["gamerule mob_griefing false"],
      },
      {
        id: "worldborder",
        title: "Set the world border",
        description: "Full diameter in blocks, centered at spawn.",
        commands: ["worldborder center 0 0", "worldborder set <blocks>"],
      },
      {
        id: "clear-items",
        title: "Remove dropped items",
        description: "Kills every item entity lying on the ground (lag relief after a big death).",
        commands: ["kill @e[type=item]"],
      },
    ],
  },
  {
    title: "Server",
    templates: [
      {
        id: "save",
        title: "Save the world now",
        description: "Writes every loaded chunk to disk and waits for it (wardend does this before backups).",
        commands: ["save-all flush"],
      },
      {
        id: "whitelist-reload",
        title: "Reload the whitelist",
        description: "After editing whitelist.json by hand.",
        commands: ["whitelist reload"],
      },
      {
        id: "seed",
        title: "Show the world seed",
        description: "Prints the seed of the main world.",
        commands: ["seed"],
      },
      {
        id: "tps",
        title: "Ticks per second",
        description: "Averages over 1, 5 and 15 minutes; 20 is healthy.",
        commands: ["tps"],
      },
      {
        id: "mspt",
        title: "Milliseconds per tick",
        description: "Above 50 ms the server is falling behind.",
        commands: ["mspt"],
      },
      {
        id: "entities",
        title: "Count entities by type",
        description: "The fastest way to find a mob farm that is lagging the server.",
        commands: ["paper entity list"],
      },
      {
        id: "plugins",
        title: "List plugins",
        description: "Green = enabled, red = disabled.",
        commands: ["plugins"],
      },
    ],
  },
];

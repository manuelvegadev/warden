/**
 * What each choice actually does, for the server.properties keys whose values are a list.
 *
 * The daemon's schema describes the key ("Default game mode for new players"); this describes the
 * values, which is the part someone is actually choosing between. Sourced from the Minecraft wiki
 * pages for Difficulty, Game mode and server.properties.
 *
 * Kept to one line each: enough to pick without opening a wiki, short enough to read in a menu.
 */
export const ENUM_HELP: Record<string, Record<string, string>> = {
  difficulty: {
    peaceful: "No hostile mobs, no damage from them, and health regenerates. Hunger never drops.",
    easy: "Hostile mobs spawn but hit softly. Zombies cannot break doors, and hunger stops at 5 hearts.",
    normal: "Standard mob damage. Hunger can take you to half a heart, and half of killed villagers turn.",
    hard: "Mobs hit half again as hard, zombies break doors and call for help, and hunger can kill you.",
  },
  gamemode: {
    survival: "Gather resources, take damage, get hungry. The normal game.",
    creative: "Unlimited blocks, flight, and no damage. For building.",
    adventure: "Blocks can only be broken with the right tool. Made for custom maps.",
    spectator: "Fly through walls and watch, touching nothing.",
  },
  "level-type": {
    "minecraft:normal": "Ordinary terrain: hills, valleys, oceans, caves.",
    "minecraft:flat": "A featureless flat plane. Shape it with generator-settings.",
    "minecraft:large_biomes": "The same terrain with every biome stretched four times wider.",
    "minecraft:amplified": "The same terrain, but far taller. Heavy on the server and the client.",
    "minecraft:single_biome_surface": "One biome across the whole overworld. Pick it with generator-settings.",
  },
};

/** The one-liner for a value, if there is one. */
export const enumHelp = (key: string, value: string): string | undefined => ENUM_HELP[key]?.[value];

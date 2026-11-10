/**
 * Loads + validates the engine-neutral gameplay data (bundled by Vite at build time from data/gameplay/).
 * Import `GAMEPLAY` anywhere; invalid data fails fast at startup with a clear message.
 */
import weaponsJson from "../../data/gameplay/weapons.json";
import playerJson from "../../data/gameplay/player.json";
import enemiesJson from "../../data/gameplay/enemies.json";
import missionJson from "../../data/gameplay/mission.json";
import { validateEnemies, validateMission, validatePlayer, validateWeapons } from "./schemas";

export const GAMEPLAY = {
  weapons: validateWeapons(weaponsJson).weapons,
  player: validatePlayer(playerJson),
  enemies: validateEnemies(enemiesJson),
  mission: validateMission(missionJson),
};

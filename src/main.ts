import "./style.css";
import { Game } from "./game/Game";
import { graphicsSettings, setFpsVisible } from "./game/Graphics";
import { Menus } from "./ui/Menus";
import { effective, onSettings } from "./ui/settings";

const canvas = document.getElementById("game") as HTMLCanvasElement;
let menus: Menus;
let shots = 0, hits = 0;

const game = new Game(
  canvas,
  () => {
    const w = game.world;
    menus.showEnd({
      won: w.phase === "won", time: w.time, kills: w.kills, shots, hits,
      secrets: w.mission.secrets, secretsTotal: 1, health: w.player.health,
    });
  },
  () => menus.showPause(),
);

// Settings: apply now and live on change
game.applySettings(effective());
onSettings((s) => { game.applySettings(s); setFpsVisible(s.showFps); });

// Accuracy for the end screen
game.world.events.on("shot", () => { shots++; });
game.world.events.on("shotResult", (e) => { if (e.hit) hits++; });

menus = new Menus({
  loadProgress: () => game.loadProgress,
  ready: game.ready,
  audioLoaded: () => game.audio.loadedFiles,
  unlockAudio: () => game.audio.unlock(),
  play: () => game.start(),
  quality: () => graphicsSettings.quality,
});

// The browser refused pointer lock (e.g. re-locking right after Esc): stay paused and ask again.
document.addEventListener("pointerlockerror", () => {
  if (game.isOver || new URLSearchParams(location.search).has("shot")) return; // headless tests never get pointer lock
  game.pause();
  menus.showPause("Couldn't capture the mouse. Click Resume again.");
});

const params = new URLSearchParams(location.search);
const shot = params.get("shot");
if (shot) {
  // Dev/test hook: ?shot=x,z,yawDeg[,pitchDeg[,y]] skips all menus and places the camera.
  const [x, z, yaw, pitch, y] = shot.split(",").map(Number);
  menus.hide();
  game.debugStart(x, z, yaw, pitch || 0, y || 1);
  // ?sim=seconds fast-forwards the game logic (enemies, triggers) before the screenshot
  const sim = Number(params.get("sim") || 0);
  if (sim > 0) game.simulate(sim);
} else if (Menus.consumeAutoplay()) {
  menus.showLoading(false); // Retry / Restart: straight to the briefing (Begin = the click pointer lock needs)
} else {
  menus.showMain();
}

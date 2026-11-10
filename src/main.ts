import "./style.css";
import { Game } from "./game/Game";
import { renderCredits } from "./credits";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLElement;
const startBtn = document.getElementById("start") as HTMLButtonElement;
const sub = document.getElementById("overlay-sub") as HTMLElement;
const body = document.getElementById("overlay-body") as HTMLElement;
renderCredits(document.getElementById("credits-list") as HTMLElement);

const game = new Game(
  canvas,
  (title, text) => {
    sub.textContent = title;
    body.innerHTML = text;
    startBtn.textContent = "Play again";
    overlay.classList.remove("hidden");
  },
  () => {
    sub.textContent = "Paused";
    startBtn.textContent = "Resume";
    overlay.classList.remove("hidden");
  },
);

// Dev/test hook: ?shot=x,z,yawDeg[,pitchDeg[,y]] skips the menu and places the camera.
const shot = new URLSearchParams(location.search).get("shot");
if (shot) {
  const [x, z, yaw, pitch, y] = shot.split(",").map(Number);
  overlay.classList.add("hidden");
  game.debugStart(x, z, yaw, pitch || 0, y || 1);
  // ?sim=seconds fast-forwards the game logic (enemies, triggers) before the screenshot
  const sim = Number(new URLSearchParams(location.search).get("sim") || 0);
  if (sim > 0) game.simulate(sim);
}

// Wait for the 3D models before allowing play
startBtn.disabled = true;
startBtn.textContent = "Loading…";
game.ready.then(() => {
  startBtn.disabled = false;
  startBtn.textContent = "Click to play";
});

startBtn.addEventListener("click", () => {
  if (game.isOver) { location.reload(); return; }
  overlay.classList.add("hidden");
  game.start();
});

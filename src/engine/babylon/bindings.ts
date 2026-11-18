/**
 * Rebindable controls. Each action has up to two bindings; a binding is a keyboard `KeyboardEvent.code`
 * (e.g. "KeyR") or a mouse button "Mouse0".."Mouse4" (0 left, 1 middle, 2 right, 3 back side button, 4 forward side
 * button; gaming mice with more buttons usually map extras to keys in their own software, which also works here).
 * Saved in localStorage (wrapped in try/catch, so defaults apply if storage is blocked).
 */
export type Action =
  | "forward" | "back" | "left" | "right" | "sprint" | "crouch" | "jump"
  | "fire" | "aim" | "reload" | "weapon1" | "weapon2" | "weaponLast" | "mute";

export const ACTIONS: { id: Action; label: string }[] = [
  { id: "forward", label: "Move forward" }, { id: "back", label: "Move back" },
  { id: "left", label: "Strafe left" }, { id: "right", label: "Strafe right" },
  { id: "sprint", label: "Sprint" }, { id: "crouch", label: "Crouch / slide" }, { id: "jump", label: "Jump" },
  { id: "fire", label: "Fire" }, { id: "aim", label: "Aim / zoom (hold)" }, { id: "reload", label: "Reload" },
  { id: "weapon1", label: "Weapon 1 (Vajra)" }, { id: "weapon2", label: "Weapon 2 (Trishul)" },
  { id: "weaponLast", label: "Previous weapon" }, { id: "mute", label: "Mute sound" },
];

export type Bindings = Record<Action, [string | null, string | null]>;

export const DEFAULT_BINDINGS: Bindings = {
  forward: ["KeyW", "ArrowUp"], back: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
  sprint: ["ShiftLeft", "ShiftRight"], crouch: ["KeyC", "ControlLeft"], jump: ["Space", null],
  fire: ["Mouse0", null], aim: ["Mouse2", null], reload: ["KeyR", null],
  weapon1: ["Digit1", null], weapon2: ["Digit2", null], weaponLast: ["KeyQ", null], mute: ["KeyM", null],
};

const STORAGE_KEY = "idamjagath.bindings.v1";
let current: Bindings = load();
const listeners = new Set<() => void>();

function load(): Bindings {
  const b = structuredClone(DEFAULT_BINDINGS);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Bindings>;
      for (const a of Object.keys(b) as Action[]) {
        const v = saved[a];
        if (Array.isArray(v) && v.length === 2) b[a] = [v[0] ?? null, v[1] ?? null];
      }
    }
  } catch { /* storage blocked or corrupt: defaults */ }
  return b;
}

function save(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* ignore */ }
  for (const fn of listeners) fn();
}

export function getBindings(): Bindings { return current; }
export function onBindings(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

/** Bind `code` to action slot; the same code is removed from any other action (no double bindings). */
export function setBinding(action: Action, slot: 0 | 1, code: string | null): void {
  if (code) for (const a of Object.keys(current) as Action[]) {
    for (const i of [0, 1] as const) if (current[a][i] === code) current[a][i] = null;
  }
  current[action][slot] = code;
  save();
}

export function resetBindings(): void { current = structuredClone(DEFAULT_BINDINGS); save(); }

/** Human-readable name for a binding code. */
export function codeLabel(code: string | null): string {
  if (!code) return "—";
  const mouse: Record<string, string> = { Mouse0: "Left click", Mouse1: "Middle click", Mouse2: "Right click", Mouse3: "Mouse 4 (back)", Mouse4: "Mouse 5 (fwd)" };
  if (mouse[code]) return mouse[code];
  if (code.startsWith("Mouse")) return `Mouse ${Number(code.slice(5)) + 1}`;
  return code.replace(/^Key/, "").replace(/^Digit/, "").replace(/Left$/, " (L)").replace(/Right$/, " (R)")
    .replace(/^Arrow/, "Arrow ").replace("Space", "Space");
}

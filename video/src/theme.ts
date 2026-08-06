/**
 * The film uses the register's own palette and type.
 *
 * A submission video in a different visual language than the product reads as
 * marketing bolted on afterwards. These are the exact tokens the pages ship,
 * copied deliberately rather than approximated — see packages/design/src/index.ts.
 */
export const C = {
  ink: "#1F1E1D",
  inkSoft: "#2C2A28",
  paper: "#FAF9F5",
  muted: "#4A4742",
  graphite: "#6E6A64",
  faint: "#6B6760",
  rule: "rgba(31,30,29,0.15)",
  ruleStrong: "rgba(31,30,29,0.25)",
  wash: "rgba(31,30,29,0.04)",
  ok: "#3F6F4B",
  bad: "#8C3A2E",
  unknown: "#6B6760",
  sim: "#7A6A3F",
  termBg: "#1F1E1D",
  termInk: "#E8E4DC",
  termOk: "#8FBF9B",
  termBad: "#E09A88",
  termDim: "#8A857B",
  termHi: "#F0EBE1",
} as const;

export const F = {
  serif: '"IBM Plex Serif", Georgia, "Times New Roman", serif',
  sans: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Consolas, monospace',
} as const;

export const FPS = 30;

/**
 * The scene list, in frames.
 *
 * Durations are declared here rather than inline so the composition length is
 * the sum of the parts — a film whose stated length disagrees with its
 * contents is the same defect as a page whose headline disagrees with its table.
 */
export const SCENES = [
  { id: "thesis", frames: 5.5 * FPS },
  { id: "registers", frames: 9 * FPS },
  { id: "redrun", frames: 15 * FPS },
  { id: "bits", frames: 9 * FPS },
  { id: "history", frames: 7 * FPS },
  { id: "errata", frames: 8 * FPS },
  { id: "reproduce", frames: 7.5 * FPS },
  { id: "close", frames: 5 * FPS },
] as const;

export const TOTAL = SCENES.reduce((n, s) => n + s.frames, 0);

/** Frame at which each scene starts. */
export const startOf = (id: (typeof SCENES)[number]["id"]): number => {
  let n = 0;
  for (const s of SCENES) {
    if (s.id === id) return n;
    n += s.frames;
  }
  return n;
};

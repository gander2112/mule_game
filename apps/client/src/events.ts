import Phaser from "phaser";

/** Single shared bus so main.ts (DOM/UI) and BoardScene (canvas) can talk without tangling references. */
export const bus = new Phaser.Events.EventEmitter();

export const EVENTS = {
  SCENE_READY: "scene-ready",
  PLOT_CLICK: "plot-click",
} as const;

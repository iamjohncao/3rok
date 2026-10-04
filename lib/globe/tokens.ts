// Reads the design tokens the scene is painted with, from the page's own CSS. No colour is written
// in this code: change a token and the globes follow. Browser only.

import { parseHexColor, type Rgb } from "./heat";
import type { GlobeTokens } from "./renderer";

function token(style: CSSStyleDeclaration, name: string): Rgb {
  const value = style.getPropertyValue(name);
  const parsed = parseHexColor(value);
  if (!parsed) throw new Error(`The design token ${name} is not a plain colour here: "${value.trim()}".`);
  return parsed;
}

export function readGlobeTokens(root: HTMLElement = document.documentElement): GlobeTokens {
  const style = getComputedStyle(root);
  return {
    background: token(style, "--surface-100"),
    landDot: token(style, "--ink-muted"),
    oceanDot: token(style, "--ink-subtle"),
    ink: token(style, "--ink"),
    inkSubtle: token(style, "--ink-subtle"),
    lineStrong: token(style, "--line-strong"),
    accent: token(style, "--accent"),
    ramp: { low: token(style, "--thermal-3"), mid: token(style, "--thermal-4"), high: token(style, "--thermal-5") },
  };
}

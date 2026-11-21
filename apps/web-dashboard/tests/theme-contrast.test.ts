/// <reference types="node" />
// Checks every theme in src/styles/tokens.css against WCAG 2.2 AA, so a token change cannot silently
// make text unreadable: text ≥ 4.5:1 (1.4.3), control boundaries and focus rings ≥ 3:1 (1.4.11).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../src/styles/tokens.css'), 'utf8');
function themeVars(selector: string): Record<string, string> {
  const block = css.split('}').find(b => b.includes(selector) && b.includes('--bg'));
  if (!block) throw new Error(`no block for ${selector}`);
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1]!, m[2]!.toLowerCase()]));
}
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };

const TEXT = 4.5, UI = 3;
const surfaces = ['bg', 'surface', 'surface-2', 'surface-raised'];
const checks: [fg: string, bgs: string[], min: number][] = [
  ['text', [...surfaces, 'accent-soft'], TEXT],
  ['text-muted', surfaces, TEXT],
  ['link', [...surfaces, 'accent-soft'], TEXT],
  ['on-accent', ['accent', 'accent-hover'], TEXT],
  ['success', ['surface', 'success-soft'], TEXT],
  ['warning', ['surface', 'warning-soft'], TEXT],
  ['danger', ['surface', 'danger-soft'], TEXT],
  ['accent', surfaces, UI],
  ['border-strong', surfaces, UI],
  // The focus ring is an outline drawn 2px outside the control (base.css), over the page surface, never over
  // the control itself, so it is measured against the surfaces it can sit on (WCAG 2.4.13).
  ['focus', surfaces, UI]
];

describe.each([['dark', ':root, :root[data-theme="dark"]'], ['light', ':root[data-theme="light"]'], ['contrast', ':root[data-theme="contrast"]']])('%s theme', (_name, selector) => {
  const v = themeVars(selector);
  for (const [fg, bgs, min] of checks) for (const bg of bgs) {
    it(`${fg} on ${bg} ≥ ${min}:1`, () => {
      expect(v[fg], `--${fg}`).toBeDefined(); expect(v[bg], `--${bg}`).toBeDefined();
      expect(Math.round(contrast(v[fg]!, v[bg]!) * 100) / 100).toBeGreaterThanOrEqual(min);
    });
  }
});

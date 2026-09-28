import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seriesColors } from './chart-palette.js';

function luminance(hex) {
  const c = hex.replace('#', '').match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
function contrast(a, b) {
  const l = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (l[0] + 0.05) / (l[1] + 0.05);
}
const css = readFileSync(new URL('../../css/base/_variables.css', import.meta.url), 'utf8');
for (const dark of [false, true]) {
  test(`${dark ? 'dark' : 'light'} auxiliary text and chart palette remain readable`, () => {
    const block = dark ? css.split('[data-theme="dark"]')[1] : css.split('[data-theme="dark"]')[0];
    const token = name => block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))[1];
    for (const bg of ['bg-base', 'bg-raised', 'bg-subtle', 'bg-elevated']) {
      assert.ok(contrast(token('text-tertiary'), token(bg)) >= 4.5, bg);
      for (const color of seriesColors(dark)) assert.ok(contrast(color, token(bg)) >= 3, `${bg} / ${color}`);
    }
  });
}

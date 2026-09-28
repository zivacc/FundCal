import test from 'node:test';
import assert from 'node:assert/strict';
import { navAppearance } from './nav-appearance.js';

test('detail NAV theme patches retain data/zoom and constrain tooltips', () => {
  const theme = { textPrimary: '#ffffff', textSecondary: '#aaaaaa', bgElevated: '#222222', ruleStrong: '#444444', rule: '#333333', grid: '#333333' };
  const option = navAppearance(theme, true);
  assert.equal(option.tooltip.confine, true);
  assert.equal(option.tooltip.backgroundColor, theme.bgElevated);
  assert.equal(option.xAxis.axisLabel.color, theme.textSecondary);
  assert.equal(option.yAxis.splitLine.lineStyle.color, theme.grid);
  assert.equal('dataZoom' in option, false);
  assert.equal('series' in option, false);
  assert.equal('data' in option.xAxis, false);
  assert.notDeepEqual(option.color, navAppearance(theme, false).color);
});

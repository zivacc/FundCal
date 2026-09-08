import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const name of ['wind-mcp-skill', 'wind-find-finance-skill']) {
  test(`${name}: default updater leaves credentials and skill files untouched`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'fundcal-wind-update-'));
    try {
      mkdirSync(join(dir, 'scripts'));
      const config = '{"wind_api_key":"test-only-credential"}';
      writeFileSync(join(dir, 'config.json'), config);
      const script = resolve(`.agents/skills/${name}/scripts/update-check.mjs`);
      const args = name === 'wind-find-finance-skill' ? ['--run-update', dir] : [dir];
      const result = spawnSync(process.execPath, [script, ...args], {
        env: { ...process.env, WIND_SKILL_AUTO_UPDATE: '0' },
        encoding: 'utf8', timeout: 2000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(readdirSync(join(dir, 'scripts')), []);
      assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), config);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

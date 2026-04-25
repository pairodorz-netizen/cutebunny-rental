/**
 * BUG-OBS-01 — `wrangler.toml` observability config snapshot.
 *
 * Owner reported (2026-04-26 ~01:00 JST, post-PR-#90 deploy 320f1dde)
 * that Cloudflare's dashboard panel was showing:
 *
 *     "observability": {
 *       "enabled": false,
 *       "logs": { "enabled": true, "persist": true, "invocation_logs": true }
 *     }
 *
 * The asymmetry was caused by `wrangler.toml` having no `[observability]`
 * block at all — so every `wrangler deploy` reset the dashboard-side
 * toggles to wrangler-3.x defaults. The owner had to re-enable Logs by
 * hand after each deploy.
 *
 * This atom pins both the top-level Workers Observability product
 * (`[observability] enabled = true`) and the legacy Workers Logs feature
 * (`[observability.logs] enabled = true, invocation_logs = true`) in
 * `wrangler.toml` so the deploy is reproducible from source.
 *
 * Gates (TDD-light per orchestrator brief):
 *   #1 `[observability]` table exists with `enabled = true`.
 *   #2 `[observability.logs]` table exists with `enabled = true`.
 *   #3 `[observability.logs] invocation_logs = true` so per-invocation
 *      metadata stays in the Logs view (correlates with the structured
 *      `[admin-categories]` envelopes from BUG-504-RC1+RC2).
 *   #4 The wrangler manifest still declares `name`, `main`, and
 *      `compatibility_date` (regression guard against accidental
 *      manifest corruption while editing the new block).
 *
 * Implementation note: vitest doesn't have a TOML parser in scope and
 * the repo deliberately avoids adding one for a 4-line config block.
 * We assert against the file's textual content with anchor-aware regex
 * so the gates are robust to whitespace + comment placement but reject
 * accidental `false` flips or block deletions.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let manifest: string;

beforeAll(() => {
  manifest = readFileSync(
    resolve(__dirname, '../../wrangler.toml'),
    'utf-8',
  );
});

describe('BUG-OBS-01 — wrangler.toml observability config', () => {
  it('declares [observability] table with enabled = true (gate #1)', () => {
    // Match the [observability] block specifically (not [observability.logs]).
    // The `[observability]\n` boundary requires a literal newline so the regex
    // does not greedily catch the nested `[observability.logs]` table.
    const block = manifest.match(/\[observability\]\s*\n([^[]*)/);
    expect(block, '[observability] table missing from wrangler.toml').not.toBeNull();
    expect(block![1]).toMatch(/^\s*enabled\s*=\s*true\s*$/m);
  });

  it('declares [observability.logs] table with enabled = true (gate #2)', () => {
    const block = manifest.match(/\[observability\.logs\]\s*\n([^[]*)/);
    expect(block, '[observability.logs] table missing from wrangler.toml').not.toBeNull();
    expect(block![1]).toMatch(/^\s*enabled\s*=\s*true\s*$/m);
  });

  it('declares invocation_logs = true under [observability.logs] (gate #3)', () => {
    const block = manifest.match(/\[observability\.logs\]\s*\n([^[]*)/);
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/^\s*invocation_logs\s*=\s*true\s*$/m);
  });

  it('preserves the worker manifest essentials (gate #4 — regression guard)', () => {
    expect(manifest).toMatch(/^name\s*=\s*"cutebunny-api"\s*$/m);
    expect(manifest).toMatch(/^main\s*=\s*"src\/index\.ts"\s*$/m);
    expect(manifest).toMatch(/^compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"\s*$/m);
  });

  it('rejects any literal `enabled = false` line in the observability block (paranoia)', () => {
    // Belt-and-suspenders: even if the block boundary regex above breaks,
    // there must NEVER be a literal `enabled = false` anywhere in the file.
    expect(manifest).not.toMatch(/^\s*enabled\s*=\s*false\s*$/m);
  });
});

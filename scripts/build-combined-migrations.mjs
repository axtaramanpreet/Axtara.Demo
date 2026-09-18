/**
 * Concatenate every migration into one script for the Supabase SQL Editor.
 *
 *   node scripts/build-combined-migrations.mjs
 *
 * `supabase db push` is the normal route and this is not a replacement for it.
 * It exists because the CLI provisions its own `cli_login_postgres` role before
 * pushing, and on a project whose postgres role lacks ADMIN on that role the
 * push fails outright with "permission denied to alter role" — with no way to
 * skip the step. Pasting SQL into the editor is then the only way in.
 *
 * The output records each migration in `supabase_migrations.schema_migrations`
 * as it goes, so a later `db push` from a machine that can run one sees them as
 * already applied instead of replaying them onto a schema that has them.
 *
 * Re-run this whenever a migration is added, and commit the result.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const migrations = `${root}supabase/migrations`;
const target = `${root}supabase/bootstrap/all-migrations.sql`;

const files = readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort();

if (!files.length) {
  console.error(`No migrations found in ${migrations}`);
  process.exit(1);
}

// `create index concurrently` and a few other statements cannot run inside a
// transaction block, and the whole point of wrapping this one is that a failure
// leaves nothing half-built. Fail loudly rather than emit a script that aborts
// halfway through.
for (const file of files) {
  if (/\bconcurrently\b/i.test(readFileSync(`${migrations}/${file}`, 'utf8'))) {
    console.error(
      `${file} uses CONCURRENTLY, which cannot run inside a transaction.\n` +
        'Split it out of the combined script before regenerating.',
    );
    process.exit(1);
  }
}

const rule = (char) => `-- ${char.repeat(73)}`;
const out = [
  rule('-'),
  '-- Every migration, in order, as one script',
  rule('-'),
  '-- GENERATED FILE — do not edit. Regenerate with',
  '--',
  '--   node scripts/build-combined-migrations.mjs',
  '--',
  '-- For the case where `supabase db push` cannot run. The CLI provisions its own',
  '-- `cli_login_postgres` role before pushing, and on a project whose postgres',
  '-- role lacks ADMIN on it that fails with:',
  '--',
  '--   permission denied to alter role',
  '--',
  '-- Paste this into the Supabase SQL Editor instead. It applies the same',
  '-- migrations and then records them in supabase_migrations.schema_migrations,',
  '-- so a later `db push` sees them as already applied rather than replaying them.',
  '--',
  '-- Wrapped in a transaction: if any statement fails, nothing is left half-built.',
  rule('-'),
  '',
  'begin;',
  '',
  '-- The CLI creates these on its first push. Nothing has pushed here yet.',
  'create schema if not exists supabase_migrations;',
  'create table if not exists supabase_migrations.schema_migrations (',
  '  version text not null primary key,',
  '  statements text[],',
  '  name text',
  ');',
  '',
];

for (const file of files) {
  const split = file.indexOf('_');
  const version = file.slice(0, split);
  const name = file.slice(split + 1).replace(/\.sql$/, '');

  out.push(
    rule('='),
    `-- ${file}`,
    rule('='),
    '',
    readFileSync(`${migrations}/${file}`, 'utf8').trimEnd(),
    '',
    `insert into supabase_migrations.schema_migrations (version, name)`,
    `values ('${version}', '${name}')`,
    `on conflict (version) do nothing;`,
    '',
  );
}

out.push(
  'commit;',
  '',
  `-- Confirm: expect one row per migration, ${files.length} in total.`,
  'select version, name from supabase_migrations.schema_migrations order by version;',
  '',
);

mkdirSync(`${root}supabase/bootstrap`, { recursive: true });
writeFileSync(target, out.join('\n'));

console.log(`Wrote supabase/bootstrap/all-migrations.sql — ${files.length} migrations.`);

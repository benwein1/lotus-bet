import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every column `queries.ts` names in a PostgREST select has to exist.
 *
 * This is here because it has now failed twice, both times the same way and
 * both times invisibly. A select that names a column the table does not have
 * — or an embed PostgREST finds ambiguous — is not partially served: the
 * whole request is rejected, so **the feed comes back empty** rather than
 * coming back without the field. The screen then draws its "nothing running
 * yet" state, which looks like an account with no bets rather than a bug.
 *
 * Nothing else in the repo catches it. Demo mode never reaches PostgREST, and
 * the SQL harness exercises the policies rather than the client's selects. So
 * the check is here, in the fast loop: read the column list straight out of
 * `queries.ts`, read the schema straight out of the migrations, and compare.
 *
 * It parses only the two shapes the migrations actually use — `create table`
 * and `alter table ... add column`. A migration that invents a third way to
 * add a column will make this test wrong rather than make it fail, which is
 * the honest limit of reading SQL with a regular expression.
 *
 * It checks columns and table names, and **not** the constraint names in an
 * embed like `bet_options!bet_options_bet_id_fkey`. Getting one of those wrong
 * breaks the select in exactly the same way, and it is the other half of this
 * bug class — it is not covered here because it needs the auto-naming rule for
 * inline foreign keys as well as the explicit `constraint` form, and a parser
 * that got that subtly wrong would fail honest selects. Check a new embed's
 * constraint name by hand.
 */

const ROOT = join(__dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/** table name → the columns the migrations give it. */
function schemaColumns(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const columnsOf = (table: string) => {
    const existing = tables.get(table);
    if (existing) return existing;
    const fresh = new Set<string>();
    tables.set(table, fresh);
    return fresh;
  };

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');

    // create table [if not exists] public.<name> ( ... );
    const creates = sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi
    );
    for (const [, table, body] of creates) {
      const columns = columnsOf(table!);
      for (const rawLine of body!.split('\n')) {
        const line = rawLine.replace(/--.*$/, '').trim();
        // A column definition opens with its name. Table-level constraints
        // open with a keyword instead, and a continuation line is indented
        // into the previous one.
        const match = /^(\w+)\s+\w/.exec(line);
        if (!match) continue;
        const name = match[1]!.toLowerCase();
        if (['primary', 'unique', 'foreign', 'check', 'constraint', 'exclude'].includes(name)) {
          continue;
        }
        columns.add(name);
      }
    }

    // alter table public.<name> add column [if not exists] <column> ...
    const adds = sql.matchAll(
      /alter\s+table\s+public\.(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi
    );
    for (const [, table, column] of adds) columnsOf(table!).add(column!.toLowerCase());
  }

  return tables;
}

/**
 * The embeds in one select string, as `{ table, columns }`.
 *
 * An embed is `alias:table(...)` or `alias:table!constraint(...)`, and its
 * body holds plain column names plus, possibly, further embeds. `*` and
 * `count` are PostgREST's own and name no column.
 */
function embedsIn(select: string): { table: string; columns: string[] }[] {
  const found: { table: string; columns: string[] }[] = [];

  for (let i = 0; i < select.length; i += 1) {
    if (select[i] !== '(') continue;

    // Walk back over `table!constraint` / `alias:table` to the table name.
    const head = select.slice(0, i);
    const match = /(?:(\w+):)?(\w+)(?:!\w+)?$/.exec(head);
    if (!match) continue;

    // Find this embed's matching close paren, then take only its *own*
    // columns — anything inside a nested embed belongs to that table.
    let depth = 0;
    let end = i;
    for (let j = i; j < select.length; j += 1) {
      if (select[j] === '(') depth += 1;
      else if (select[j] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }

    const body = select.slice(i + 1, end);
    let nesting = 0;
    let own = '';
    for (const char of body) {
      if (char === '(') nesting += 1;
      else if (char === ')') nesting -= 1;
      else if (nesting === 0) own += char;
    }

    const columns = own
      .split(',')
      .map((part) => part.trim())
      // A nested embed leaves its `alias:table!constraint` prefix behind.
      .filter((part) => part.length > 0 && !part.includes(':') && !part.includes('!'))
      .filter((part) => part !== '*' && part !== 'count');

    found.push({ table: match[2]!, columns });
  }

  return found;
}

/** The `const NAME = '...' + '...';` string literals, concatenated. */
function selectConstant(source: string, name: string): string {
  const start = source.indexOf(`const ${name} =`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(';', start);
  return source
    .slice(start, end)
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n')
    .replace(/^[^=]*=/, '')
    .split("'")
    .filter((_, index) => index % 2 === 1)
    .join('');
}

describe('the client selects only columns that exist', () => {
  const tables = schemaColumns();
  const source = readFileSync(join(ROOT, 'src', 'lib', 'queries.ts'), 'utf8');

  it('reads a schema out of the migrations at all', () => {
    // A parser that silently matched nothing would make every assertion below
    // vacuously true, which is the failure mode this whole file exists to
    // avoid — so check the shape of the thing before trusting it.
    expect(tables.get('bet_positions')).toContain('joined_at');
    expect(tables.get('bets')).toContain('total_pot_agorot');
    expect(tables.get('users')).toContain('display_name');
  });

  it.each(['BET_SELECT'])('%s names real tables and columns', (name) => {
    const embeds = embedsIn(selectConstant(source, name));
    expect(embeds.length).toBeGreaterThan(0);

    // Collected rather than asserted one at a time, so a failure names every
    // bad column at once — and names it, which `toBe(true)` on its own would
    // not. Jest's `expect` takes no message.
    const missing: string[] = [];
    for (const { table, columns } of embeds) {
      const known = tables.get(table);
      if (!known) {
        missing.push(`${table} (no migration creates this table)`);
        continue;
      }
      for (const column of columns) {
        if (!known.has(column)) missing.push(`${table}.${column}`);
      }
    }

    expect(missing).toEqual([]);
  });
});

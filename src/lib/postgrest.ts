/**
 * Reading PostgREST's rejections.
 *
 * Dependency-free on purpose: no Supabase client, no React Native globals, so
 * it can be unit-tested without mocking the platform.
 */

/**
 * True when a request failed because the project does not have `column`.
 *
 * This matters more than it sounds. A missing column makes PostgREST reject
 * the *whole* request, so one column a project has not migrated yet takes
 * down every row the query would have returned — which is how a feed full of
 * bets rendered as an empty screen with "column groups_1.avatar_url does not
 * exist" written across it. Callers use this to drop the column and retry
 * rather than to give up.
 *
 * Two shapes, because two things produce it: the SQLSTATE, which is exact,
 * and the message, which is what survives when the client only forwards a
 * string. The embedded form aliases the joined table (`groups_1.avatar_url`),
 * so the column name is matched as a substring rather than as a whole word.
 */
export function isMissingColumn(
  error: { code?: string; message: string },
  column: string
): boolean {
  if (error.code === '42703') return true;
  return error.message.includes(column) && error.message.includes('does not exist');
}

/**
 * True when the write failed because the column is absent from PostgREST's
 * cached schema. Distinct from the above: a stale cache says "could not find
 * the 'x' column of 'y' in the schema cache" with code PGRST204, and a write
 * to a column that genuinely does not exist says 42703.
 */
export function isUnknownWriteColumn(
  error: { code?: string; message: string },
  column: string
): boolean {
  if (error.code === 'PGRST204') return true;
  return isMissingColumn(error, column) || error.message.includes(`'${column}' column`);
}

/**
 * True when an RPC failed because the project does not have that function.
 *
 * The same class of problem `isMissingColumn` solves, one level up: a client
 * that has shipped ahead of the database calls a function the project has not
 * migrated yet, and the caller wants to fall back rather than show an error
 * about a name the user has never heard of.
 *
 * Two shapes again. PostgREST answers PGRST202 — "Could not find the function
 * public.x in the schema cache" — when the function is absent from its cached
 * schema, which is the case that actually happens. 42883 is Postgres's own
 * `undefined_function`, which surfaces when the call reaches the database and
 * no overload matches.
 */
export function isMissingFunction(error: { code?: string; message: string }): boolean {
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return error.message.includes('function') && error.message.includes('does not exist');
}

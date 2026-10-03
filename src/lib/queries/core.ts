/**
 * The pieces every query module shares.
 *
 * Nothing product-shaped lives here: the readable-column lists that the
 * column-level grants in `…_user_column_privileges.sql` make mandatory, the
 * unwrapper every call funnels its PostgREST result through, and the retry
 * that lets the client run against a project missing an optional group
 * column. Split out of a single 1,470-line `queries.ts` so the domain modules
 * beside it can be read one at a time.
 */
import { isMissingColumn } from '../postgrest';
import { supabase } from '../supabase';

/**
 * The columns of `public.users` a client is allowed to read.
 *
 * Not a tidiness preference — it is half of the fix in
 * `…_user_column_privileges.sql`, and the half that has to live here. RLS is
 * row-level: the policy on `users` decides whether you may see a person at
 * all, and has nothing to say about which of their columns. `users(*)` was
 * therefore handing every group member the email address, phone number and
 * device push token of everyone else in the group.
 *
 * The migration revokes those three at the column level, which makes
 * `select *` on this table an outright error ("permission denied for column
 * email") rather than a quietly narrower row. So every read site names its
 * columns, and there is exactly one list to audit.
 *
 * Adding a column to `users` does **not** add it here. Read the migration
 * before extending this.
 */
const USER_COLUMNS =
  'id, display_name, username, avatar_url, profile_completed, age_verified_at, notify_new_bets, notify_resolutions, notify_group_joins, notify_deadlines, created_at';

/** The subset needed to draw somebody: a name, a handle, a face. */
const USER_PUBLIC_COLUMNS = 'id, display_name, username, avatar_url';

export { USER_COLUMNS, USER_PUBLIC_COLUMNS };

export function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('No data returned');
  return result.data;
}


/**
 * Which optional columns of `groups` this project actually has.
 *
 * Selecting a column Postgres does not have makes PostgREST reject the whole
 * request, so a single missing column took the entire feed down rather than
 * costing one picture — the same failure mode `profile_completed` had on the
 * sign-up screen. Every read that wants one asks for it once, and if it is not
 * there, stops asking and re-runs without it.
 *
 * There are two now. `avatar_url` arrives with `…_avatars.sql` and `currency`
 * with `…_group_currency.sql`, and a project can be behind on either
 * independently, so they are tracked separately rather than as one "is this
 * project up to date" flag — dropping the photo because the currency is
 * missing would lose something the project does have.
 *
 * Each starts undecided rather than optimistic-per-call, so one probe answers
 * it for the session.
 */
type GroupColumn = 'avatar_url' | 'currency';

/**
 * What the project turned out to have. Shared rather than private because a
 * failed *write* in `groups.ts` is also evidence — see `updateGroupAvatar`.
 */
export const groupColumns: Record<GroupColumn, 'unknown' | 'yes' | 'no'> = {
  avatar_url: 'unknown',
  currency: 'unknown',
};

/** What a caller's select-builder is told to ask for. */
export interface GroupExtras {
  avatar: boolean;
  currency: boolean;
}

function currentGroupExtras(): GroupExtras {
  return {
    avatar: groupColumns.avatar_url !== 'no',
    currency: groupColumns.currency !== 'no',
  };
}

/**
 * Runs a read, dropping whichever optional group column the project turns out
 * not to have and retrying. `build` is called again for each retry so the
 * caller can hand back a fresh query — a PostgREST builder cannot be
 * re-awaited.
 *
 * At most one retry per column, so a project missing both still converges, and
 * a genuine error can never loop.
 */
export async function withGroupColumnFallback<T>(
  build: (
    extras: GroupExtras
  ) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>
): Promise<T> {
  const optional: GroupColumn[] = ['avatar_url', 'currency'];

  for (let attempt = 0; attempt <= optional.length; attempt += 1) {
    const extras = currentGroupExtras();
    const result = await build(extras);

    if (!result.error) {
      for (const column of optional) {
        if (groupColumns[column] === 'unknown') groupColumns[column] = 'yes';
      }
      if (result.data === null) throw new Error('No data returned');
      return result.data;
    }

    const culprit = optional.find(
      (column) => groupColumns[column] !== 'no' && isMissingColumn(result.error!, column)
    );
    if (!culprit) throw new Error(result.error.message);
    groupColumns[culprit] = 'no';
  }

  throw new Error('Could not read the group columns');
}


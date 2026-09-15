// POST /functions/v1/sweep-media  { olderThanDays?: number, dryRun?: boolean }
//
// Deletes the photos and video attached to bets that were cancelled a while
// ago. Nothing is owed on a cancelled bet, so its media is not evidence of
// anything — SCALEABILITY.md §4 item 4.
//
// **Not called from the app.** There is no user on whose behalf this runs and
// nothing in the UI should be able to trigger a bulk delete. It is scheduled:
// either `pg_cron` calling it with the service-role key, or any scheduler that
// can make an authenticated POST once a day. `supabase/admin/review_queue.sql`
// documents the pg_cron form.
//
// **Order matters.** Objects go first, rows second. Die in between and the row
// is still there, so the next run finds it again and finishes the job. The
// other order strands bytes that nothing points at and nothing will ever list
// again — which is the exact failure `discardUploads` exists to avoid on the
// upload path.
import { adminClient, corsHeaders, errorResponse, HttpError, json } from '../_shared/supabase.ts';

interface Sweepable {
  id: string;
  storage_path: string;
  bytes: number | null;
}

/** Storage's remove() takes a list; a few hundred paths at a time is plenty. */
const BATCH = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // The caller is a scheduler holding the service-role key, not a person.
    // `requireUser` is deliberately not used: there is no user here, and a
    // function that accepted one would be a bulk delete anybody could reach.
    const auth = req.headers.get('Authorization') ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token || token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      throw new HttpError(401, 'This function is scheduled, not called.');
    }

    const body = (await req.json().catch(() => ({}))) as {
      olderThanDays?: number;
      dryRun?: boolean;
    };
    const days = Number.isFinite(body.olderThanDays) ? Number(body.olderThanDays) : 30;
    if (days < 1) throw new HttpError(400, 'olderThanDays must be at least 1.');

    const db = adminClient();
    const { data, error } = await db.rpc('sweepable_media', {
      p_older_than: `${days} days`,
    });
    if (error) throw new HttpError(500, error.message);

    const rows = (data ?? []) as Sweepable[];
    const freed = rows.reduce((total, row) => total + (row.bytes ?? 0), 0);

    if (body.dryRun) {
      return json({ dryRun: true, found: rows.length, bytes: freed });
    }

    let removed = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);

      const { error: storageError } = await db.storage
        .from('bet-media')
        .remove(batch.map((row) => row.storage_path));
      // An object that is already gone is not a failure — it is the previous
      // run having died between the two deletes. Anything else stops the sweep
      // rather than deleting rows whose bytes are still there.
      if (storageError && !/not found/i.test(storageError.message)) {
        throw new HttpError(500, storageError.message);
      }

      const { error: rowError } = await db
        .from('bet_media')
        .delete()
        .in('id', batch.map((row) => row.id));
      if (rowError) throw new HttpError(500, rowError.message);

      removed += batch.length;
    }

    return json({ removed, bytes: freed });
  } catch (err) {
    return errorResponse(err);
  }
});

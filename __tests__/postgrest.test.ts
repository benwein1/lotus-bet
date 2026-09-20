import { isMissingColumn, isMissingFunction, isUnknownWriteColumn } from '../src/lib/postgrest';

/**
 * A missing column makes PostgREST reject the *whole* request, so one column
 * the project has not migrated yet takes down every row the query would have
 * returned. That is how a feed full of bets rendered as an empty screen with
 * "column groups_1.avatar_url does not exist" over it.
 *
 * These are the real messages, taken from PostgreSQL 16 and from the error a
 * user actually saw, not invented ones.
 */
describe('isMissingColumn', () => {
  it('matches on the SQLSTATE, whatever the wording', () => {
    expect(isMissingColumn({ code: '42703', message: 'anything at all' }, 'avatar_url')).toBe(true);
  });

  it('matches the plain message from a direct select', () => {
    expect(
      isMissingColumn({ message: 'column "avatar_url" does not exist' }, 'avatar_url')
    ).toBe(true);
  });

  it('matches the embedded form, where PostgREST has aliased the table', () => {
    // Exactly what reached the screen.
    expect(
      isMissingColumn({ message: 'column groups_1.avatar_url does not exist' }, 'avatar_url')
    ).toBe(true);
  });

  it('does not match a different column', () => {
    expect(
      isMissingColumn({ message: 'column groups_1.emoji does not exist' }, 'avatar_url')
    ).toBe(false);
  });

  it('does not swallow unrelated failures', () => {
    expect(isMissingColumn({ message: 'JWT expired' }, 'avatar_url')).toBe(false);
    expect(
      isMissingColumn({ code: '42501', message: 'permission denied for table groups' }, 'avatar_url')
    ).toBe(false);
  });
});

describe('isUnknownWriteColumn', () => {
  it('matches the stale-schema-cache rejection a write gets', () => {
    // What sign-up hit on a project without the email-auth migration.
    expect(
      isUnknownWriteColumn(
        { message: "Could not find the 'profile_completed' column of 'users' in the schema cache" },
        'profile_completed'
      )
    ).toBe(true);
    expect(isUnknownWriteColumn({ code: 'PGRST204', message: '' }, 'anything')).toBe(true);
  });

  it('also covers the plain undefined-column case', () => {
    expect(
      isUnknownWriteColumn({ code: '42703', message: 'column "x" does not exist' }, 'x')
    ).toBe(true);
  });

  it('does not swallow unrelated failures', () => {
    expect(isUnknownWriteColumn({ message: 'JWT expired' }, 'profile_completed')).toBe(false);
  });
});

describe('isMissingFunction', () => {
  it('reads PostgREST saying the function is not in its schema cache', () => {
    expect(
      isMissingFunction({
        code: 'PGRST202',
        message: 'Could not find the function public.my_totals_by_currency without parameters',
      })
    ).toBe(true);
  });

  it("reads Postgres's own undefined_function", () => {
    expect(isMissingFunction({ code: '42883', message: 'function foo() does not exist' })).toBe(
      true
    );
  });

  it('falls back to the message when only a string survives', () => {
    expect(isMissingFunction({ message: 'function public.bar(text) does not exist' })).toBe(true);
  });

  it('does not claim a missing column is a missing function', () => {
    // The two get different fallbacks, so confusing them means retrying the
    // wrong thing and failing twice.
    expect(
      isMissingFunction({ code: '42703', message: 'column groups_1.currency does not exist' })
    ).toBe(false);
  });

  it('leaves a real error alone', () => {
    expect(isMissingFunction({ code: '42501', message: 'permission denied' })).toBe(false);
  });
});

import { isMissingColumn, isUnknownWriteColumn } from '../src/lib/postgrest';

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

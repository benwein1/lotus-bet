import {
  authRedirectError,
  authRedirectParams,
  isRecoveryRedirect,
  recoveryTokens,
} from '@/lib/auth-links';

/** What GoTrue actually lands on under the implicit flow. */
const WEB_RECOVERY =
  'https://lotus-bet.example.workers.dev/reset-password' +
  '#access_token=eyJhbGciOiJIUzI1NiJ9.aaa&expires_at=1789000000&expires_in=3600' +
  '&refresh_token=rt_abc123&token_type=bearer&type=recovery';

const NATIVE_RECOVERY =
  'lotusbet://reset-password#access_token=eyJhbGciOiJIUzI1NiJ9.aaa' +
  '&refresh_token=rt_abc123&token_type=bearer&type=recovery';

const EXPIRED =
  'https://lotus-bet.example.workers.dev/reset-password' +
  '#error=access_denied&error_code=otp_expired' +
  '&error_description=Email+link+is+invalid+or+has+expired';

describe('authRedirectParams', () => {
  it('reads the fragment', () => {
    expect(authRedirectParams(WEB_RECOVERY)).toMatchObject({
      access_token: 'eyJhbGciOiJIUzI1NiJ9.aaa',
      refresh_token: 'rt_abc123',
      type: 'recovery',
    });
  });

  it('reads a custom scheme the same way', () => {
    expect(authRedirectParams(NATIVE_RECOVERY).type).toBe('recovery');
  });

  it('reads the query string too', () => {
    expect(authRedirectParams('https://x.test/reset-password?type=recovery&code=abc')).toEqual({
      type: 'recovery',
      code: 'abc',
    });
  });

  it('lets the fragment win a collision, because that is where a session is', () => {
    const url = 'https://x.test/r?type=signup#type=recovery&access_token=a&refresh_token=b';
    expect(authRedirectParams(url).type).toBe('recovery');
  });

  it('decodes percent-escapes and plus-encoded spaces', () => {
    expect(authRedirectParams(EXPIRED).error_description).toBe(
      'Email link is invalid or has expired'
    );
  });

  it('is empty for an ordinary URL', () => {
    expect(authRedirectParams('https://x.test/reset-password')).toEqual({});
  });

  it('survives junk rather than throwing', () => {
    expect(() => authRedirectParams('https://x.test/r#%E0%A4%A&=&a=1&&b')).not.toThrow();
    expect(authRedirectParams('https://x.test/r#a=1&&b').a).toBe('1');
  });
});

describe('isRecoveryRedirect', () => {
  it('recognises a reset link on both platforms', () => {
    expect(isRecoveryRedirect(WEB_RECOVERY)).toBe(true);
    expect(isRecoveryRedirect(NATIVE_RECOVERY)).toBe(true);
  });

  it('does not fire on an ordinary page load', () => {
    expect(isRecoveryRedirect('https://lotus-bet.example.workers.dev/')).toBe(false);
    expect(isRecoveryRedirect('https://lotus-bet.example.workers.dev/reset-password')).toBe(false);
  });

  it('does not fire on a magic-link or signup redirect', () => {
    expect(isRecoveryRedirect('https://x.test/#access_token=a&type=signup')).toBe(false);
  });

  it('does not fire on a refused link — that is not a recovery, it is an error', () => {
    expect(isRecoveryRedirect(EXPIRED)).toBe(false);
  });

  // The latch has to engage before the session is confirmed, or the redirect
  // gate gets a frame in which a recovery session looks ordinary.
  it('fires without tokens present', () => {
    expect(isRecoveryRedirect('https://x.test/reset-password#type=recovery')).toBe(true);
  });
});

describe('recoveryTokens', () => {
  it('lifts both tokens out of a deep link', () => {
    expect(recoveryTokens(NATIVE_RECOVERY)).toEqual({
      accessToken: 'eyJhbGciOiJIUzI1NiJ9.aaa',
      refreshToken: 'rt_abc123',
    });
  });

  it('refuses a link that is not a recovery', () => {
    expect(recoveryTokens('lotusbet://x#access_token=a&refresh_token=b&type=signup')).toBeNull();
  });

  it('refuses a half-complete pair rather than calling setSession with junk', () => {
    expect(recoveryTokens('lotusbet://x#access_token=a&type=recovery')).toBeNull();
    expect(recoveryTokens('lotusbet://x#refresh_token=b&type=recovery')).toBeNull();
  });

  it('refuses an ordinary URL', () => {
    expect(recoveryTokens('lotusbet://reset-password')).toBeNull();
  });
});

describe('authRedirectError', () => {
  it('prefers GoTrue’s sentence over its code', () => {
    expect(authRedirectError(EXPIRED)).toBe('Email link is invalid or has expired');
  });

  it('falls back to the code', () => {
    expect(authRedirectError('https://x.test/r#error=access_denied')).toBe('access_denied');
  });

  it('is null when nothing went wrong', () => {
    expect(authRedirectError(WEB_RECOVERY)).toBeNull();
  });
});

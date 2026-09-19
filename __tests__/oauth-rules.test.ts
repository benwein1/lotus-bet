import {
  appleDisplayName,
  friendlyOAuthError,
  needsTermsAcceptance,
  oauthTokens,
  providerDisplayName,
} from '@/lib/oauth-rules';

describe('appleDisplayName', () => {
  it('joins the two parts Apple gives', () => {
    expect(appleDisplayName({ givenName: 'Dor', familyName: 'Levi' })).toBe('Dor Levi');
  });

  it('accepts only one half', () => {
    expect(appleDisplayName({ givenName: 'Dor', familyName: null })).toBe('Dor');
    expect(appleDisplayName({ givenName: null, familyName: 'Levi' })).toBe('Levi');
  });

  // Apple returns `fullName: null` on every authorisation after the first, so
  // this is the common case, not the edge case.
  it('is null when Apple gives nothing', () => {
    expect(appleDisplayName(null)).toBeNull();
    expect(appleDisplayName(undefined)).toBeNull();
    expect(appleDisplayName({ givenName: null, familyName: null })).toBeNull();
  });

  it('treats blank and whitespace-only parts as absent', () => {
    expect(appleDisplayName({ givenName: '  ', familyName: '' })).toBeNull();
    expect(appleDisplayName({ givenName: ' Dor ', familyName: '  ' })).toBe('Dor');
  });

  // `users_display_name_length` caps this at 40. Clamping here means a long
  // name shortens rather than failing a constraint after the account exists.
  it('clamps to the length the database allows', () => {
    const long = appleDisplayName({ givenName: 'A'.repeat(30), familyName: 'B'.repeat(30) });
    expect(long).toHaveLength(40);
  });
});

describe('providerDisplayName', () => {
  it("prefers the app's own key over a provider's", () => {
    expect(
      providerDisplayName({ display_name: 'Chosen', full_name: 'Provider', name: 'Other' })
    ).toBe('Chosen');
  });

  it('falls back through full_name then name', () => {
    expect(providerDisplayName({ full_name: 'Dana Peretz', name: 'dana' })).toBe('Dana Peretz');
    expect(providerDisplayName({ name: 'Dana Peretz' })).toBe('Dana Peretz');
  });

  it('is null for an account the provider told us nothing about', () => {
    expect(providerDisplayName(null)).toBeNull();
    expect(providerDisplayName({})).toBeNull();
    expect(providerDisplayName({ full_name: '   ' })).toBeNull();
  });

  it('ignores a non-string value rather than rendering it', () => {
    expect(providerDisplayName({ full_name: 42, name: 'Real' })).toBe('Real');
  });
});

describe('oauthTokens', () => {
  it('reads both tokens out of the fragment', () => {
    const url =
      'betta://#access_token=abc123&refresh_token=def456&token_type=bearer&expires_in=3600';
    expect(oauthTokens(url)).toEqual({ accessToken: 'abc123', refreshToken: 'def456' });
  });

  it('reads them from the query when that is where they are', () => {
    expect(oauthTokens('https://app.example/?access_token=a&refresh_token=b')).toEqual({
      accessToken: 'a',
      refreshToken: 'b',
    });
  });

  // A session that cannot be refreshed signs somebody out an hour later for no
  // reason they could see, so half a pair is treated as none.
  it('refuses an access token with no refresh token', () => {
    expect(oauthTokens('betta://#access_token=abc123')).toBeNull();
  });

  it('is null for a redirect carrying an error instead', () => {
    expect(oauthTokens('betta://#error=access_denied&error_description=User+cancelled')).toBeNull();
  });

  it('is null for a plain URL', () => {
    expect(oauthTokens('betta://')).toBeNull();
  });
});

describe('needsTermsAcceptance', () => {
  it('is true for an account that has agreed to nothing', () => {
    expect(needsTermsAcceptance(null, '2026-09-14')).toBe(true);
    expect(needsTermsAcceptance(undefined, '2026-09-14')).toBe(true);
    expect(needsTermsAcceptance('', '2026-09-14')).toBe(true);
  });

  it('is false once the current version is on the row', () => {
    expect(needsTermsAcceptance('2026-09-14', '2026-09-14')).toBe(false);
  });

  // The whole reason the column holds a version rather than a boolean: when
  // the wording changes, everyone who agreed to the old one is asked again.
  it('is true for an account holding an older version', () => {
    expect(needsTermsAcceptance('2025-01-01', '2026-09-14')).toBe(true);
  });
});

describe('friendlyOAuthError', () => {
  // An empty string is the signal for "they cancelled" — nothing to show.
  it('says nothing when the person backed out', () => {
    expect(friendlyOAuthError('apple', 'The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)')).toBe('');
    expect(friendlyOAuthError('google', 'User cancelled the flow')).toBe('');
  });

  it('names a provider that is not switched on, rather than echoing Supabase', () => {
    expect(friendlyOAuthError('google', 'Unsupported provider: provider is not enabled')).toBe(
      'Google sign-in is not switched on for this project yet.'
    );
  });

  it('recognises a connection failure', () => {
    expect(friendlyOAuthError('apple', 'Network request failed')).toMatch(/connection/i);
  });

  it('falls back to a sentence naming the provider', () => {
    expect(friendlyOAuthError('apple', 'something unexpected')).toBe(
      'Could not sign you in with Apple.'
    );
  });
});

import {
  INVITE_PATH,
  inviteExpiry,
  inviteMessage,
  inviteShareText,
  inviteUrl,
} from '../src/lib/invite-links';

const WEB = { webOrigin: 'https://betta.example.com', scheme: 'betta' };
const NO_WEB = { webOrigin: null, scheme: 'betta' };

describe('inviteUrl', () => {
  it('prefers the https origin', () => {
    expect(inviteUrl('abc123', WEB)).toBe('https://betta.example.com/join/abc123');
  });

  it('falls back to the app scheme when nothing is deployed', () => {
    expect(inviteUrl('abc123', NO_WEB)).toBe('betta://join/abc123');
  });

  it('does not double the slash when the origin has a trailing one', () => {
    expect(inviteUrl('abc', { ...WEB, webOrigin: 'https://x.dev/' })).toBe(
      'https://x.dev/join/abc'
    );
  });

  it('trims whitespace picked up from a paste', () => {
    expect(inviteUrl('  abc123 \n', WEB)).toBe('https://betta.example.com/join/abc123');
  });

  it('escapes a token so base64url padding can never break the path', () => {
    // The RPC mints base64url, which has no `+` or `/`. Encoding anyway means a
    // token minted by anything else still produces a single-segment URL.
    expect(inviteUrl('a+b/c=', WEB)).toBe('https://betta.example.com/join/a%2Bb%2Fc%3D');
  });

  it('uses the same path segment the route is named after', () => {
    expect(inviteUrl('t', WEB)).toContain(`/${INVITE_PATH}/`);
  });
});

describe('inviteMessage', () => {
  it('names the inviter when there is one', () => {
    expect(inviteMessage('Sunday League', 'Dor')).toContain('Dor wants you in "Sunday League"');
  });

  it('stands on its own without a name', () => {
    const text = inviteMessage('Sunday League');
    expect(text).toContain('Join "Sunday League"');
    expect(text).not.toContain('undefined');
  });

  it('survives a group with no usable name', () => {
    expect(inviteMessage('   ')).toContain('"a group"');
  });

  it('keeps the URL out of the message', () => {
    // iOS takes message and url separately and renders its own preview;
    // interpolating the link here would show it twice.
    expect(inviteMessage('Sunday League', 'Dor')).not.toContain('http');
  });
});

describe('inviteShareText', () => {
  it('joins the two for anywhere that only takes one string', () => {
    const text = inviteShareText('Sunday League', 'https://x.dev/join/t', 'Dor');
    expect(text.startsWith('Dor wants you in')).toBe(true);
    expect(text.endsWith('https://x.dev/join/t')).toBe(true);
  });
});

describe('inviteExpiry', () => {
  const now = Date.parse('2026-09-12T12:00:00Z');
  const inHours = (h: number) => new Date(now + h * 3_600_000).toISOString();

  it('counts whole days out', () => {
    expect(inviteExpiry(inHours(24 * 6 + 3), now)).toBe('Expires in 6 days');
  });

  it('singularises one day', () => {
    expect(inviteExpiry(inHours(25), now)).toBe('Expires in 1 day');
  });

  it('switches to hours inside a day', () => {
    expect(inviteExpiry(inHours(5), now)).toBe('Expires in 5 hours');
  });

  it('switches to minutes inside an hour', () => {
    expect(inviteExpiry(inHours(0.5), now)).toBe('Expires in 30 minutes');
  });

  it('never says zero — a link with seconds left still has a minute', () => {
    expect(inviteExpiry(new Date(now + 20_000).toISOString(), now)).toBe('Expires in 1 minute');
  });

  it('says so once it is past', () => {
    expect(inviteExpiry(inHours(-1), now)).toBe('Expired');
  });

  it('says nothing rather than NaN on a bad timestamp', () => {
    expect(inviteExpiry('not a date', now)).toBe('');
  });
});

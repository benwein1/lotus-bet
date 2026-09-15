import { classifyFailure, describeFailure } from '@/lib/errors';

/**
 * The reason this module exists is a specific review scenario: App Review tests
 * in Airplane Mode, and "Failed to fetch" there reads as a broken app rather
 * than an offline one. So the tests that matter are the real strings the
 * platforms actually throw — not invented ones.
 */

describe('offline — what a request that reached nothing looks like', () => {
  // These are verbatim from the runtimes, which is the point: a paraphrase
  // would pass while the real string fell through to 'unknown'.
  const realWorld = [
    'Network request failed', // React Native
    'TypeError: Failed to fetch', // Chrome, Firefox
    'Load failed', // Safari
    'TypeError: Network request failed',
    'net::ERR_INTERNET_DISCONNECTED',
    'The Internet connection appears to be offline.',
  ];

  it.each(realWorld)('classifies %p as offline', (message) => {
    expect(classifyFailure(new Error(message)).kind).toBe('offline');
  });

  it('says something a person can act on', () => {
    expect(describeFailure(new Error('Network request failed'))).toMatch(/offline/i);
  });
});

describe('expired sessions', () => {
  const realWorld = [
    'JWT expired',
    'invalid JWT: unable to parse or verify signature',
    'Invalid Refresh Token: Refresh Token Not Found',
    'Invalid Refresh Token: Already Used',
    'Unauthorized',
  ];

  it.each(realWorld)('classifies %p as expired', (message) => {
    expect(classifyFailure(new Error(message)).kind).toBe('expired');
  });

  it('offers the one action that helps', () => {
    expect(describeFailure(new Error('JWT expired'))).toMatch(/sign in again/i);
  });
});

describe('rate limits, ours and theirs', () => {
  it('passes our own trigger message through unchanged', () => {
    // `enforce_write_rate` already writes a sentence aimed at a person.
    // Replacing it with a generic one would be a downgrade.
    const message = 'Slow down. That is 30 in 01:00:00, which is the limit.';
    const failure = classifyFailure(new Error(message));
    expect(failure.kind).toBe('slow-down');
    expect(failure.message).toBe(message);
  });

  it('recognises GoTrue throttling', () => {
    expect(
      classifyFailure(
        new Error('For security purposes, you can only request this after 51 seconds.')
      ).kind
    ).toBe('slow-down');
  });

  it('recognises the raw errcode', () => {
    expect(classifyFailure(new Error('53400')).kind).toBe('slow-down');
  });
});

describe('an unreachable project', () => {
  it.each([
    'Project is paused',
    'Service Unavailable',
    'upstream connect error or disconnect/reset before headers',
  ])('classifies %p as unavailable', (message) => {
    expect(classifyFailure(new Error(message)).kind).toBe('unavailable');
  });
});

describe('everything else is reported as it came', () => {
  it('keeps a message it does not recognise', () => {
    const failure = classifyFailure(new Error('A bet needs at least two options.'));
    expect(failure.kind).toBe('unknown');
    expect(failure.message).toBe('A bet needs at least two options.');
  });

  // A blank notice is worse than a vague one — it looks like a rendering bug.
  it('never produces an empty message', () => {
    for (const value of [null, undefined, '', new Error(''), {}, 0]) {
      expect(describeFailure(value).length).toBeGreaterThan(0);
    }
  });

  it('reads a message off a plain object, which is what PostgREST throws', () => {
    expect(classifyFailure({ message: 'JWT expired' }).kind).toBe('expired');
    expect(classifyFailure({ error_description: 'Network request failed' }).kind).toBe(
      'offline'
    );
  });

  it('takes a bare string', () => {
    expect(classifyFailure('Failed to fetch').kind).toBe('offline');
  });
});

describe('ordering', () => {
  // A rate-limit message can carry a status code, and a dead session is
  // actionable where an outage is not — so the order of the checks is part of
  // the behaviour, not an implementation detail.
  it('prefers slow-down over a status code it also mentions', () => {
    expect(classifyFailure(new Error('429 Too Many Requests')).kind).toBe('slow-down');
  });

  it('prefers expired over unavailable', () => {
    expect(classifyFailure(new Error('Unauthorized (503 upstream)')).kind).toBe('expired');
  });
});

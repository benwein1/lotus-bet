import type { BetMediaPurpose } from '../src/lib/database.types';
import { splitMedia } from '../src/lib/media-rules';

/**
 * `splitMedia` decides what the top of the bet screen shows. Getting it wrong
 * in the permissive direction means a photo somebody added *after* the result
 * silently becomes the bet's own illustration — which is the one failure mode
 * worth a test, because it looks fine until you know what you are looking at.
 */
describe('splitMedia', () => {
  const attachment = { id: 'a', purpose: 'attachment' as const };
  const proof = { id: 'p', purpose: 'proof' as const };
  // Written before the column existed: the property is genuinely absent,
  // not set to something. Typed so TS models that rather than a typo.
  const legacy: { id: string; purpose?: BetMediaPurpose } = { id: 'l' };

  it('separates the two kinds', () => {
    const { attachments, proof: receipts } = splitMedia([attachment, proof]);
    expect(attachments.map((m) => m.id)).toEqual(['a']);
    expect(receipts.map((m) => m.id)).toEqual(['p']);
  });

  it('treats a row with no purpose as an attachment', () => {
    // Not a guess: until `purpose` existed the only writer was the creator
    // posting a bet, so every legacy row is an attachment by construction.
    const { attachments, proof: receipts } = splitMedia([legacy]);
    expect(attachments.map((m) => m.id)).toEqual(['l']);
    expect(receipts).toEqual([]);
  });

  it('never promotes proof into the hero slot', () => {
    const { attachments } = splitMedia([proof, proof, proof]);
    expect(attachments).toEqual([]);
  });

  it('preserves order within each kind', () => {
    const rows = [
      { id: '1', purpose: 'attachment' as const },
      { id: '2', purpose: 'proof' as const },
      { id: '3', purpose: 'attachment' as const },
      { id: '4', purpose: 'proof' as const },
    ];
    const { attachments, proof: receipts } = splitMedia(rows);
    expect(attachments.map((m) => m.id)).toEqual(['1', '3']);
    expect(receipts.map((m) => m.id)).toEqual(['2', '4']);
  });

  it('handles an empty list', () => {
    expect(splitMedia([])).toEqual({ attachments: [], proof: [] });
  });
});

import { isForfeit, stakeLabel } from '@/lib/currency';

/**
 * A bet has a pot or a forfeit, never both — the database enforces that with
 * a constraint. These hold the client's half: that one helper decides which
 * one a screen prints, so the feed card, the bet screen and the group row
 * cannot answer "what is at stake here" three different ways about the same
 * bet.
 */
describe('stakeLabel', () => {
  it('prints the money when there is no forfeit', () => {
    expect(stakeLabel({ total_pot_agorot: 10000 }, 'USD')).toBe('$100');
    expect(stakeLabel({ total_pot_agorot: 10000, stake_text: null }, 'USD')).toBe('$100');
  });

  it('prints the forfeit verbatim when there is one', () => {
    // Verbatim on purpose: a forfeit is somebody's own words, and the screens
    // clamp the line rather than the app abbreviating them.
    expect(stakeLabel({ total_pot_agorot: 0, stake_text: 'Loser buys dinner' }, 'USD')).toBe(
      'Loser buys dinner'
    );
  });

  it('treats whitespace as no forfeit at all', () => {
    // A field somebody tabbed through is not a stake, and it must not shadow
    // the pot — which is the failure that would print "$0.00" as a blank.
    expect(stakeLabel({ total_pot_agorot: 2500, stake_text: '   ' }, 'USD')).toBe('$25');
    expect(isForfeit({ stake_text: '   ' })).toBe(false);
    expect(isForfeit({ stake_text: undefined })).toBe(false);
    expect(isForfeit({ stake_text: 'Pushups' })).toBe(true);
  });

  it('follows the group currency, like every other figure', () => {
    expect(stakeLabel({ total_pot_agorot: 10000 }, 'EUR')).toBe('€100');
  });
});

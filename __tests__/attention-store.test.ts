import {
  clearAttentionCount,
  getAttentionCount,
  setAttentionCount,
} from '@/lib/attention-store';

/**
 * The badge's one number. These are the rules that stop a derived count
 * reaching the tab bar as NaN, as a fraction, or as the previous account's.
 */
describe('attention store', () => {
  beforeEach(() => clearAttentionCount());

  it('starts at nothing', () => {
    expect(getAttentionCount()).toBe(0);
  });

  it('holds what it is given', () => {
    setAttentionCount(3);
    expect(getAttentionCount()).toBe(3);
  });

  it('floors a fraction rather than badging "2.7"', () => {
    setAttentionCount(2.7);
    expect(getAttentionCount()).toBe(2);
  });

  it('treats nonsense as nothing', () => {
    setAttentionCount(5);
    setAttentionCount(Number.NaN);
    expect(getAttentionCount()).toBe(0);

    setAttentionCount(5);
    setAttentionCount(-4);
    expect(getAttentionCount()).toBe(0);
  });

  it('clears, so the next account on the device inherits no badge', () => {
    setAttentionCount(9);
    clearAttentionCount();
    expect(getAttentionCount()).toBe(0);
  });
});

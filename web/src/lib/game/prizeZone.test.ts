import { describe, expect, it } from 'vitest';
import { prizeZone, visiblePrizeSlots } from './prizeZone';

describe('prize zone', () => {
  it('keeps setup state with the remaining prize cards', () => {
    const zone = prizeZone(
      Array.from({ length: 3 }, () => ({ name: 'Card', fullName: 'Card' })),
      true,
    );

    expect(zone).toMatchObject({ setup: true, remaining: 3 });
    expect(visiblePrizeSlots(zone)).toEqual([0, 1, 2]);
  });

  it('caps visible slots at the maximum prize layout', () => {
    const zone = prizeZone(
      Array.from({ length: 8 }, () => ({ name: 'Card', fullName: 'Card' })),
      true,
    );

    expect(visiblePrizeSlots(zone)).toHaveLength(6);
  });
});

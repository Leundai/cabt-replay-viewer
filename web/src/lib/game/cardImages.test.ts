import { describe, expect, it } from 'vitest';
import { safeCardImageUrl } from './cardImages';

describe('safeCardImageUrl', () => {
  it('allows known card-art hosts and local assets', () => {
    expect(safeCardImageUrl('/assets/cardback.png')).toBe('/assets/cardback.png');
    expect(safeCardImageUrl('https://images.pokemontcg.io/sv1/1.png')).toBe('https://images.pokemontcg.io/sv1/1.png');
    expect(safeCardImageUrl('https://images.scrydex.com/pokemon/me2-1/large')).toBe('https://images.scrydex.com/pokemon/me2-1/large');
  });

  it('rejects script, data, and arbitrary remote image URLs', () => {
    expect(safeCardImageUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeCardImageUrl('data:image/svg+xml,<svg></svg>')).toBeUndefined();
    expect(safeCardImageUrl('https://attacker.example/card.png')).toBeUndefined();
  });
});

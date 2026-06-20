import { describe, expect, it } from 'vitest';
import { energyIconSrc, normalizedTypeName, pokemonTypeIconSrc, pokemonTypeLabelFor } from './energyIcons';

describe('energy and Pokemon type icon helpers', () => {
  it('renders every energy with the consistent type-symbol family', () => {
    // Special energies use their type (named-type specials resolve their type,
    // others fall back to colorless) — never one-off card artwork.
    expect(energyIconSrc({ name: 'Double Turbo Energy' })).toBe('/assets/energy-icons/colorless.webp');
    expect(energyIconSrc({ name: 'Rock Fighting Energy' })).toBe('/assets/energy-icons/fighting.webp');
    expect(energyIconSrc({ name: 'Growth Grass Energy' })).toBe('/assets/energy-icons/grass.webp');
  });

  it('resolves basic energy artwork from card names', () => {
    expect(energyIconSrc({ name: 'Basic Psychic Energy' })).toBe('/assets/energy-icons/psychic.webp');
    expect(energyIconSrc({ name: 'Basic {G} Energy' })).toBe('/assets/energy-icons/grass.webp');
    expect(energyIconSrc({ name: 'Basic Energy', energyType: 'Grass' })).toBe('/assets/energy-icons/grass.webp');
    expect(energyIconSrc({ name: 'Unknown Special Energy' })).toBe('/assets/energy-icons/colorless.webp');
  });

  it('normalizes card type values for Pokemon badges', () => {
    expect(normalizedTypeName('{G}')).toBe('grass');
    expect(normalizedTypeName('Dark')).toBe('darkness');
    expect(pokemonTypeIconSrc('Fire')).toBe('/assets/energy-icons/fire.webp');
    expect(pokemonTypeLabelFor('Psychic')).toBe('Psychic');
    expect(pokemonTypeLabelFor(undefined)).toBe('Pokemon');
  });
});

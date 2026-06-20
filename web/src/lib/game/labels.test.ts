import { describe, expect, it } from 'vitest';
import { labelFor } from './labels';

describe('labelFor', () => {
  it('uses curated labels for known prompt class names', () => {
    expect(labelFor('AttachEnergyPrompt')).toBe('Attach energy');
    expect(labelFor('WaitPrompt')).toBe('Waiting');
  });

  it('humanizes SCREAMING_SNAKE_CASE messages', () => {
    expect(labelFor('CHOOSE_STARTING_POKEMONS')).toBe('Choose starting Pokemon');
    expect(labelFor('LOG_PLAYER_DRAWS_CARD')).toBe('Drew a card');
  });

  it('sentence-cases PascalCase SelectContext enums and preserves proper nouns', () => {
    expect(labelFor('DiscardEnergy')).toBe('Discard energy');
    expect(labelFor('AttachFrom')).toBe('Attach from');
    expect(labelFor('ToHand')).toBe('To hand');
    expect(labelFor('SetupActivePokemon')).toBe('Setup active Pokemon');
    expect(labelFor('SetupBenchPokemon')).toBe('Setup bench Pokemon');
    expect(labelFor('DrawCount')).toBe('Draw count');
  });

  it('gives natural phrasing to overridden enums', () => {
    expect(labelFor('YesNo')).toBe('Yes / No');
    expect(labelFor('IsFirst')).toBe('Go first?');
  });

  it('leaves single capitalized words and sentences untouched', () => {
    expect(labelFor('Energy')).toBe('Energy');
    expect(labelFor('Switch')).toBe('Switch');
    expect(labelFor('Unable to load replay.')).toBe('Unable to load replay.');
  });

  it('returns an empty string for non-string input', () => {
    expect(labelFor(undefined)).toBe('');
    expect(labelFor(42)).toBe('');
  });
});

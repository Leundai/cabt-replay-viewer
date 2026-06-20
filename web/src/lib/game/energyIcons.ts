const basicEnergyIcons: Array<[RegExp, string]> = [
  [/\{G\}\s*Energy\b/i, 'grass'],
  [/\{R\}\s*Energy\b/i, 'fire'],
  [/\{W\}\s*Energy\b/i, 'water'],
  [/\{L\}\s*Energy\b/i, 'lightning'],
  [/\{P\}\s*Energy\b/i, 'psychic'],
  [/\{F\}\s*Energy\b/i, 'fighting'],
  [/\{D\}\s*Energy\b/i, 'darkness'],
  [/\{M\}\s*Energy\b/i, 'metal'],
  [/\bGrass Energy\b/i, 'grass'],
  [/\bFire Energy\b/i, 'fire'],
  [/\bWater Energy\b/i, 'water'],
  [/\bLightning Energy\b/i, 'lightning'],
  [/\bPsychic Energy\b/i, 'psychic'],
  [/\bFighting Energy\b/i, 'fighting'],
  [/\bDarkness Energy\b/i, 'darkness'],
  [/\bDark Energy\b/i, 'darkness'],
  [/\bMetal Energy\b/i, 'metal'],
  [/\bFairy Energy\b/i, 'fairy'],
  [/\bColorless Energy\b/i, 'colorless'],
];

/**
 * One consistent icon family for EVERY attached energy. Basic and special energy
 * alike resolve to the matte type symbol in /assets/energy-icons — derived from
 * the energy's type (its name for the type-named specials like "Rock Fighting
 * Energy", otherwise its energyType), falling back to colorless. We deliberately
 * no longer mix in the per-card special-energy artwork, which read as a jumble of
 * mismatched styles next to the clean type symbols. (The exact special-energy
 * identity is still available by inspecting the Pokemon.)
 */
export function energyIconSrc(card: { name?: string; fullName?: string; energyType?: string }): string {
  const name = card.name || card.fullName || '';
  const basic = basicEnergyIcons.find(([pattern]) => pattern.test(name));
  const type = basic?.[1] ?? normalizedTypeName(card.energyType);
  return type ? `/assets/energy-icons/${type}.webp` : '/assets/energy-icons/colorless.webp';
}

export function normalizedTypeName(cardType: string | undefined): string | undefined {
  return energyIconName(cardType);
}

export function pokemonTypeIconSrc(cardType: string | undefined): string | undefined {
  const type = normalizedTypeName(cardType);
  return type ? `/assets/energy-icons/${type}.webp` : undefined;
}

export function pokemonTypeLabelFor(cardType: string | undefined): string {
  const type = normalizedTypeName(cardType);
  return type ? type[0].toUpperCase() + type.slice(1) : 'Pokemon';
}
import { energyIconName } from './energy';

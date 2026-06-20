export type EnergyType =
  | 'Grass'
  | 'Fire'
  | 'Water'
  | 'Lightning'
  | 'Psychic'
  | 'Fighting'
  | 'Darkness'
  | 'Metal'
  | 'Colorless'
  | 'Fairy'
  | 'Dragon'
  | 'Rainbow'
  | 'Team Rocket';

const energyCodeNames: EnergyType[] = [
  'Colorless',
  'Grass',
  'Fire',
  'Water',
  'Lightning',
  'Psychic',
  'Fighting',
  'Darkness',
  'Metal',
  'Dragon',
  'Rainbow',
  'Team Rocket',
];

const symbolNames: Record<string, EnergyType> = {
  G: 'Grass',
  R: 'Fire',
  W: 'Water',
  L: 'Lightning',
  P: 'Psychic',
  F: 'Fighting',
  D: 'Darkness',
  M: 'Metal',
  C: 'Colorless',
};

const normalizedNames: Record<string, EnergyType> = {
  grass: 'Grass',
  fire: 'Fire',
  water: 'Water',
  lightning: 'Lightning',
  psychic: 'Psychic',
  fighting: 'Fighting',
  dark: 'Darkness',
  darkness: 'Darkness',
  metal: 'Metal',
  colorless: 'Colorless',
  fairy: 'Fairy',
  dragon: 'Dragon',
  rainbow: 'Rainbow',
  teamrocket: 'Team Rocket',
};

export function energyNameFromCode(code: number | undefined): EnergyType {
  return typeof code === 'number' ? energyCodeNames[code] ?? 'Colorless' : 'Colorless';
}

export function normalizeEnergyType(value: string | undefined): EnergyType | undefined {
  if (!value) {
    return undefined;
  }
  const symbol = value.match(/\{([A-Z])\}/)?.[1];
  if (symbol && symbolNames[symbol]) {
    return symbolNames[symbol];
  }
  const normalized = value.toLowerCase().replace(/[^a-z]/g, '');
  return normalizedNames[normalized];
}

export function energyIconName(value: string | undefined): string | undefined {
  const type = normalizeEnergyType(value);
  return type?.toLowerCase().replace(/\s+/g, '-');
}

export function replaceEnergySymbols(value: string): string {
  return value.replace(/\{([A-Z])\}/g, (match, symbol: string) => symbolNames[symbol] ?? match);
}

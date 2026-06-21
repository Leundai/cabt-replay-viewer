import { energyIconName } from './game/energy';

export type AttackEffectKind =
  | 'grass'
  | 'fire'
  | 'water'
  | 'lightning'
  | 'psychic'
  | 'fighting'
  | 'darkness'
  | 'metal'
  | 'colorless'
  | 'fairy'
  | 'dragon';

type EffectPalette = {
  core: string;
  edge: string;
  glow: string;
  haze: string;
};

const generatedSprites = {
  impact: '/assets/vfx/impact-burst.png',
  orb: '/assets/vfx/energy-orb.png',
  streak: '/assets/vfx/energy-streak.png',
} as const;

const fallbackEffect: AttackEffectKind = 'colorless';

const effectKinds = new Set<AttackEffectKind>([
  'grass',
  'fire',
  'water',
  'lightning',
  'psychic',
  'fighting',
  'darkness',
  'metal',
  'colorless',
  'fairy',
  'dragon',
]);

const palettes: Record<AttackEffectKind, EffectPalette> = {
  grass: { core: '#b8f45f', edge: '#32b66a', glow: 'rgba(92, 214, 112, 0.58)', haze: 'rgba(58, 160, 86, 0.22)' },
  fire: { core: '#ffe06a', edge: '#ff5a2c', glow: 'rgba(255, 104, 42, 0.62)', haze: 'rgba(196, 48, 24, 0.24)' },
  water: { core: '#cbf4ff', edge: '#2795ff', glow: 'rgba(50, 158, 255, 0.56)', haze: 'rgba(30, 104, 196, 0.20)' },
  lightning: { core: '#fff36b', edge: '#41c8ff', glow: 'rgba(255, 232, 76, 0.66)', haze: 'rgba(65, 200, 255, 0.20)' },
  psychic: { core: '#ffd5ff', edge: '#a855f7', glow: 'rgba(176, 90, 255, 0.56)', haze: 'rgba(120, 54, 180, 0.20)' },
  fighting: { core: '#ffd59a', edge: '#b96d30', glow: 'rgba(212, 123, 48, 0.52)', haze: 'rgba(140, 72, 32, 0.20)' },
  darkness: { core: '#d4dcff', edge: '#4b5672', glow: 'rgba(92, 102, 132, 0.56)', haze: 'rgba(32, 38, 52, 0.28)' },
  metal: { core: '#f7fbff', edge: '#8fa4b8', glow: 'rgba(186, 204, 220, 0.58)', haze: 'rgba(82, 104, 124, 0.18)' },
  colorless: { core: '#fff7c8', edge: '#d8a645', glow: 'rgba(235, 184, 82, 0.54)', haze: 'rgba(156, 119, 58, 0.18)' },
  fairy: { core: '#ffe0f1', edge: '#fb80bd', glow: 'rgba(255, 128, 189, 0.56)', haze: 'rgba(190, 75, 130, 0.18)' },
  dragon: { core: '#e1e873', edge: '#7a62ff', glow: 'rgba(124, 98, 255, 0.56)', haze: 'rgba(114, 126, 44, 0.18)' },
};

export function attackEffectKind(cardType: string | undefined): AttackEffectKind {
  const iconName = energyIconName(cardType);
  return iconName && effectKinds.has(iconName as AttackEffectKind) ? (iconName as AttackEffectKind) : fallbackEffect;
}

export function applyEffectVars(node: HTMLElement, kind: AttackEffectKind | undefined): void {
  const palette = palettes[kind ?? fallbackEffect] ?? palettes[fallbackEffect];
  node.dataset.effect = kind ?? fallbackEffect;
  node.style.setProperty('--fx-core', palette.core);
  node.style.setProperty('--fx-edge', palette.edge);
  node.style.setProperty('--fx-glow', palette.glow);
  node.style.setProperty('--fx-haze', palette.haze);
  node.style.setProperty('--fx-sprite-impact', `url("${generatedSprites.impact}")`);
  node.style.setProperty('--fx-sprite-orb', `url("${generatedSprites.orb}")`);
  node.style.setProperty('--fx-sprite-streak', `url("${generatedSprites.streak}")`);
}

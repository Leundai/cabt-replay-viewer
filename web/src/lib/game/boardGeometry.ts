type CssVars = Record<string, string | number>;

export type TableGeometryOptions = {
  replayMode?: boolean;
};

export type PlaymatGeometryOptions = {
  boardTilt: number;
  boardPerspective: number;
  boardScaleY: number;
  boardLift: number;
};

export function tableGeometryStyle({ replayMode = false }: TableGeometryOptions = {}) {
  return cssVars({
    'board-card-w': 'clamp(42px, min(7.2cqw, 7.2cqh), 96px)',
    'card-w': 'var(--board-card-w)',
    'hand-card-w': 'min(clamp(76px, min(9.2cqw, 13.5cqh), 138px), calc(var(--board-card-w) * 1.55))',
    'board-row-gap': 'calc(var(--board-card-w) * 0.16)',
    'active-gap': 'calc(var(--board-card-w) * 0.24)',
    'bench-card-w': 'calc(var(--board-card-w) * 1.18)',
    'bench-row-h': 'calc(var(--bench-card-w) * 1.42)',
    'opponent-hand-height': 'clamp(58px, 7.2vh, 84px)',
    'replay-dock-h': replayMode ? '48px' : '0px',
    'hand-board-gap': '0px',
    'board-top-inset': 'calc(var(--opponent-hand-height) + var(--hand-board-gap))',
    'hand-hover-pad': 'calc(var(--board-card-w) * 0.065)',
    'hand-hover-clearance': 'calc(var(--hand-hover-pad) + 12px)',
    'hand-shadow-clearance': 'calc(var(--hand-hover-pad) + 14px)',
    'board-bottom-inset': 'calc((var(--hand-card-w) * 1.397) + (var(--hand-hover-pad) * 2.5) + 14px + var(--replay-dock-h))',
    'board-right-rail': 'clamp(8px, 1.6cqw, 20px)',
    'table-side-gap': 'clamp(6px, 1.6cqw, 14px)',
    'player-panel-right': 'calc(var(--board-right-rail) + 8px)',
    'board-h': 'calc(100dvh - var(--board-top-inset) - var(--board-bottom-inset))',
    'board-edge-pad': 'calc(var(--board-card-w) * 0.32)',
    'board-outline-pad-y': 'calc(var(--board-card-w) * 0.06)',
    'board-content-pad': 'calc(var(--board-card-w) * 0.18)',
    'board-edge-pad-x': 'var(--board-edge-pad)',
    'board-content-inset-y': 'calc(var(--board-outline-pad-y) + var(--board-content-pad))',
    'board-content-inset-x': 'calc(var(--board-edge-pad-x) + var(--board-content-pad))',
  });
}

export function playmatGeometryStyle({
  boardTilt,
  boardPerspective,
  boardScaleY,
  boardLift,
}: PlaymatGeometryOptions) {
  return cssVars({
    'board-tilt': `${boardTilt}deg`,
    'board-perspective': `${boardPerspective}px`,
    'board-scale-y': boardScaleY / 100,
    'board-lift': `${boardLift}px`,
    'active-preferred-w': 'calc(var(--board-card-w) * 1.48)',
    'active-fit-w': 'max(calc(var(--board-card-w) * 1.15), calc((var(--board-h) - (var(--bench-row-h) * 2) - (var(--board-row-gap) * 2) - var(--active-gap)) / 2.794))',
    'active-w': 'min(var(--active-preferred-w), var(--active-fit-w))',
    'active-h': 'calc(var(--active-w) * 1.397)',
    'pile-w': 'calc(var(--board-card-w) * 1.12)',
    'prize-card-w': 'calc(var(--board-card-w) * 0.9)',
    'prize-grid-w': 'calc(var(--prize-card-w) * 1.98)',
    'prize-grid-h': 'calc((var(--prize-card-w) * 1.397) + (var(--prize-card-w) * 1.42))',
    'side-field-w': 'min(max(var(--prize-grid-w), var(--pile-w)), calc(100cqw * 0.19))',
    'bench-gap': 'calc(var(--board-card-w) * 0.18)',
  });
}

function cssVars(vars: CssVars) {
  return Object.entries(vars)
    .map(([name, value]) => `--${name}: ${value}`)
    .join('; ');
}

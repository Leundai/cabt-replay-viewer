import { describe, expect, it } from 'vitest';
import { playmatGeometryStyle, tableGeometryStyle } from './boardGeometry';

describe('board geometry', () => {
  it('centralizes table geometry variables', () => {
    const style = tableGeometryStyle({ replayMode: true });

    expect(style).toContain('--board-card-w: clamp(42px');
    expect(style).toContain('--replay-dock-h: 48px');
    expect(style).toContain('--board-h: calc(100dvh');
  });

  it('centralizes playmat geometry and perspective variables', () => {
    const style = playmatGeometryStyle({
      boardTilt: 8,
      boardPerspective: 1250,
      boardScaleY: 98,
      boardLift: 2,
    });

    expect(style).toContain('--board-tilt: 8deg');
    expect(style).toContain('--board-perspective: 1250px');
    expect(style).toContain('--board-scale-y: 0.98');
    expect(style).toContain('--active-w: min(var(--active-preferred-w), var(--active-fit-w))');
  });
});

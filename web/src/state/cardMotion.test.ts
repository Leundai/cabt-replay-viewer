import { describe, expect, it } from 'vitest';
import type { CardView, GameView, LogView, PlayerView, PokemonSlotView } from '../lib/game/types';
import {
  deriveMotionIntents,
  logDelta,
  planEligibility,
  type RawLog,
} from './cardMotionModel';
import { prizeZone } from '../lib/game/prizeZone';
import { replayMotionBudgetMs } from './replayPlaybackModel';

function card(id: number, name = `Card ${id}`, overrides: Partial<CardView> = {}): CardView {
  return { id, name, fullName: name, ...overrides };
}

function slot(owner: number, kind: 'active' | 'bench', index: number, pokemon?: CardView): PokemonSlotView {
  return {
    ownerIndex: owner,
    slot: kind,
    index,
    empty: !pokemon,
    pokemon,
    cards: pokemon ? [pokemon] : [],
    damage: 0,
    hp: pokemon?.hp ?? 0,
    retreat: [],
    energy: [],
    tools: [],
    specialConditions: [],
  };
}

function player(index: number, overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    index,
    id: index,
    name: `Player ${index + 1}`,
    hand: [],
    deckCount: 30,
    discard: [],
    lostZone: [],
    stadium: [],
    playZone: [],
    prizes: prizeZone(Array.from({ length: 6 }, () => card(900, 'Prize')), true),
    active: slot(index, 'active', 0, card(100 + index, `Active ${index}`)),
    bench: [slot(index, 'bench', 0), slot(index, 'bench', 1)],
    ...overrides,
  };
}

// Build a prize zone with a given remaining count (remaining === cards.length).
function prizesN(n: number): PlayerView['prizes'] {
  return prizeZone(Array.from({ length: n }, () => card(900, 'Prize')), false);
}

function view(players: PlayerView[], logs: RawLog[]): GameView {
  const logViews: LogView[] = logs.map((params, id) => ({ id, message: '', params }));
  return {
    ready: true,
    phase: 2,
    phaseLabel: 'CABT replay',
    turn: 1,
    activePlayerIndex: 0,
    players,
    logs: logViews,
    events: [],
  };
}

describe('logDelta', () => {
  it('returns only the new entries appended since the previous view', () => {
    const prev = view([player(0), player(1)], [{ type: 'TurnStart', playerIndex: 0 }]);
    const next = view([player(0), player(1)], [
      { type: 'TurnStart', playerIndex: 0 },
      { type: 'Draw', playerIndex: 0, cardId: 1, serial: 101 },
    ]);
    expect(logDelta(prev, next)).toEqual([{ type: 'Draw', playerIndex: 0, cardId: 1, serial: 101 }]);
  });

  it('treats a null previous view as starting from zero', () => {
    const next = view([player(0), player(1)], [{ type: 'Draw', playerIndex: 0, cardId: 1 }]);
    expect(logDelta(null, next)).toHaveLength(1);
  });

  it('is robust to non-monotonic per-card serials (uses length, not serial)', () => {
    // serial repeats across Draw/Attach of the same card and jumps around — a
    // serial-based diff would wrongly drop the Play here.
    const prev = view([player(0), player(1)], [{ type: 'Draw', playerIndex: 0, cardId: 1, serial: 101 }]);
    const next = view([player(0), player(1)], [
      { type: 'Draw', playerIndex: 0, cardId: 1, serial: 101 },
      { type: 'Play', playerIndex: 1, cardId: 150, serial: 21 },
    ]);
    const delta = logDelta(prev, next);
    expect(delta).toEqual([{ type: 'Play', playerIndex: 1, cardId: 150, serial: 21 }]);
  });
});

describe('deriveMotionIntents', () => {
  it('derives an attack intent with attacker/defender slot keys', () => {
    const next = view([player(0), player(1)], []);
    const delta: RawLog[] = [
      { type: 'Attack', playerIndex: 0, cardId: 96, serial: 10, attackId: 120 },
      { type: 'HpChange', playerIndex: 1, cardId: 678, serial: 20, value: -60 },
    ];
    const { attack } = deriveMotionIntents(next, next, delta);
    expect(attack).toMatchObject({
      attackerKey: 'slot-0-active-0',
      defenderKey: 'slot-1-active-0',
      attackerOwner: 0,
      defenderOwner: 1,
    });
  });

  it('derives attack effect kind from the attacking Pokemon type', () => {
    const attacker = card(96, 'Fire Attacker', { cardType: 'Fire' });
    const next = view([player(0, { active: slot(0, 'active', 0, attacker) }), player(1)], []);
    const { attack } = deriveMotionIntents(next, next, [{ type: 'Attack', playerIndex: 0, cardId: 96 }]);
    expect(attack?.effectKind).toBe('fire');
  });

  it('flags a KO+replacement on the defender so cardSwap can own it', () => {
    const prev = view([player(0), player(1, { active: slot(1, 'active', 0, card(678, 'Defender A')) })], []);
    const next = view([player(0), player(1, { active: slot(1, 'active', 0, card(999, 'Replacement')) })], []);
    const delta: RawLog[] = [{ type: 'Attack', playerIndex: 0, cardId: 96 }];
    const { attack } = deriveMotionIntents(prev, next, delta);
    expect(attack?.defenderReplaced).toBe(true);
    expect(attack?.attackerReplaced).toBe(false);
  });

  it('skips the attack when an active slot is empty', () => {
    const next = view([player(0), player(1, { active: slot(1, 'active', 0) })], []);
    const { attack } = deriveMotionIntents(next, next, [{ type: 'Attack', playerIndex: 0 }]);
    expect(attack).toBeNull();
  });

  it('coalesces multiple draws by the same player into one intent with a count', () => {
    const next = view([player(0), player(1)], []);
    const delta: RawLog[] = [
      { type: 'Draw', playerIndex: 0, cardId: 1, serial: 101 },
      { type: 'Draw', playerIndex: 0, cardId: 2, serial: 102 },
      { type: 'Draw', playerIndex: 0, cardId: 3, serial: 103 },
    ];
    const { travels } = deriveMotionIntents(next, next, delta);
    const draws = travels.filter((t) => t.kind === 'draw');
    expect(draws).toHaveLength(1);
    expect(draws[0]).toMatchObject({ kind: 'draw', ownerIndex: 0, count: 3 });
  });

  it('groups draws per player when both draw in one step', () => {
    const next = view([player(0), player(1)], []);
    const delta: RawLog[] = [
      { type: 'Draw', playerIndex: 0 },
      { type: 'Draw', playerIndex: 1 },
      { type: 'Draw', playerIndex: 1 },
    ];
    const draws = deriveMotionIntents(next, next, delta).travels.filter((t) => t.kind === 'draw');
    expect(draws).toHaveLength(2);
    expect(draws.map((d) => (d.kind === 'draw' ? d.count : 0)).sort()).toEqual([1, 2]);
  });

  it('does not treat a prize pull (MoveCard 6 -> 2) as a draw', () => {
    const next = view([player(0), player(1)], []);
    const delta: RawLog[] = [{ type: 'MoveCard', playerIndex: 0, cardId: 1, serial: 301, fromArea: 6, toArea: 2 }];
    const { travels } = deriveMotionIntents(next, next, delta);
    expect(travels).toHaveLength(0);
  });

  it('resolves a played Pokemon to its destination slot (no area field on Play)', () => {
    const played = card(150, 'Played Basic');
    const next = view([
      player(0),
      player(1, { bench: [slot(1, 'bench', 0, played), slot(1, 'bench', 1)] }),
    ], []);
    const delta: RawLog[] = [{ type: 'Play', playerIndex: 1, cardId: 150, serial: 21 }];
    const play = deriveMotionIntents(next, next, delta).travels.find((t) => t.kind === 'play');
    expect(play).toMatchObject({ kind: 'play', destSelector: 'slot-1-bench-0', cardId: 150 });
    expect(play?.kind === 'play' && play.card?.fullName).toBe('Played Basic');
  });

  it('resolves a played trainer to the owner discard pile', () => {
    const trainer = card(1205, 'Some Supporter');
    const next = view([player(0), player(1, { discard: [trainer] })], []);
    const delta: RawLog[] = [{ type: 'Play', playerIndex: 1, cardId: 1205 }];
    const play = deriveMotionIntents(next, next, delta).travels.find((t) => t.kind === 'play');
    expect(play).toMatchObject({ destSelector: 'discard-pile-1' });
  });

  it('reveals the played card (not an unrelated discard card) when it lands off-anchor', () => {
    // Played card 777 is in hand (not a searched destination zone) while the
    // discard already holds an unrelated card — must never reveal the unrelated one.
    const played = card(777, 'Played From Hand');
    const next = view([player(0), player(1, { hand: [played], discard: [card(999, 'Unrelated')] })], []);
    const play = deriveMotionIntents(next, next, [{ type: 'Play', playerIndex: 1, cardId: 777 }]).travels.find((t) => t.kind === 'play');
    expect(play?.kind === 'play' && play.card?.fullName).toBe('Played From Hand');
    expect(play?.kind === 'play' && play.destSelector).toBeNull();
  });

  it('suppresses the reveal card rather than showing a wrong one when the card cannot be located', () => {
    const next = view([player(0), player(1, { discard: [card(999, 'Unrelated')] })], []);
    const play = deriveMotionIntents(next, next, [{ type: 'Play', playerIndex: 1, cardId: 12345 }]).travels.find((t) => t.kind === 'play');
    expect(play?.kind === 'play' && play.card).toBeNull();
    expect(play?.kind === 'play' && play.destSelector).toBeNull();
  });

  it('derives a setup prize intent when prizes first appear (0/unknown -> m)', () => {
    const prev = view([player(0, { prizes: prizesN(0) }), player(1, { prizes: prizesN(0) })], []);
    const next = view([player(0, { prizes: prizesN(6) }), player(1, { prizes: prizesN(6) })], []);
    const prizes = deriveMotionIntents(prev, next, []).travels.filter((t) => t.kind === 'prize');
    expect(prizes).toHaveLength(2);
    expect(prizes[0]).toMatchObject({ kind: 'prize', ownerIndex: 0, count: 6, mode: 'setup' });
  });

  it('derives a setup prize intent against a null previous view', () => {
    const next = view([player(0, { prizes: prizesN(6) }), player(1, { prizes: prizesN(6) })], []);
    const prizes = deriveMotionIntents(null, next, []).travels.filter((t) => t.kind === 'prize');
    expect(prizes).toHaveLength(2);
    expect(prizes.every((p) => p.kind === 'prize' && p.mode === 'setup')).toBe(true);
  });

  it('derives a take prize intent with the claimed count when prizesLeft drops', () => {
    const prev = view([player(0, { prizes: prizesN(6) }), player(1, { prizes: prizesN(4) })], []);
    const next = view([player(0, { prizes: prizesN(6) }), player(1, { prizes: prizesN(2) })], []);
    const prizes = deriveMotionIntents(prev, next, []).travels.filter((t) => t.kind === 'prize');
    expect(prizes).toHaveLength(1);
    expect(prizes[0]).toMatchObject({ kind: 'prize', ownerIndex: 1, count: 2, mode: 'take' });
  });

  it('emits no prize intent when prizesLeft is unchanged', () => {
    const prev = view([player(0, { prizes: prizesN(6) }), player(1, { prizes: prizesN(6) })], []);
    const next = view([player(0, { prizes: prizesN(6) }), player(1, { prizes: prizesN(6) })], []);
    const prizes = deriveMotionIntents(prev, next, []).travels.filter((t) => t.kind === 'prize');
    expect(prizes).toHaveLength(0);
  });

  it('orders draw intents before play reveals', () => {
    const played = card(150, 'Played');
    const next = view([player(0, { active: slot(0, 'active', 0, played) }), player(1)], []);
    const delta: RawLog[] = [
      { type: 'Play', playerIndex: 0, cardId: 150 },
      { type: 'Draw', playerIndex: 0 },
    ];
    const kinds = deriveMotionIntents(next, next, delta).travels.map((t) => t.kind);
    expect(kinds).toEqual(['draw', 'play']);
  });
});

describe('planEligibility', () => {
  const base = { prevViewKnown: true, playing: false, dt: 1000, hidden: false } as const;

  it('suppresses everything on a backward step', () => {
    expect(planEligibility({ ...base, dir: -1, speedId: 'normal' })).toBeNull();
  });

  it('suppresses everything on a multi-step scrub jump', () => {
    expect(planEligibility({ ...base, dir: 3, speedId: 'normal' })).toBeNull();
  });

  it('suppresses everything with no previous context (fresh load)', () => {
    expect(planEligibility({ ...base, dir: 1, prevViewKnown: false, speedId: 'normal' })).toBeNull();
  });

  it('suppresses everything while the tab is hidden', () => {
    expect(planEligibility({ ...base, dir: 1, speedId: 'normal', hidden: true })).toBeNull();
  });

  it('suppresses everything during turbo autoplay', () => {
    expect(planEligibility({ ...base, dir: 1, speedId: 'turbo', playing: true, dt: 200 })).toBeNull();
  });

  it('allows only the attack during fast autoplay', () => {
    const plan = planEligibility({ ...base, dir: 1, speedId: 'fast', playing: true, dt: 400 });
    expect(plan).toMatchObject({ attack: true, draw: false, reveal: false });
  });

  it('clips to attack-only when steps are mashed faster than the cadence', () => {
    const plan = planEligibility({ ...base, dir: 1, speedId: 'normal', dt: 80 });
    expect(plan).toMatchObject({ attack: true, draw: false, reveal: false });
    expect(plan?.budgetMs).toBeLessThanOrEqual(260);
  });

  it('allows the full repertoire on a calm manual step', () => {
    const plan = planEligibility({ ...base, dir: 1, speedId: 'normal' });
    expect(plan).toMatchObject({ attack: true, draw: true, reveal: true, prize: true });
    expect(plan?.budgetMs).toBe(replayMotionBudgetMs('normal'));
  });

  it('suppresses prizes (with draws/reveals) on a rapid mash and during fast autoplay', () => {
    expect(planEligibility({ ...base, dir: 1, speedId: 'normal', dt: 80 })).toMatchObject({ prize: false });
    expect(planEligibility({ ...base, dir: 1, speedId: 'fast', playing: true, dt: 400 })).toMatchObject({ prize: false });
  });

  it('allows the full repertoire during normal autoplay', () => {
    const plan = planEligibility({ ...base, dir: 1, speedId: 'normal', playing: true, dt: 1600 });
    expect(plan).toMatchObject({ attack: true, draw: true, reveal: true });
    expect(plan?.budgetMs).toBe(replayMotionBudgetMs('normal'));
  });

  it('scales manual motion budgets with the selected speed', () => {
    const slow = planEligibility({ ...base, dir: 1, speedId: 'slow' });
    const normal = planEligibility({ ...base, dir: 1, speedId: 'normal' });
    const fast = planEligibility({ ...base, dir: 1, speedId: 'fast' });
    expect(slow?.budgetMs).toBeGreaterThan(normal?.budgetMs ?? 0);
    expect(normal?.budgetMs).toBeGreaterThan(fast?.budgetMs ?? 0);
  });
});

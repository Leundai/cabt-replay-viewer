import type { ReplaySummary } from '../api/client';

/**
 * Client-side replay metadata inference. A faithful port of the Python
 * ReplayStore.infer_* helpers, so a replay imported locally produces the same
 * summary (players / action count / state count / name) the server used to.
 * Used by the local (IndexedDB) replay library.
 */

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

export function inferPlayers(replay: unknown): string[] {
  const root = asObject(replay);
  if (!root) {
    return [];
  }

  const environment = asObject(root.environment);
  if (environment && Array.isArray(environment.players)) {
    const names = environment.players
      .map((player) => asObject(player)?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    if (names.length) {
      return names;
    }
  }

  const info = asObject(root.info);
  if (info && Array.isArray(info.TeamNames)) {
    const names = info.TeamNames.filter((name): name is string => !!name).map(String);
    if (names.length) {
      return names;
    }
  }

  if (Array.isArray(root.steps) && root.steps.length) {
    const first = root.steps[0];
    if (Array.isArray(first)) {
      const names: string[] = [];
      for (const agent of first) {
        const agentInfo = asObject(asObject(agent)?.info);
        const teamName = agentInfo?.team_name;
        if (typeof teamName === 'string' && teamName) {
          names.push(teamName);
        }
      }
      if (names.length) {
        return names;
      }
    }
  }

  return [];
}

export function inferActionCount(replay: unknown): number {
  const root = asObject(replay);
  if (!root) {
    return 0;
  }
  if (Array.isArray(root.steps)) {
    return Math.max(0, root.steps.length - 1);
  }
  if (Array.isArray(root.visualize)) {
    return Math.max(0, root.visualize.length - 1);
  }
  return 0;
}

export function inferStateCount(replay: unknown): number {
  const root = asObject(replay);
  if (!root) {
    return 0;
  }
  if (Array.isArray(root.visualize)) {
    return root.visualize.length;
  }
  if (Array.isArray(root.steps)) {
    return root.steps.length;
  }
  return 0;
}

export function inferReplayName(replay: unknown, fallback: string): string {
  const root = asObject(replay);
  if (root) {
    const title = root.title ?? root.name ?? root.id;
    if (title) {
      const players = inferPlayers(replay);
      return players.length >= 2 ? `${players[0]} vs ${players[1]}` : String(title);
    }
  }
  return fallback;
}

/** Stable, content-addressed id (djb2 over canonical-ish JSON). Matches on
 *  re-import so the same file dedupes instead of piling up duplicates. */
export function contentId(replay: unknown): string {
  const json = JSON.stringify(replay);
  let hash = 5381;
  for (let i = 0; i < json.length; i += 1) {
    hash = ((hash << 5) + hash + json.charCodeAt(i)) | 0;
  }
  return `local-${(hash >>> 0).toString(36)}-${json.length.toString(36)}`;
}

export function summarize(replay: unknown, name?: string): ReplaySummary {
  const id = contentId(replay);
  return {
    id,
    name: name || inferReplayName(replay, id),
    source: 'local',
    players: inferPlayers(replay),
    actionCount: inferActionCount(replay),
    stateCount: inferStateCount(replay),
    createdAt: undefined,
  };
}

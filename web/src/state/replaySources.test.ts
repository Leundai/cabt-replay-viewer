import { describe, expect, it } from 'vitest';
import { normalizeReplayUrl, readReplayJson, replayCandidates } from './replaySources';

const origin = 'https://viewer.example';

describe('replay source hardening', () => {
  it('allows same-origin fixture replay URLs only', () => {
    expect(normalizeReplayUrl('/game-logs/demo.json', origin)).toBe('/game-logs/demo.json');
    expect(normalizeReplayUrl('https://viewer.example/cabt-artifacts/demo.json', origin)).toBe('/cabt-artifacts/demo.json');
    expect(() => normalizeReplayUrl('https://attacker.example/replay.json', origin)).toThrow('Remote replay URLs');
    expect(() => normalizeReplayUrl('/api/health', origin)).toThrow('Replay URL');
  });

  it('rejects traversal-ish replay file names', () => {
    expect(replayCandidates('demo.json', '?replay=demo.json', origin)[0]).toBe('/game-logs/demo.json');
    expect(() => replayCandidates('demo.json', '?replay=../api/health', origin)).toThrow('Replay file name');
    expect(() => replayCandidates('demo.json', '?replay=/api/health', origin)).toThrow('Replay URL');
  });

  it('checks content length before parsing fetched replay JSON', async () => {
    const response = new Response('{"visualize":[]}', {
      headers: {
        'content-type': 'application/json',
        'content-length': String(26 * 1024 * 1024),
      },
    });

    await expect(readReplayJson(response)).rejects.toThrow('too large');
  });
});

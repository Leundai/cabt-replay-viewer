export const MAX_REPLAY_BYTES = 25 * 1024 * 1024;

const REPLAY_FETCH_TIMEOUT_MS = 15_000;
const ALLOWED_REPLAY_PATH_PREFIXES = ['/game-logs/', '/cabt-artifacts/'];
const REPLAY_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/i;

export async function fetchReplaySource(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REPLAY_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function readReplayJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !contentType.toLowerCase().includes('json')) {
    throw new Error('Replay response must be JSON.');
  }
  const text = await responseTextWithLimit(response);
  return JSON.parse(text);
}

async function responseTextWithLimit(response: Response): Promise<string> {
  const rawLength = response.headers.get('content-length');
  if (rawLength && Number(rawLength) > MAX_REPLAY_BYTES) {
    throw new Error('Replay payload is too large.');
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_REPLAY_BYTES) {
      throw new Error('Replay payload is too large.');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_REPLAY_BYTES) {
      reader.cancel().catch(() => {});
      throw new Error('Replay payload is too large.');
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export function replayCandidates(id: string, search?: string, origin?: string): string[] {
  const params = new URLSearchParams(search ?? (typeof window === 'undefined' ? '' : window.location.search));
  const baseOrigin = origin ?? (typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  const replayUrl = params.get('replayUrl');
  if (replayUrl) {
    return [normalizeReplayUrl(replayUrl, baseOrigin)];
  }
  const file = params.get('replay') || id;
  if (/^https?:\/\//.test(file) || file.startsWith('/')) {
    return [normalizeReplayUrl(file, baseOrigin)];
  }
  if (!isSafeReplayFileName(file)) {
    throw new Error('Replay file name is not allowed.');
  }
  return [
    `/game-logs/${encodeURIComponent(file)}`,
    `/cabt-artifacts/${encodeURIComponent(file)}`,
    '/game-logs/cabt-match.json',
    '/cabt-artifacts/cabt-match.json',
  ];
}

export function normalizeReplayUrl(value: string, origin: string): string {
  const url = new URL(value, origin);
  if (url.origin !== origin) {
    throw new Error('Remote replay URLs are not allowed.');
  }
  if (url.search || url.hash || !isAllowedReplayPath(url.pathname)) {
    throw new Error('Replay URL is not allowed.');
  }
  return url.pathname;
}

function isAllowedReplayPath(pathname: string): boolean {
  return ALLOWED_REPLAY_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && pathname.endsWith('.json');
}

export function isSafeReplayFileName(file: string): boolean {
  return REPLAY_FILE_NAME_PATTERN.test(file) && !file.includes('..');
}

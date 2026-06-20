export type ReplaySummary = {
  id: string;
  name: string;
  source: string;
  players: string[];
  actionCount: number;
  stateCount: number;
  createdAt?: string;
  episodeId?: number;
  submissionId?: number;
};

export type KaggleStatus = {
  configured: boolean;
  authMode: string;
  adminRequired?: boolean;
  publicImportsEnabled?: boolean;
  message: string;
};

export type KaggleEpisode = {
  id: number;
  submissionId?: number;
  competitionName?: string;
  replayUrl?: string;
  reward?: number | string;
  status?: string;
  date?: string;
};

export type KaggleSubmission = {
  id: number;
  teamId?: number;
  teamName?: string;
  submittedBy?: string;
  description?: string;
  score?: number | string;
  status?: string;
  date?: string;
  episodes?: KaggleEpisode[];
};

export type KaggleLeaderboardEntry = {
  rank: number;
  teamId?: number;
  teamName: string;
  score?: number | string;
  submissionDate?: string;
  submissions?: KaggleSubmission[];
};

export type KaggleLeaderboardSnapshot = {
  competition: string;
  entries: KaggleLeaderboardEntry[];
  refreshedAt?: string;
  expiresAt?: string;
  stale: boolean;
  refreshInSeconds: number;
  pageSize: number;
  nextPageToken?: string;
  source: string;
  message: string;
};

export type ImportReplayResponse = {
  replay: ReplaySummary;
};

let adminToken = '';

export function readAdminToken(): string {
  return adminToken;
}

export function setAdminToken(token: string): void {
  adminToken = token.trim();
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const adminToken = readAdminToken();
  if (adminToken) {
    headers.set('X-CABT-Admin-Token', adminToken);
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed with ${response.status}`);
  }
  return body as T;
}

export async function listReplays(query = ''): Promise<ReplaySummary[]> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set('q', query.trim());
  }
  const body = await apiJson<{ replays: ReplaySummary[] }>(`/api/replays${params.size ? `?${params}` : ''}`);
  return body.replays;
}

export async function getReplayArtifact(id: string): Promise<unknown> {
  return apiJson<unknown>(`/api/replays/${encodeURIComponent(id)}/artifact`);
}

export async function importReplayJson(replay: unknown, name?: string): Promise<ReplaySummary> {
  const body = await apiJson<ImportReplayResponse>('/api/replays/import', {
    method: 'POST',
    body: JSON.stringify({ name, replay }),
  });
  return body.replay;
}

export async function kaggleStatus(): Promise<KaggleStatus> {
  return apiJson<KaggleStatus>('/api/kaggle/status');
}

export async function verifyAdminSession(): Promise<void> {
  await apiJson<{ ok: boolean }>('/api/admin/session');
}

export async function getKaggleLeaderboard(competition: string): Promise<KaggleLeaderboardSnapshot> {
  const params = new URLSearchParams({ competition });
  return apiJson<KaggleLeaderboardSnapshot>(`/api/kaggle/leaderboard?${params}`);
}

export async function refreshKaggleLeaderboard(competition: string): Promise<KaggleLeaderboardSnapshot> {
  const params = new URLSearchParams({ competition });
  return apiJson<KaggleLeaderboardSnapshot>(`/api/kaggle/leaderboard/refresh?${params}`, {
    method: 'POST',
    body: '{}',
  });
}

export async function listKaggleSubmissions(competition: string, page = 1): Promise<KaggleSubmission[]> {
  const params = new URLSearchParams({ competition, page: String(page) });
  const body = await apiJson<{ submissions: KaggleSubmission[] }>(`/api/kaggle/submissions?${params}`);
  return body.submissions;
}

export async function listKaggleEpisodes(submissionId: number): Promise<KaggleEpisode[]> {
  const body = await apiJson<{ episodes: KaggleEpisode[] }>(
    `/api/kaggle/submissions/${encodeURIComponent(String(submissionId))}/episodes`,
  );
  return body.episodes;
}

export async function importKaggleEpisode(episodeId: number): Promise<ReplaySummary> {
  const body = await apiJson<ImportReplayResponse>(
    `/api/kaggle/episodes/${encodeURIComponent(String(episodeId))}/import`,
    { method: 'POST', body: '{}' },
  );
  return body.replay;
}

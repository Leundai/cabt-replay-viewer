# CABT Replay Viewer

Public replay viewer for the Kaggle Pokemon TCG AI Battle CABT environment.

Official viewer: [ptcg.leofrias.com](https://ptcg.leofrias.com)

This repo is intentionally focused on viewing and searching replays. It does
not include private agents, sample submissions, training code, or local battle
runner logic.

![CABT Replay Viewer preview](web/public/preview.png)

## What It Provides

- Replay-first Svelte viewer for CABT and Kaggle Pokemon TCG AI Battle
  episodes.
- Production replay workspace with timeline playback, side switching, speed
  controls, pile viewers, card inspection, and real card art.
- Public leaderboard browser that exposes cached Kaggle standings, submissions,
  and replay episode links without putting Kaggle credentials in the browser.
- JSON drag/drop import for locally inspecting CABT runner or Kaggle episode
  replay files.
- FastAPI backend that keeps Kaggle credentials and replay imports server-side.
- File-backed replay library for local and Railway deployments.
- Direct Kaggle HTTP adapter for cached leaderboard pulls, submissions,
  episodes, and replay imports.
- Dockerfile and `railway.json` for Railway deployment.

The bundled demo replay is a public fixture for smoke testing the viewer.

## Strengths

- Accurate replay inspection: the viewer normalizes CABT replay states into a
  board-first UI with visible active Pokemon, bench slots, prizes, decks,
  discard/lost zones, hands, damage, attached energy, and turn status.
- Fast replay navigation: the timeline supports first/previous/next/last jumps,
  scrubber control, playback, and speed selection for reviewing long episodes.
- Useful public discovery: the leaderboard panel links cached Kaggle standings
  to available replay episodes, making interesting matches easy to find.
- Safe operating model: public viewing and local JSON inspection are separate
  from admin-only Kaggle imports, so credentials stay on the backend.
- Deployment simplicity: the first persistence layer is file-backed and
  volume-friendly while the backend interfaces leave room for Postgres, object
  storage, and background queues later.

## Inspiration

This project was inspired by Charlie Lockyer's MIT-licensed
[CABT Viewer](https://github.com/charlielockyer-rice/cabt-viewer), a Svelte
viewer for CABT battle states and replays. This repo extracts the idea into a
public, replay-focused service with a hosted leaderboard/replay workflow at
[ptcg.leofrias.com](https://ptcg.leofrias.com).

## Architecture

```text
web/                 Svelte 5 replay UI
api/                 FastAPI backend
api/app/kaggle_*     Server-side Kaggle adapter
api/app/replay_*     Replay storage interface
.data/               Local replay store, ignored
```

The first storage adapter is file-backed to keep the deployment simple. The
backend interface is deliberately shaped so it can move to Postgres, object
storage, and background queues later without changing the viewer.

## Local Development

Install web dependencies:

```bash
npm --prefix web ci
```

Run the API:

```bash
python -m venv .venv
. .venv/bin/activate
pip install --require-hashes -r api/requirements.lock
uvicorn api.app.main:app --reload
```

Run the web app in another terminal:

```bash
npm --prefix web run dev
```

Open `http://127.0.0.1:5173`.

## Kaggle Auth

Kaggle access is handled only by the backend. Do not put Kaggle credentials in
browser code.

For local or Railway use, set a server-side Kaggle API token:

```bash
KAGGLE_API_TOKEN=your-kaggle-api-token
```

Legacy Kaggle API credentials are also supported:

```bash
KAGGLE_USERNAME=your-kaggle-username
KAGGLE_KEY=your-kaggle-api-key
```

Live Kaggle replay-import actions are admin-protected. Set `CABT_ADMIN_TOKEN`
on the backend, then unlock the viewer's Kaggle admin controls with the private
hotkey and that token when importing episodes. The token is held only in memory
for the current page session. Local JSON drag/drop opens and saves in the
browser without a token. The backend replay upload endpoint still requires
admin access unless `CABT_ALLOW_PUBLIC_IMPORTS=true` is set for local
development; that flag does not unlock admin Kaggle endpoints.

The public leaderboard panel reads from a server-side cache. The viewer polls
the persisted cache without mutating it; a Kaggle pull only happens through the
admin "Refresh cache" action or an explicit API request with `refresh=true`.
The default cache window is 10 minutes:

```bash
KAGGLE_DEFAULT_COMPETITION=pokemon-tcg-ai-battle
KAGGLE_LEADERBOARD_CACHE_SECONDS=600
KAGGLE_LEADERBOARD_PAGE_SIZE=50
KAGGLE_LEADERBOARD_TEAM_SUBMISSION_LIMIT=50
KAGGLE_LEADERBOARD_SUBMISSIONS_PER_TEAM=2
KAGGLE_LEADERBOARD_EPISODES_PER_SUBMISSION=5
KAGGLE_LEADERBOARD_RATE_PAUSE_AFTER_CALLS=55
KAGGLE_LEADERBOARD_RATE_PAUSE_SECONDS=65
```

Leaderboard refreshes also cache recent public submissions and episode IDs for
the top 50 teams by default. Public replay clicks are allowed only for episode
IDs already present in that cached leaderboard snapshot. The cache can be
marked stale after the TTL expires, but it remains visible until an explicit
refresh replaces it. The enrichment limits and pause settings above keep the
pull batch bounded and avoid Kaggle 429s. The episode limit stores multiple
recent matchups from each already-fetched submission response; raising the
submission limit is what increases Kaggle call volume. Set the team limit to
`0` to cache standings only.

Saved replay artifacts are publicly readable from the hosted replay library. Use
local JSON drag/drop for private inspection, and only save/import replays that
are safe to publish.

## Railway

This repo is ready for Railway with the included Dockerfile.

Recommended variables:

```text
CABT_DATA_DIR=/data
CABT_ADMIN_TOKEN
KAGGLE_USERNAME
KAGGLE_KEY
KAGGLE_DEFAULT_COMPETITION=pokemon-tcg-ai-battle
KAGGLE_LEADERBOARD_CACHE_SECONDS=600
KAGGLE_LEADERBOARD_TEAM_SUBMISSION_LIMIT=50
KAGGLE_LEADERBOARD_SUBMISSIONS_PER_TEAM=2
KAGGLE_LEADERBOARD_EPISODES_PER_SUBMISSION=5
KAGGLE_LEADERBOARD_RATE_PAUSE_AFTER_CALLS=55
KAGGLE_LEADERBOARD_RATE_PAUSE_SECONDS=65
```

Attach a Railway volume mounted at `/data` so imported replays and the Kaggle
leaderboard cache survive redeploys. Without a volume the service still runs,
but the replay library and warmed leaderboard cache are ephemeral.

The backend rejects replay payloads over `CABT_MAX_REPLAY_BYTES` (25 MB by
default) and keeps at most `CABT_MAX_STORED_REPLAYS` artifacts (500 by default)
in the file-backed replay store.

The container listens on `$PORT` and defaults to `8080`. The service healthcheck
is `/api/health`.

## Tests

```bash
npm --prefix web run build
npm --prefix web test
npm --prefix web run test:e2e
python -m pytest
```

## License

MIT.

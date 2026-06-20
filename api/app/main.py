from __future__ import annotations

import hmac
import json
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .kaggle_client import KaggleClient
from .models import ImportReplayRequest, KaggleStatus
from .replay_store import ReplayStore
from .settings import load_settings

settings = load_settings()
store = ReplayStore(settings.data_dir)
kaggle = KaggleClient(settings.kaggle_base_url, settings.kaggle_credentials)

app = FastAPI(title="CABT Replay Viewer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def reject_oversized_replay_bodies(request: Request, call_next):
    if request.url.path == "/api/replays/import":
        raw_length = request.headers.get("content-length")
        if raw_length:
            try:
                content_length = int(raw_length)
            except ValueError:
                content_length = 0
            if content_length > settings.max_replay_bytes:
                return JSONResponse(status_code=413, content={"detail": "Replay payload is too large."})
    return await call_next(request)


def require_admin(x_cabt_admin_token: str = Header(default="")) -> None:
    if settings.allow_public_imports:
        return
    if not settings.admin_token:
        raise HTTPException(status_code=403, detail="Admin imports are disabled until CABT_ADMIN_TOKEN is configured.")
    if not hmac.compare_digest(x_cabt_admin_token, settings.admin_token):
        raise HTTPException(status_code=403, detail="Admin token is required for replay imports and Kaggle access.")


def validate_replay_payload(replay: Any) -> bytes:
    if not looks_like_replay(replay):
        raise HTTPException(status_code=400, detail="Replay payload does not look like a CABT or Kaggle replay.")
    try:
        encoded = json.dumps(replay, sort_keys=True, separators=(",", ":")).encode()
    except TypeError as error:
        raise HTTPException(status_code=400, detail="Replay payload must be JSON serializable.") from error
    if len(encoded) > settings.max_replay_bytes:
        raise HTTPException(status_code=413, detail="Replay payload is too large.")
    return encoded


def looks_like_replay(replay: Any) -> bool:
    if not isinstance(replay, dict):
        return False
    if isinstance(replay.get("visualize"), list) or isinstance(replay.get("steps"), list):
        return True
    environment = replay.get("environment")
    if isinstance(environment, dict) and isinstance(environment.get("steps"), list):
        return True
    input_data = replay.get("input")
    return isinstance(input_data, dict) and isinstance(input_data.get("steps"), list)


@app.get("/api/health")
def health() -> dict[str, object]:
    return {"ok": True, "kaggleConfigured": settings.kaggle_credentials.configured}


@app.get("/api/replays")
def list_replays(q: str = "") -> dict[str, object]:
    return {"replays": [item.model_dump() for item in store.list(q)]}


@app.post("/api/replays/import", dependencies=[Depends(require_admin)])
def import_replay(request: ImportReplayRequest) -> dict[str, object]:
    encoded = validate_replay_payload(request.replay)
    summary = store.save(request.replay, encoded=encoded, name=request.name, source="upload")
    return {"replay": summary.model_dump()}


@app.get("/api/replays/{replay_id}/artifact")
def replay_artifact(replay_id: str):
    try:
        return store.get_artifact(replay_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Replay not found.") from error


@app.get("/api/kaggle/status", response_model=KaggleStatus)
def kaggle_status() -> KaggleStatus:
    return KaggleStatus(
        configured=settings.kaggle_credentials.configured,
        authMode=settings.kaggle_credentials.mode,
        adminRequired=not settings.allow_public_imports,
        publicImportsEnabled=settings.allow_public_imports,
        message=kaggle.status_message(),
    )


@app.get("/api/kaggle/submissions")
async def kaggle_submissions(
    competition: str = Query("pokemon-tcg-ai-battle"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    _admin: None = Depends(require_admin),
) -> dict[str, object]:
    submissions = await kaggle.list_submissions(competition, page=page, page_size=page_size)
    return {"submissions": [item.model_dump() for item in submissions]}


@app.get("/api/kaggle/submissions/{submission_id}/episodes")
async def kaggle_episodes(submission_id: int, _admin: None = Depends(require_admin)) -> dict[str, object]:
    episodes = await kaggle.list_episodes(submission_id)
    return {"episodes": [item.model_dump() for item in episodes]}


@app.post("/api/kaggle/episodes/{episode_id}/import", dependencies=[Depends(require_admin)])
async def import_kaggle_episode(episode_id: int) -> dict[str, object]:
    replay = await kaggle.get_replay(episode_id)
    encoded = validate_replay_payload(replay)
    summary = store.save(replay, encoded=encoded, source="kaggle", episode_id=episode_id)
    return {"replay": summary.model_dump()}


if settings.static_dir.exists():
    app.mount("/assets", StaticFiles(directory=settings.static_dir / "assets"), name="assets")
    for public_dir in ("game-logs", "cabt-artifacts"):
        path = settings.static_dir / public_dir
        if path.exists():
            app.mount(f"/{public_dir}", StaticFiles(directory=path), name=public_dir)


@app.get("/api/{path:path}")
def missing_api(path: str):
    raise HTTPException(status_code=404, detail="API route not found.")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    index = settings.static_dir / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="Web build not found. Run npm run build in web/.")
    return FileResponse(index)

from __future__ import annotations

import hmac
import json
from json import JSONDecodeError
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .kaggle_client import KaggleClient
from .models import ImportReplayRequest, KaggleStatus
from .replay_store import ReplayStore
from .settings import load_settings

settings = load_settings()
store = ReplayStore(settings.data_dir, max_replays=settings.max_stored_replays)
kaggle = KaggleClient(settings.kaggle_base_url, settings.kaggle_credentials, max_response_bytes=settings.max_replay_bytes)

app = FastAPI(title="CABT Replay Viewer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "connect-src 'self'; "
        "img-src 'self' data: https://images.pokemontcg.io https://images.scrydex.com https://pkmncards.com; "
        "object-src 'none'; "
        "base-uri 'none'; "
        "frame-ancestors 'none'"
    ),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}


def with_security_headers(response):
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response


@app.middleware("http")
async def reject_oversized_replay_bodies(request: Request, call_next):
    if request.scope.get("path") == "/api/replays/import":
        raw_length = request.headers.get("content-length")
        if raw_length:
            try:
                content_length = int(raw_length)
            except ValueError:
                return with_security_headers(JSONResponse(status_code=400, content={"detail": "Invalid Content-Length header."}))
            if content_length > settings.max_replay_bytes:
                return with_security_headers(JSONResponse(status_code=413, content={"detail": "Replay payload is too large."}))
    return with_security_headers(await call_next(request))


def require_admin(x_cabt_admin_token: str = Header(default="")) -> None:
    if not settings.admin_token:
        raise HTTPException(status_code=403, detail="Admin imports are disabled until CABT_ADMIN_TOKEN is configured.")
    if not hmac.compare_digest(x_cabt_admin_token, settings.admin_token):
        raise HTTPException(status_code=403, detail="Admin token is required for replay imports and Kaggle access.")


def require_replay_import_admin(x_cabt_admin_token: str = Header(default="")) -> None:
    if settings.allow_public_imports:
        return
    require_admin(x_cabt_admin_token)


async def read_limited_json_body(request: Request) -> Any:
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > settings.max_replay_bytes:
            raise HTTPException(status_code=413, detail="Replay payload is too large.")
    if not body:
        raise HTTPException(status_code=400, detail="Replay payload is required.")
    try:
        return json.loads(body)
    except JSONDecodeError as error:
        raise HTTPException(status_code=400, detail="Replay payload must be valid JSON.") from error


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
def list_replays(q: str = Query("", max_length=200)) -> dict[str, object]:
    return {"replays": [item.model_dump() for item in store.list(q)]}


@app.post("/api/replays/import", dependencies=[Depends(require_replay_import_admin)])
async def import_replay(request: Request) -> dict[str, object]:
    try:
        import_request = ImportReplayRequest.model_validate(await read_limited_json_body(request))
    except ValidationError as error:
        raise HTTPException(status_code=400, detail="Replay import request is invalid.") from error
    encoded = validate_replay_payload(import_request.replay)
    summary = store.save(import_request.replay, encoded=encoded, name=import_request.name, source="upload")
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
        adminRequired=True,
        publicImportsEnabled=settings.allow_public_imports,
        message=kaggle.status_message(),
    )


@app.get("/api/kaggle/submissions")
async def kaggle_submissions(
    competition: str = Query("pokemon-tcg-ai-battle", pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$"),
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

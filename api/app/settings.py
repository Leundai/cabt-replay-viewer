from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

KAGGLE_ALLOWED_HOSTS = {"kaggle.com", "www.kaggle.com"}
KAGGLE_API_ALLOWED_HOSTS = {"api.kaggle.com"}


@dataclass(frozen=True)
class KaggleCredentials:
    mode: str
    username: str = ""
    key: str = ""
    bearer_token: str = ""

    @property
    def configured(self) -> bool:
        return bool(self.bearer_token or (self.username and self.key))


@dataclass
class Settings:
    data_dir: Path
    static_dir: Path
    kaggle_base_url: str
    kaggle_api_base_url: str
    kaggle_credentials: KaggleCredentials
    kaggle_default_competition: str
    kaggle_leaderboard_cache_seconds: int
    kaggle_leaderboard_page_size: int
    kaggle_leaderboard_team_submission_limit: int
    kaggle_leaderboard_submissions_per_team: int
    kaggle_leaderboard_episodes_per_submission: int
    admin_token: str
    allow_public_imports: bool
    max_replay_bytes: int
    max_stored_replays: int


def load_settings() -> Settings:
    data_dir = Path(os.getenv("CABT_DATA_DIR", ".data")).expanduser().resolve()
    static_dir = Path(os.getenv("CABT_STATIC_DIR", "api/app/static")).expanduser().resolve()
    return Settings(
        data_dir=data_dir,
        static_dir=static_dir,
        kaggle_base_url=normalize_kaggle_base_url(os.getenv("KAGGLE_BASE_URL", "https://www.kaggle.com")),
        kaggle_api_base_url=normalize_kaggle_base_url(
            os.getenv("KAGGLE_API_BASE_URL", "https://api.kaggle.com"),
            allowed_hosts=KAGGLE_API_ALLOWED_HOSTS,
            name="KAGGLE_API_BASE_URL",
        ),
        kaggle_credentials=load_kaggle_credentials(),
        kaggle_default_competition=os.getenv("KAGGLE_DEFAULT_COMPETITION", "pokemon-tcg-ai-battle"),
        kaggle_leaderboard_cache_seconds=bounded_int_env("KAGGLE_LEADERBOARD_CACHE_SECONDS", 1800, minimum=60, maximum=86_400),
        kaggle_leaderboard_page_size=bounded_int_env("KAGGLE_LEADERBOARD_PAGE_SIZE", 50, minimum=1, maximum=200),
        kaggle_leaderboard_team_submission_limit=bounded_int_env("KAGGLE_LEADERBOARD_TEAM_SUBMISSION_LIMIT", 50, minimum=0, maximum=100),
        kaggle_leaderboard_submissions_per_team=bounded_int_env("KAGGLE_LEADERBOARD_SUBMISSIONS_PER_TEAM", 2, minimum=0, maximum=20),
        kaggle_leaderboard_episodes_per_submission=bounded_int_env("KAGGLE_LEADERBOARD_EPISODES_PER_SUBMISSION", 2, minimum=0, maximum=20),
        admin_token=os.getenv("CABT_ADMIN_TOKEN", ""),
        allow_public_imports=os.getenv("CABT_ALLOW_PUBLIC_IMPORTS", "").lower() in {"1", "true", "yes"},
        max_replay_bytes=int(os.getenv("CABT_MAX_REPLAY_BYTES", str(25 * 1024 * 1024))),
        max_stored_replays=int(os.getenv("CABT_MAX_STORED_REPLAYS", "500")),
    )


def bounded_int_env(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        parsed = int(raw)
    except ValueError:
        parsed = default
    return min(maximum, max(minimum, parsed))


def normalize_kaggle_base_url(
    raw_url: str,
    *,
    allowed_hosts: set[str] = KAGGLE_ALLOWED_HOSTS,
    name: str = "KAGGLE_BASE_URL",
) -> str:
    parsed = urlparse(raw_url.strip())
    allow_unsafe = os.getenv("CABT_ALLOW_UNSAFE_KAGGLE_BASE_URLS", "").lower() in {"1", "true", "yes"}
    if parsed.scheme != "https":
        if not allow_unsafe:
            raise ValueError(f"{name} must use https.")
    if parsed.hostname not in allowed_hosts and not allow_unsafe:
        raise ValueError(f"{name} must point at an allowed Kaggle host.")
    if parsed.params or parsed.query or parsed.fragment:
        raise ValueError(f"{name} must not include params, query, or fragment.")
    return raw_url.strip().rstrip("/")


def load_kaggle_credentials() -> KaggleCredentials:
    bearer = (
        os.getenv("KAGGLE_BEARER_TOKEN")
        or os.getenv("KAGGLE_ACCESS_TOKEN")
        or os.getenv("KAGGLE_API_TOKEN")
        or read_local_access_token()
        or read_local_cli_credentials().get("access_token", "")
    )
    if bearer:
        return KaggleCredentials(mode="bearer", bearer_token=bearer)

    username = os.getenv("KAGGLE_USERNAME", "")
    key = os.getenv("KAGGLE_KEY", "")
    if not (username and key):
        local = read_local_kaggle_json()
        username = username or local.get("username", "")
        key = key or local.get("key", "")

    if username and key:
        return KaggleCredentials(mode="basic", username=username, key=key)

    return KaggleCredentials(mode="none")


def read_local_cli_credentials() -> dict[str, str]:
    path = Path.home() / ".kaggle" / "credentials.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except Exception:
        return {}
    return {
        "access_token": str(data.get("access_token", "")),
        "username": str(data.get("username", "")),
    }


def read_local_kaggle_json() -> dict[str, str]:
    path = Path.home() / ".kaggle" / "kaggle.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except Exception:
        return {}
    return {
        "username": str(data.get("username", "")),
        "key": str(data.get("key", "")),
    }


def read_local_access_token() -> str:
    path = Path.home() / ".kaggle" / "access_token"
    if not path.exists():
        return ""
    raw = path.read_text().strip()
    if not raw:
        return ""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    for key in ("access_token", "token", "id_token"):
        value = data.get(key)
        if value:
            return str(value)
    return ""

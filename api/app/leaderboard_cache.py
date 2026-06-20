from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .models import KaggleLeaderboardEntry, KaggleLeaderboardSnapshot
from .replay_store import safe_id


class LeaderboardCache:
    def __init__(self, data_dir: Path, ttl_seconds: int = 1800):
        self.root = data_dir / "leaderboards"
        self.ttl_seconds = max(60, ttl_seconds)
        self._lock = threading.Lock()

    def get(self, competition: str) -> KaggleLeaderboardSnapshot:
        try:
            self.ensure()
        except OSError:
            return self._empty_snapshot(competition, message="Leaderboard cache is not writable.")
        path = self._path(competition)
        if not path.exists():
            return self._empty_snapshot(competition)
        try:
            snapshot = KaggleLeaderboardSnapshot.model_validate(json.loads(path.read_text()))
        except Exception:
            return self._empty_snapshot(competition, message="Leaderboard cache could not be read.")
        return self._with_freshness(snapshot)

    def save(
        self,
        competition: str,
        entries: list[KaggleLeaderboardEntry],
        *,
        page_size: int,
        next_page_token: str | None = None,
    ) -> KaggleLeaderboardSnapshot:
        now = datetime.now(timezone.utc)
        snapshot = KaggleLeaderboardSnapshot(
            competition=competition,
            entries=entries,
            refreshedAt=now.isoformat(),
            expiresAt=(now + timedelta(seconds=self.ttl_seconds)).isoformat(),
            stale=False,
            refreshInSeconds=self.ttl_seconds,
            pageSize=page_size,
            nextPageToken=next_page_token,
            source="kaggle",
            message="Leaderboard refreshed from Kaggle.",
        )
        with self._lock:
            self.ensure()
            path = self._path(competition)
            temp_path = path.with_suffix(".json.tmp")
            temp_path.write_text(json.dumps(snapshot.model_dump(), indent=2))
            os.replace(temp_path, path)
        return snapshot

    def ensure(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, competition: str) -> Path:
        return self.root / f"{safe_id(competition)}.json"

    def _empty_snapshot(self, competition: str, message: str = "Leaderboard cache has not been warmed yet.") -> KaggleLeaderboardSnapshot:
        return KaggleLeaderboardSnapshot(competition=competition, message=message)

    def _with_freshness(self, snapshot: KaggleLeaderboardSnapshot) -> KaggleLeaderboardSnapshot:
        now = datetime.now(timezone.utc)
        expires_at = parse_datetime(snapshot.expiresAt)
        refresh_in = max(0, int((expires_at - now).total_seconds())) if expires_at else 0
        stale = refresh_in == 0
        return snapshot.model_copy(
            update={
                "stale": stale,
                "refreshInSeconds": refresh_in,
                "source": "stale" if stale else "cache",
                "message": "Leaderboard cache is stale." if stale else "Leaderboard served from cache.",
            }
        )


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed

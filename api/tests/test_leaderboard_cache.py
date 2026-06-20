from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from api.app.leaderboard_cache import LeaderboardCache
from api.app.models import KaggleLeaderboardEntry


def test_leaderboard_cache_round_trips_fresh_snapshot(tmp_path):
    cache = LeaderboardCache(tmp_path, ttl_seconds=1800)

    saved = cache.save(
        "pokemon-tcg-ai-battle",
        [KaggleLeaderboardEntry(rank=1, teamId=123, teamName="Alpha", score="100.0")],
        page_size=50,
        next_page_token="next",
    )
    loaded = cache.get("pokemon-tcg-ai-battle")

    assert saved.stale is False
    assert loaded.stale is False
    assert loaded.source == "cache"
    assert loaded.entries[0].teamName == "Alpha"
    assert loaded.nextPageToken == "next"


def test_leaderboard_cache_marks_expired_snapshot_stale(tmp_path):
    cache = LeaderboardCache(tmp_path, ttl_seconds=1800)
    snapshot = cache.save(
        "pokemon-tcg-ai-battle",
        [KaggleLeaderboardEntry(rank=1, teamId=123, teamName="Alpha", score="100.0")],
        page_size=50,
    )
    path = cache.root / "pokemon-tcg-ai-battle.json"
    data = snapshot.model_dump()
    data["expiresAt"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    path.write_text(json.dumps(data))

    loaded = cache.get("pokemon-tcg-ai-battle")

    assert loaded.stale is True
    assert loaded.refreshInSeconds == 0
    assert loaded.source == "stale"


def test_leaderboard_cache_get_tolerates_unwritable_root(tmp_path, monkeypatch):
    cache = LeaderboardCache(tmp_path, ttl_seconds=1800)

    def broken_ensure():
        raise PermissionError("nope")

    monkeypatch.setattr(cache, "ensure", broken_ensure)

    loaded = cache.get("pokemon-tcg-ai-battle")

    assert loaded.entries == []
    assert loaded.source == "empty"
    assert loaded.message == "Leaderboard cache is not writable."

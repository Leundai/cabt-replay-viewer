from __future__ import annotations

import pytest

from fastapi import HTTPException, Request
from fastapi.testclient import TestClient

from api.app.models import KaggleLeaderboardEntry
from api.app.main import app, read_limited_json_body, store
from api.app.settings import KaggleCredentials


def test_import_and_search_replay(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "root", tmp_path)
    monkeypatch.setattr(store, "replay_dir", tmp_path / "replays")
    monkeypatch.setattr(store, "index_path", tmp_path / "index.json")
    monkeypatch.setattr("api.app.main.settings.admin_token", "test-token")
    monkeypatch.setattr("api.app.main.settings.allow_public_imports", False)

    client = TestClient(app)
    replay = {
        "title": "Card Battle",
        "info": {"TeamNames": ["Demo Green", "Demo Fighting"]},
        "steps": [[{"visualize": []}, {"action": []}]],
    }

    blocked = client.post("/api/replays/import", json={"name": "lucario replay", "replay": replay})
    assert blocked.status_code == 403

    response = client.post(
        "/api/replays/import",
        headers={"X-CABT-Admin-Token": "test-token"},
        json={"name": "lucario replay", "replay": replay},
    )
    assert response.status_code == 200
    replay_id = response.json()["replay"]["id"]

    search = client.get("/api/replays?q=lucario")
    assert search.status_code == 200
    assert search.json()["replays"][0]["id"] == replay_id

    artifact = client.get(f"/api/replays/{replay_id}/artifact")
    assert artifact.status_code == 200
    assert artifact.json()["info"]["TeamNames"] == ["Demo Green", "Demo Fighting"]


def test_public_imports_do_not_unlock_kaggle_endpoints(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "root", tmp_path)
    monkeypatch.setattr(store, "replay_dir", tmp_path / "replays")
    monkeypatch.setattr(store, "index_path", tmp_path / "index.json")
    monkeypatch.setattr("api.app.main.settings.admin_token", "test-token")
    monkeypatch.setattr("api.app.main.settings.allow_public_imports", True)

    client = TestClient(app)
    replay = {
        "title": "Card Battle",
        "info": {"TeamNames": ["Demo Green", "Demo Fighting"]},
        "steps": [[{"visualize": []}, {"action": []}]],
    }

    upload = client.post("/api/replays/import", json={"name": "public upload", "replay": replay})
    assert upload.status_code == 200

    kaggle = client.get("/api/kaggle/submissions")
    assert kaggle.status_code == 403


def test_admin_session_requires_token(monkeypatch):
    monkeypatch.setattr("api.app.main.settings.admin_token", "test-token")

    client = TestClient(app)

    blocked = client.get("/api/admin/session")
    allowed = client.get("/api/admin/session", headers={"X-CABT-Admin-Token": "test-token"})

    assert blocked.status_code == 403
    assert allowed.status_code == 200
    assert allowed.json()["ok"] is True


def test_leaderboard_refresh_is_cached_for_public_reads(tmp_path, monkeypatch):
    monkeypatch.setattr("api.app.main.leaderboard_cache.root", tmp_path / "leaderboards")
    monkeypatch.setattr("api.app.main.settings.kaggle_credentials", KaggleCredentials(mode="bearer", bearer_token="token"))
    monkeypatch.setattr("api.app.main.settings.kaggle_leaderboard_page_size", 2)
    calls = []

    async def fake_list_leaderboard(competition: str, page_size: int):
        calls.append((competition, page_size))
        return [KaggleLeaderboardEntry(rank=1, teamId=123, teamName="Alpha", score="100.0")], None

    monkeypatch.setattr("api.app.main.kaggle.list_leaderboard", fake_list_leaderboard)

    client = TestClient(app)
    first = client.get("/api/kaggle/leaderboard")
    second = client.get("/api/kaggle/leaderboard")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["entries"][0]["teamName"] == "Alpha"
    assert second.json()["source"] == "cache"
    assert calls == [("pokemon-tcg-ai-battle", 2)]


def test_leaderboard_admin_refresh_requires_token(tmp_path, monkeypatch):
    monkeypatch.setattr("api.app.main.leaderboard_cache.root", tmp_path / "leaderboards")
    monkeypatch.setattr("api.app.main.settings.admin_token", "test-token")

    client = TestClient(app)

    blocked = client.post("/api/kaggle/leaderboard/refresh")

    assert blocked.status_code == 403


def test_rejects_non_replay_payload(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "root", tmp_path)
    monkeypatch.setattr(store, "replay_dir", tmp_path / "replays")
    monkeypatch.setattr(store, "index_path", tmp_path / "index.json")
    monkeypatch.setattr("api.app.main.settings.admin_token", "test-token")
    monkeypatch.setattr("api.app.main.settings.allow_public_imports", False)

    client = TestClient(app)
    response = client.post(
        "/api/replays/import",
        headers={"X-CABT-Admin-Token": "test-token"},
        json={"name": "not a replay", "replay": {"hello": "world"}},
    )

    assert response.status_code == 400


def test_rejects_invalid_replay_id(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "root", tmp_path)
    monkeypatch.setattr(store, "replay_dir", tmp_path / "replays")
    monkeypatch.setattr(store, "index_path", tmp_path / "index.json")

    client = TestClient(app)
    response = client.get("/api/replays/bad.id/artifact")

    assert response.status_code == 404


def test_rejects_overlong_replay_search_query():
    client = TestClient(app)
    response = client.get(f"/api/replays?q={'x' * 201}")

    assert response.status_code == 422


def test_rejects_oversized_import_before_handler(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "root", tmp_path)
    monkeypatch.setattr(store, "replay_dir", tmp_path / "replays")
    monkeypatch.setattr(store, "index_path", tmp_path / "index.json")
    monkeypatch.setattr("api.app.main.settings.admin_token", "test-token")
    monkeypatch.setattr("api.app.main.settings.allow_public_imports", False)
    monkeypatch.setattr("api.app.main.settings.max_replay_bytes", 10)

    client = TestClient(app)
    response = client.post(
        "/api/replays/import",
        headers={"X-CABT-Admin-Token": "test-token"},
        json={"replay": {"visualize": []}},
    )

    assert response.status_code == 413


@pytest.mark.anyio
async def test_rejects_oversized_streaming_import_without_content_length(monkeypatch):
    monkeypatch.setattr("api.app.main.settings.max_replay_bytes", 10)

    async def receive():
        return {"type": "http.request", "body": b'{"replay":{"visualize":[]}}', "more_body": False}

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/replays/import",
            "headers": [],
        },
        receive,
    )

    with pytest.raises(HTTPException) as error:
        await read_limited_json_body(request)

    assert error.value.status_code == 413


def test_missing_api_route_returns_json_404():
    client = TestClient(app)
    response = client.get("/api/nope")

    assert response.status_code == 404
    assert response.json()["detail"] == "API route not found."

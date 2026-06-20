from __future__ import annotations

from fastapi.testclient import TestClient

from api.app.main import app, store


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


def test_missing_api_route_returns_json_404():
    client = TestClient(app)
    response = client.get("/api/nope")

    assert response.status_code == 404
    assert response.json()["detail"] == "API route not found."

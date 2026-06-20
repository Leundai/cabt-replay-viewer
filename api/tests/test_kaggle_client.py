from __future__ import annotations

import pytest
from fastapi import HTTPException

from api.app.kaggle_client import KaggleClient, normalize_episode, normalize_leaderboard_entry, normalize_submission
from api.app.settings import KaggleCredentials, load_kaggle_credentials, normalize_kaggle_base_url


def test_kaggle_normalizers_tolerate_non_numeric_ids():
    submission = normalize_submission({"id": "not-a-number", "teamName": "Demo"})
    episode = normalize_episode({"episodeId": "also-not-a-number", "agents": [{"submissionId": "bad"}]})

    assert submission.id == 0
    assert submission.teamName == "Demo"
    assert episode.id == 0
    assert episode.submissionId is None


def test_kaggle_api_token_is_supported(monkeypatch):
    monkeypatch.delenv("KAGGLE_BEARER_TOKEN", raising=False)
    monkeypatch.delenv("KAGGLE_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("KAGGLE_USERNAME", raising=False)
    monkeypatch.delenv("KAGGLE_KEY", raising=False)
    monkeypatch.setenv("KAGGLE_API_TOKEN", "token-from-kaggle-settings")

    credentials = load_kaggle_credentials()

    assert credentials.mode == "bearer"
    assert credentials.bearer_token == "token-from-kaggle-settings"


def test_kaggle_cli_oauth_credentials_are_supported(tmp_path, monkeypatch):
    monkeypatch.delenv("KAGGLE_BEARER_TOKEN", raising=False)
    monkeypatch.delenv("KAGGLE_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("KAGGLE_API_TOKEN", raising=False)
    monkeypatch.delenv("KAGGLE_USERNAME", raising=False)
    monkeypatch.delenv("KAGGLE_KEY", raising=False)
    kaggle_dir = tmp_path / ".kaggle"
    kaggle_dir.mkdir()
    (kaggle_dir / "credentials.json").write_text('{"access_token": "oauth-token", "username": "demo"}')
    monkeypatch.setenv("HOME", str(tmp_path))

    credentials = load_kaggle_credentials()

    assert credentials.mode == "bearer"
    assert credentials.bearer_token == "oauth-token"


@pytest.mark.anyio
async def test_kaggle_submission_list_response_shape_is_supported(monkeypatch):
    client = KaggleClient("https://example.com", KaggleCredentials(mode="bearer", bearer_token="token"), max_response_bytes=1024)

    async def fake_post_rpc(method, payload):
        return [{"ref": 123, "teamName": "Leundai", "status": "complete"}]

    monkeypatch.setattr(client, "_post_rpc", fake_post_rpc)

    submissions = await client.list_submissions("pokemon-tcg-ai-battle")

    assert submissions[0].id == 123
    assert submissions[0].teamName == "Leundai"


@pytest.mark.anyio
async def test_kaggle_leaderboard_response_shape_is_supported(monkeypatch):
    client = KaggleClient("https://example.com", KaggleCredentials(mode="bearer", bearer_token="token"), max_response_bytes=1024)

    async def fake_post_rpc(method, payload):
        assert method == "GetLeaderboard"
        assert payload["pageSize"] == 2
        return {
            "submissions": [
                {"teamId": 10, "teamName": "Alpha", "submissionDate": "2026-06-20T12:00:00Z", "score": "42.0"},
                {"teamId": 20, "teamName": "Beta", "score": "40.5"},
            ],
            "nextPageToken": "next",
        }

    monkeypatch.setattr(client, "_post_rpc", fake_post_rpc)

    entries, next_page_token = await client.list_leaderboard("pokemon-tcg-ai-battle", page_size=2)

    assert [entry.rank for entry in entries] == [1, 2]
    assert entries[0].teamId == 10
    assert entries[0].teamName == "Alpha"
    assert next_page_token == "next"


def test_leaderboard_normalizer_tolerates_missing_team_id():
    entry = normalize_leaderboard_entry({"teamName": "No Id", "score": "1.23"}, rank=7)

    assert entry.rank == 7
    assert entry.teamId is None
    assert entry.teamName == "No Id"


def test_kaggle_base_url_rejects_non_kaggle_hosts(monkeypatch):
    monkeypatch.delenv("CABT_ALLOW_UNSAFE_KAGGLE_BASE_URLS", raising=False)

    with pytest.raises(ValueError):
        normalize_kaggle_base_url("https://metadata.google.internal")


@pytest.mark.anyio
async def test_kaggle_response_size_is_capped():
    client = KaggleClient("https://www.kaggle.com", KaggleCredentials(mode="none"), max_response_bytes=3)

    class FakeResponse:
        headers = {}

        async def aiter_bytes(self):
            yield b"1234"

    with pytest.raises(HTTPException) as error:
        await client._read_limited_response(FakeResponse())

    assert error.value.status_code == 502

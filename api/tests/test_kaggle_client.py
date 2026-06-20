from __future__ import annotations

import pytest
import httpx
from fastapi import HTTPException

from api.app.kaggle_client import KaggleClient, normalize_episode, normalize_leaderboard_entry, normalize_submission
from api.app.settings import KaggleCredentials, load_kaggle_credentials, normalize_kaggle_base_url


def test_kaggle_normalizers_tolerate_non_numeric_ids():
    submission = normalize_submission({"id": "not-a-number", "teamName": "Demo", "dateSubmitted": "2026-06-20T00:00:00Z"})
    episode = normalize_episode({"episodeId": "also-not-a-number", "agents": [{"submissionId": "bad"}]})

    assert submission.id == 0
    assert submission.teamName == "Demo"
    assert submission.date == "2026-06-20T00:00:00Z"
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
async def test_kaggle_team_public_submissions_response_shape_is_supported(monkeypatch):
    client = KaggleClient("https://example.com", KaggleCredentials(mode="bearer", bearer_token="token"), max_response_bytes=1024)

    async def fake_post_rpc(method, payload):
        assert method == "ListTeamPublicSubmissions"
        assert payload == {"teamId": 16376775}
        return {
            "submissions": [
                {
                    "id": 111,
                    "dateSubmitted": "2026-06-20T12:00:00Z",
                    "publicScore": "1307.9",
                    "status": "complete",
                },
            ],
        }

    monkeypatch.setattr(client, "_post_rpc", fake_post_rpc)

    submissions = await client.list_team_submissions(16376775, team_name="TrustHub hiroingk")

    assert submissions[0].id == 111
    assert submissions[0].teamId == 16376775
    assert submissions[0].teamName == "TrustHub hiroingk"
    assert submissions[0].score == "1307.9"
    assert submissions[0].date == "2026-06-20T12:00:00Z"


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


@pytest.mark.anyio
async def test_kaggle_transport_errors_return_502(monkeypatch):
    client = KaggleClient("https://example.com", KaggleCredentials(mode="bearer", bearer_token="token"), max_response_bytes=1024)

    class BrokenStream:
        async def __aenter__(self):
            raise httpx.ConnectError("network went away")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, *args, **kwargs):
            return BrokenStream()

    monkeypatch.setattr("api.app.kaggle_client.httpx.AsyncClient", FakeAsyncClient)

    with pytest.raises(HTTPException) as error:
        await client.list_leaderboard("pokemon-tcg-ai-battle", page_size=2)

    assert error.value.status_code == 502
    assert error.value.detail == "Kaggle request could not be completed."


def test_leaderboard_normalizer_tolerates_missing_team_id():
    entry = normalize_leaderboard_entry({"teamName": "No Id", "score": "1.23"}, rank=7)

    assert entry.rank == 7
    assert entry.teamId is None
    assert entry.teamName == "No Id"


def test_episode_normalizer_prefers_matching_submission_agent():
    episode = normalize_episode(
        {
            "episodeId": 9001,
            "competitionName": "pokemon-tcg-ai-battle",
            "agents": [
                {"submissionId": 222, "reward": "0"},
                {"submissionId": 111, "reward": "1"},
            ],
        },
        fallback_submission_id=111,
    )

    assert episode.id == 9001
    assert episode.submissionId == 111
    assert episode.competitionName == "pokemon-tcg-ai-battle"
    assert episode.reward == "1"


def test_kaggle_base_url_rejects_non_kaggle_hosts(monkeypatch):
    monkeypatch.delenv("CABT_ALLOW_UNSAFE_KAGGLE_BASE_URLS", raising=False)

    with pytest.raises(ValueError):
        normalize_kaggle_base_url("https://metadata.google.internal")


def test_kaggle_rate_limit_preserves_429_status():
    client = KaggleClient("https://www.kaggle.com", KaggleCredentials(mode="none"), max_response_bytes=1024)

    class FakeResponse:
        status_code = 429

    with pytest.raises(HTTPException) as error:
        client._decode_response(FakeResponse(), b"{}")

    assert error.value.status_code == 429
    assert error.value.detail == "Kaggle rate limit was reached."


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

from __future__ import annotations

import pytest

from api.app.kaggle_client import KaggleClient, normalize_episode, normalize_submission
from api.app.settings import KaggleCredentials, load_kaggle_credentials


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


@pytest.mark.anyio
async def test_kaggle_submission_list_response_shape_is_supported(monkeypatch):
    client = KaggleClient("https://example.com", KaggleCredentials(mode="bearer", bearer_token="token"))

    async def fake_get(path, params=None):
        return [{"ref": 123, "teamName": "Leundai", "status": "complete"}]

    monkeypatch.setattr(client, "_get", fake_get)

    submissions = await client.list_submissions("pokemon-tcg-ai-battle")

    assert submissions[0].id == 123
    assert submissions[0].teamName == "Leundai"

from __future__ import annotations

from api.app.kaggle_client import normalize_episode, normalize_submission
from api.app.settings import load_kaggle_credentials


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

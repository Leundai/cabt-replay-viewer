from __future__ import annotations

from api.app.kaggle_client import normalize_episode, normalize_submission


def test_kaggle_normalizers_tolerate_non_numeric_ids():
    submission = normalize_submission({"id": "not-a-number", "teamName": "Demo"})
    episode = normalize_episode({"episodeId": "also-not-a-number", "agents": [{"submissionId": "bad"}]})

    assert submission.id == 0
    assert submission.teamName == "Demo"
    assert episode.id == 0
    assert episode.submissionId is None

from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException

from .models import KaggleEpisode, KaggleSubmission
from .settings import KaggleCredentials


class KaggleClient:
    def __init__(self, base_url: str, credentials: KaggleCredentials):
        self.base_url = base_url
        self.credentials = credentials

    def status_message(self) -> str:
        if self.credentials.configured:
            return "Kaggle credentials are configured server-side."
        return "Kaggle credentials are not configured. JSON upload still works; set KAGGLE_API_TOKEN or KAGGLE_USERNAME/KAGGLE_KEY on the server to import Kaggle episodes."

    async def list_submissions(self, competition: str, page: int = 1, page_size: int = 25) -> list[KaggleSubmission]:
        data = await self._get(
            f"/api/v1/competitions/submissions/list/{competition}",
            params={"page": page, "pageSize": page_size},
        )
        raw_items = data if isinstance(data, list) else data.get("submissions", [])
        return [normalize_submission(item) for item in raw_items if isinstance(item, dict)]

    async def list_episodes(self, submission_id: int) -> list[KaggleEpisode]:
        data = await self._get(f"/api/v1/competitions/submissions/{submission_id}/episodes")
        raw_items = data if isinstance(data, list) else data.get("episodes", [])
        return [normalize_episode(item, submission_id) for item in raw_items if isinstance(item, dict)]

    async def get_replay(self, episode_id: int) -> Any:
        return await self._get(f"/api/v1/competitions/episodes/{episode_id}/replay")

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        headers = {"Accept": "application/json"}
        auth: httpx.BasicAuth | None = None
        if self.credentials.bearer_token:
            headers["Authorization"] = f"Bearer {self.credentials.bearer_token}"
        elif self.credentials.username and self.credentials.key:
            auth = httpx.BasicAuth(self.credentials.username, self.credentials.key)

        async with httpx.AsyncClient(base_url=self.base_url, timeout=45.0, follow_redirects=True) as client:
            response = await client.get(path, params=params, headers=headers, auth=auth)

        if response.status_code in (401, 403):
            raise HTTPException(status_code=response.status_code, detail="Kaggle authentication failed or is required for this endpoint.")
        if response.status_code == 404:
            raise HTTPException(status_code=404, detail="Kaggle resource was not found.")
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Kaggle request failed with status {response.status_code}.")

        try:
            return response.json()
        except ValueError as error:
            raise HTTPException(status_code=502, detail="Kaggle returned a non-JSON response.") from error


def normalize_submission(item: dict[str, Any]) -> KaggleSubmission:
    return KaggleSubmission(
        id=parse_int(value(item, "ref", "id", "submissionId")),
        teamName=value(item, "teamName", "team_name"),
        submittedBy=value(item, "submittedBy", "submitted_by"),
        description=value(item, "description"),
        score=value(item, "publicScore", "privateScore", "score"),
        status=value(item, "status"),
        date=value(item, "date"),
    )


def normalize_episode(item: dict[str, Any], fallback_submission_id: int | None = None) -> KaggleEpisode:
    agents = item.get("agents") if isinstance(item.get("agents"), list) else []
    matching_agent = next((agent for agent in agents if isinstance(agent, dict) and agent.get("submissionId")), {})
    return KaggleEpisode(
        id=parse_int(value(item, "id", "episodeId")),
        submissionId=parse_int(matching_agent.get("submissionId") or fallback_submission_id) or None,
        reward=value(matching_agent, "reward"),
        status=value(item, "state", "status"),
        date=value(item, "createTime", "date"),
    )


def value(item: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in item and item[key] not in (None, ""):
            return item[key]
    return None


def parse_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0

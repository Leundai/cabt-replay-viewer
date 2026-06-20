from __future__ import annotations

import json
from typing import Any

import httpx
from fastapi import HTTPException

from .models import KaggleEpisode, KaggleLeaderboardEntry, KaggleSubmission
from .settings import KaggleCredentials


class KaggleClient:
    def __init__(self, base_url: str, credentials: KaggleCredentials, max_response_bytes: int, api_base_url: str = "https://api.kaggle.com"):
        self.base_url = base_url
        self.api_base_url = api_base_url
        self.credentials = credentials
        self.max_response_bytes = max_response_bytes

    def status_message(self) -> str:
        if self.credentials.configured:
            return "Kaggle credentials are configured server-side."
        return "Kaggle credentials are not configured. JSON upload still works; set KAGGLE_API_TOKEN or KAGGLE_USERNAME/KAGGLE_KEY on the server to import Kaggle episodes."

    async def list_submissions(self, competition: str, page: int = 1, page_size: int = 25) -> list[KaggleSubmission]:
        data = await self._post_rpc(
            "ListSubmissions",
            {"competitionName": competition, "page": page, "pageSize": page_size},
        )
        raw_items = data if isinstance(data, list) else data.get("submissions", [])
        return [normalize_submission(item) for item in raw_items if isinstance(item, dict)]

    async def list_episodes(self, submission_id: int) -> list[KaggleEpisode]:
        data = await self._post_rpc("ListSubmissionEpisodes", {"submissionId": submission_id})
        raw_items = data if isinstance(data, list) else data.get("episodes", [])
        return [normalize_episode(item, submission_id) for item in raw_items if isinstance(item, dict)]

    async def list_leaderboard(self, competition: str, page_size: int = 50) -> tuple[list[KaggleLeaderboardEntry], str | None]:
        data = await self._post_rpc(
            "GetLeaderboard",
            {"competitionName": competition, "overridePublic": True, "pageSize": page_size},
        )
        raw_items = data if isinstance(data, list) else data.get("submissions", [])
        entries = [
            normalize_leaderboard_entry(item, rank)
            for rank, item in enumerate(raw_items, start=1)
            if isinstance(item, dict)
        ]
        next_page_token = data.get("nextPageToken") if isinstance(data, dict) else None
        return entries, str(next_page_token) if next_page_token else None

    async def get_replay(self, episode_id: int) -> Any:
        return await self._get(f"/api/v1/competitions/episodes/{episode_id}/replay")

    async def _post_rpc(self, method: str, payload: dict[str, Any]) -> Any:
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        auth: httpx.BasicAuth | None = None
        if self.credentials.bearer_token:
            headers["Authorization"] = f"Bearer {self.credentials.bearer_token}"
        elif self.credentials.username and self.credentials.key:
            auth = httpx.BasicAuth(self.credentials.username, self.credentials.key)

        try:
            async with httpx.AsyncClient(base_url=self.api_base_url, timeout=45.0, follow_redirects=False) as client:
                async with client.stream(
                    "POST",
                    f"/v1/competitions.CompetitionApiService/{method}",
                    json=payload,
                    headers=headers,
                    auth=auth,
                ) as response:
                    raw = await self._read_limited_response(response)
        except httpx.HTTPError as error:
            raise HTTPException(status_code=502, detail="Kaggle request could not be completed.") from error

        return self._decode_response(response, raw)

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        headers = {"Accept": "application/json"}
        auth: httpx.BasicAuth | None = None
        if self.credentials.bearer_token:
            headers["Authorization"] = f"Bearer {self.credentials.bearer_token}"
        elif self.credentials.username and self.credentials.key:
            auth = httpx.BasicAuth(self.credentials.username, self.credentials.key)

        try:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=45.0, follow_redirects=False) as client:
                async with client.stream("GET", path, params=params, headers=headers, auth=auth) as response:
                    raw = await self._read_limited_response(response)
        except httpx.HTTPError as error:
            raise HTTPException(status_code=502, detail="Kaggle request could not be completed.") from error

        return self._decode_response(response, raw)

    def _decode_response(self, response: httpx.Response, raw: bytes) -> Any:
        if response.status_code in (401, 403):
            raise HTTPException(status_code=response.status_code, detail="Kaggle authentication failed or is required for this endpoint.")
        if response.status_code == 404:
            raise HTTPException(status_code=404, detail="Kaggle resource was not found.")
        if response.status_code in (301, 302, 303, 307, 308):
            raise HTTPException(status_code=502, detail="Kaggle returned an unexpected redirect.")
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Kaggle request failed with status {response.status_code}.")

        try:
            return json.loads(raw)
        except ValueError as error:
            raise HTTPException(status_code=502, detail="Kaggle returned a non-JSON response.") from error

    async def _read_limited_response(self, response: httpx.Response) -> bytes:
        raw_length = response.headers.get("content-length")
        if raw_length:
            try:
                content_length = int(raw_length)
            except ValueError:
                content_length = 0
            if content_length > self.max_response_bytes:
                raise HTTPException(status_code=502, detail="Kaggle response is too large.")

        chunks: list[bytes] = []
        total = 0
        async for chunk in response.aiter_bytes():
            total += len(chunk)
            if total > self.max_response_bytes:
                raise HTTPException(status_code=502, detail="Kaggle response is too large.")
            chunks.append(chunk)
        return b"".join(chunks)


def normalize_submission(item: dict[str, Any]) -> KaggleSubmission:
    return KaggleSubmission(
        id=parse_int(value(item, "ref", "id", "submissionId")),
        teamId=parse_optional_int(value(item, "teamId", "team_id")),
        teamName=value(item, "teamName", "team_name"),
        submittedBy=value(item, "submittedBy", "submitted_by"),
        description=value(item, "description"),
        score=value(item, "publicScore", "privateScore", "score"),
        status=value(item, "status"),
        date=value(item, "date"),
    )


def normalize_leaderboard_entry(item: dict[str, Any], rank: int) -> KaggleLeaderboardEntry:
    return KaggleLeaderboardEntry(
        rank=rank,
        teamId=parse_optional_int(value(item, "teamId", "team_id")),
        teamName=str(value(item, "teamName", "team_name") or "Team"),
        score=value(item, "score"),
        submissionDate=value(item, "submissionDate", "submission_date", "date"),
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


def parse_optional_int(value: Any) -> int | None:
    parsed = parse_int(value)
    return parsed or None

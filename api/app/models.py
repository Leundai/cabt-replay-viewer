from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ReplaySummary(BaseModel):
    id: str
    name: str
    source: str
    players: list[str] = Field(default_factory=list)
    actionCount: int = 0
    stateCount: int = 0
    createdAt: str | None = None
    episodeId: int | None = None
    submissionId: int | None = None


class ImportReplayRequest(BaseModel):
    name: str | None = None
    replay: Any


class KaggleStatus(BaseModel):
    configured: bool
    authMode: str
    adminRequired: bool
    publicImportsEnabled: bool
    message: str


class KaggleSubmission(BaseModel):
    id: int
    teamId: int | None = None
    teamName: str | None = None
    submittedBy: str | None = None
    description: str | None = None
    score: str | float | None = None
    status: str | None = None
    date: str | None = None


class KaggleEpisode(BaseModel):
    id: int
    submissionId: int | None = None
    competitionName: str | None = None
    reward: str | float | None = None
    status: str | None = None
    date: str | None = None

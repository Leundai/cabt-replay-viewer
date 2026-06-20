from __future__ import annotations

import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import ReplaySummary


class ReplayStore:
    def __init__(self, data_dir: Path):
        self.root = data_dir
        self.replay_dir = self.root / "replays"
        self.index_path = self.root / "index.json"
        self._lock = threading.Lock()

    def ensure(self) -> None:
        self.replay_dir.mkdir(parents=True, exist_ok=True)
        if not self.index_path.exists():
            self.index_path.write_text("[]")

    def list(self, query: str = "") -> list[ReplaySummary]:
        self.ensure()
        summaries = [ReplaySummary.model_validate(item) for item in json.loads(self.index_path.read_text())]
        normalized = query.strip().lower()
        if normalized:
            summaries = [
                summary
                for summary in summaries
                if normalized in " ".join([
                    summary.id,
                    summary.name,
                    summary.source,
                    " ".join(summary.players),
                    str(summary.episodeId or ""),
                    str(summary.submissionId or ""),
                ]).lower()
            ]
        return sorted(summaries, key=lambda item: item.createdAt or "", reverse=True)

    def get_artifact(self, replay_id: str) -> Any:
        self.ensure()
        path = self.replay_dir / f"{safe_id(replay_id)}.json"
        if not path.exists():
            raise FileNotFoundError(replay_id)
        return json.loads(path.read_text())

    def save(self, replay: Any, *, name: str | None = None, source: str = "upload", episode_id: int | None = None, submission_id: int | None = None) -> ReplaySummary:
        self.ensure()
        encoded = json.dumps(replay, sort_keys=True, separators=(",", ":")).encode()
        digest = hashlib.sha256(encoded).hexdigest()[:16]
        replay_id = safe_id(f"{source}-{episode_id or digest}")
        (self.replay_dir / f"{replay_id}.json").write_bytes(encoded)

        summary = ReplaySummary(
            id=replay_id,
            name=name or infer_replay_name(replay, replay_id),
            source=source,
            players=infer_players(replay),
            actionCount=infer_action_count(replay),
            stateCount=infer_state_count(replay),
            createdAt=datetime.now(timezone.utc).isoformat(),
            episodeId=episode_id,
            submissionId=submission_id,
        )
        self._upsert(summary)
        return summary

    def _upsert(self, summary: ReplaySummary) -> None:
        with self._lock:
            self.ensure()
            items = [
                ReplaySummary.model_validate(item)
                for item in json.loads(self.index_path.read_text())
                if item.get("id") != summary.id
            ]
            items.insert(0, summary)
            temp_path = self.index_path.with_suffix(".json.tmp")
            temp_path.write_text(json.dumps([item.model_dump() for item in items], indent=2))
            os.replace(temp_path, self.index_path)


def infer_replay_name(replay: Any, fallback: str) -> str:
    if isinstance(replay, dict):
        title = replay.get("title") or replay.get("name") or replay.get("id")
        if title:
            players = infer_players(replay)
            return f"{players[0]} vs {players[1]}" if len(players) >= 2 else str(title)
    return fallback


def infer_players(replay: Any) -> list[str]:
    if not isinstance(replay, dict):
        return []

    environment = replay.get("environment")
    if isinstance(environment, dict):
        players = environment.get("players")
        if isinstance(players, list):
            names = [player.get("name") for player in players if isinstance(player, dict) and player.get("name")]
            if names:
                return [str(name) for name in names]

    info = replay.get("info")
    team_names = info.get("TeamNames") if isinstance(info, dict) else None
    if isinstance(team_names, list):
        return [str(name) for name in team_names if name]

    steps = replay.get("steps")
    if isinstance(steps, list) and steps:
        first = steps[0]
        if isinstance(first, list):
            names = []
            for agent in first:
                if isinstance(agent, dict):
                    info = agent.get("info")
                    if isinstance(info, dict) and info.get("team_name"):
                        names.append(str(info["team_name"]))
            if names:
                return names

    return []


def infer_action_count(replay: Any) -> int:
    if not isinstance(replay, dict):
        return 0
    steps = replay.get("steps")
    if isinstance(steps, list):
        return max(0, len(steps) - 1)
    visualize = replay.get("visualize")
    if isinstance(visualize, list):
        return max(0, len(visualize) - 1)
    return 0


def infer_state_count(replay: Any) -> int:
    if not isinstance(replay, dict):
        return 0
    visualize = replay.get("visualize")
    if isinstance(visualize, list):
        return len(visualize)
    steps = replay.get("steps")
    if isinstance(steps, list):
        return len(steps)
    return 0


def safe_id(value: str) -> str:
    return "".join(char if char.isalnum() or char in "-_" else "-" for char in value).strip("-")[:96] or "replay"

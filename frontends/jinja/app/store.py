"""Thread persistence, kept in pydantic-ai's own message format.

Storing `ModelMessage` rather than a wire format is what lets one store serve
every protocol: each adapter's `dump_messages` renders these into its own shape
on the way out, so adding a protocol doesn't add a migration.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from pydantic_ai.messages import (
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    UserPromptPart,
)

SCHEMA = """
create table if not exists threads (
    id         text primary key,
    title      text not null default 'New thread',
    created_at text not null,
    updated_at text not null,
    messages   text not null default '[]'
);
"""


@dataclass(frozen=True, slots=True)
class ThreadSummary:
    id: str
    title: str
    created_at: str
    updated_at: str
    message_count: int


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def derive_title(messages: Sequence[ModelMessage]) -> str:
    for message in messages:
        if not isinstance(message, ModelRequest):
            continue
        for part in message.parts:
            if isinstance(part, UserPromptPart) and isinstance(part.content, str):
                text = " ".join(part.content.split())
                return text[:60] + ("…" if len(text) > 60 else "")
    return "New thread"


class ThreadStore:
    def __init__(self, path: Path) -> None:
        self._path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.executescript(SCHEMA)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self._path)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        finally:
            db.close()

    def list(self) -> list[ThreadSummary]:
        with self._connect() as db:
            rows = db.execute(
                "select id, title, created_at, updated_at, messages"
                " from threads order by updated_at desc"
            ).fetchall()
        return [
            ThreadSummary(
                id=row["id"],
                title=row["title"],
                created_at=row["created_at"],
                updated_at=row["updated_at"],
                message_count=len(ModelMessagesTypeAdapter.validate_json(row["messages"])),
            )
            for row in rows
        ]

    def history(self, thread_id: str) -> list[ModelMessage]:
        with self._connect() as db:
            row = db.execute(
                "select messages from threads where id = ?", (thread_id,)
            ).fetchone()
        if row is None:
            return []
        return list(ModelMessagesTypeAdapter.validate_json(row["messages"]))

    def exists(self, thread_id: str) -> bool:
        with self._connect() as db:
            return (
                db.execute("select 1 from threads where id = ?", (thread_id,)).fetchone()
                is not None
            )

    def save(self, thread_id: str, messages: Sequence[ModelMessage]) -> None:
        payload = ModelMessagesTypeAdapter.dump_json(list(messages)).decode()
        now = _now()
        with self._connect() as db:
            db.execute(
                """
                insert into threads (id, title, created_at, updated_at, messages)
                values (?, ?, ?, ?, ?)
                on conflict(id) do update set
                    title = excluded.title,
                    updated_at = excluded.updated_at,
                    messages = excluded.messages
                """,
                (thread_id, derive_title(messages), now, now, payload),
            )

    def delete(self, thread_id: str) -> bool:
        with self._connect() as db:
            return db.execute("delete from threads where id = ?", (thread_id,)).rowcount > 0

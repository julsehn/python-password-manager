from dataclasses import dataclass, field
from datetime import datetime, timezone
from collections.abc import Mapping
from typing import TypedDict
import uuid


class PasswordEntryData(TypedDict):
    id: str
    site: str
    username: str
    password: str
    notes: str
    created_at: str
    updated_at: str


@dataclass
class PasswordEntry:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    site: str = field(default="")
    username: str = field(default="")
    password: str = field(default="", repr=False, compare=False)  # Don't show in repr
    notes: str = field(default="")
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> PasswordEntryData:
        return {
            "id": self.id,
            "site": self.site,
            "username": self.username,
            "password": self.password,
            "notes": self.notes,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @staticmethod
    def from_dict(data: Mapping[str, object]) -> "PasswordEntry":
        e = PasswordEntry()
        e.id = str(data.get("id") or e.id)
        e.site = str(data.get("site") or "")
        e.username = str(data.get("username") or "")
        e.password = str(data.get("password") or "")
        e.notes = str(data.get("notes") or "")
        e.created_at = str(data.get("created_at") or e.created_at)
        e.updated_at = str(data.get("updated_at") or e.updated_at)
        return e

    def clear_password(self) -> None:
        """Zero out password memory to prevent leakage."""
        # Python strings are immutable, but clearing the attribute helps
        self.password = ""

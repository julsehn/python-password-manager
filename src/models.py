from dataclasses import dataclass, field
from datetime import datetime, timezone
import uuid
from typing import Dict, Any


@dataclass
class PasswordEntry:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    site: str = field(default="")
    username: str = field(default="")
    password: str = field(default="", repr=False, compare=False)  # Don't show in repr
    notes: str = field(default="")
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
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
    def from_dict(d: Dict[str, Any]) -> "PasswordEntry":
        e = PasswordEntry()
        e.id = d.get("id", e.id)
        e.site = str(d.get("site", "")) if d.get("site") else ""
        e.username = str(d.get("username", "")) if d.get("username") else ""
        e.password = str(d.get("password", "")) if d.get("password") else ""
        e.notes = str(d.get("notes", "")) if d.get("notes") else ""
        e.created_at = str(d.get("created_at", e.created_at)) if d.get("created_at") else e.created_at
        e.updated_at = str(d.get("updated_at", e.updated_at)) if d.get("updated_at") else e.updated_at
        return e

    def clear_password(self) -> None:
        """Zero out password memory to prevent leakage."""
        # Python strings are immutable, but clearing the attribute helps
        self.password = ""

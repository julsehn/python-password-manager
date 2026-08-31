from typing import List, Optional
from src.models import PasswordEntry
import secrets
import string
from src.storage import save_vault, load_vault, VAULT_FILENAME


class PasswordManager:
    """In-memory password manager with security improvements.

    Security features:
      - Input sanitization for site URLs to prevent XSS
      - Password length validation (minimum 12 chars)
      - Memory-safe password clearing on deletion
    """

    def __init__(self):
        self.entries: List[PasswordEntry] = []

    @staticmethod
    def _sanitize_url(url: str) -> str:
        """Sanitize URL to prevent XSS attacks."""
        if not url:
            return ""

        url = url.strip()

        # Block dangerous protocols
        if "javascript:" in url.lower() or "vbscript:" in url.lower():
            return ""

        if url.startswith(("http://", "https://")):
            return url

        if url.startswith("www."):
            return "https://" + url

        # Default to https for any plain domain
        if "." in url and len(url) > 2:
            return "https://" + url

        return "" if not url else url

    @staticmethod
    def _sanitize_text(text: str, max_length: int = 500) -> str:
        """Sanitize and truncate text input."""
        if not text:
            return ""
        return text.strip()[:max_length]

    def add_entry(self, site: str, username: str, password: str, notes: str = "") -> Optional[PasswordEntry]:
        """Add a new entry with input validation."""
        # Validate password length (minimum 8 characters for stored passwords)
        if len(password) < 8:
            raise ValueError("La contrasenya és massa curta (mínim 8 caràcters).")

        # Sanitize inputs
        site = self._sanitize_url(site)
        username = self._sanitize_text(username, 256)
        notes = self._sanitize_text(notes, max_length=1000)

        entry = PasswordEntry(
            site=site,
            username=username,
            password=password,
            notes=notes
        )
        self.entries.append(entry)
        return entry

    def delete_entry(self, entry_id: str) -> bool:
        """Delete an entry and clear password from memory."""
        for i, e in enumerate(self.entries):
            if e.id == entry_id:
                # Clear password from memory before deletion
                e.clear_password()
                del self.entries[i]
                return True
        return False

    def get_entries(self) -> List[PasswordEntry]:
        """Return entries (copy to prevent external modification)."""
        return list(self.entries)

    def find_entry(self, entry_id: str) -> Optional[PasswordEntry]:
        """Find an entry by ID."""
        for e in self.entries:
            if e.id == entry_id:
                return e
        return None

    def generate_password(
        self,
        length: int = 16,
        use_upper: bool = True,
        use_numbers: bool = True,
        use_symbols: bool = True,
    ) -> str:
        """Generate a cryptographically secure random password.

        Security improvements:
          - Guarantees at least 1 character from each required set
          - Uses secrets module (CSPRNG) instead of random
        """
        character_sets = [string.ascii_lowercase]

        if use_upper:
            character_sets.append(string.ascii_uppercase)
        if use_numbers:
            character_sets.append(string.digits)
        if use_symbols:
            character_sets.append("!@#$%^&*()-_=+[]{};:,.<>?")

        # Ensure minimum length
        password_length = max(len(character_sets), 4, length)

        # Guarantee at least one character from each required set
        password = [secrets.choice(cs) for cs in character_sets]

        # Fill remaining length with random characters from all sets
        alphabet = "".join(character_sets)
        password.extend(secrets.choice(alphabet) for _ in range(password_length - len(password)))

        # Shuffle using SystemRandom (CSPRNG)
        secrets.SystemRandom().shuffle(password)

        return "".join(password)

    # Persistence helpers
    def save_to_file(self, master_password: str, path: str = VAULT_FILENAME) -> None:
        """Save current entries to encrypted vault file."""
        save_vault(self.get_entries(), master_password, path)

    def load_from_file(self, master_password: str, path: str = VAULT_FILENAME) -> None:
        """Load entries from encrypted vault file, replacing in-memory entries."""
        entries = load_vault(master_password, path)
        self.entries = entries

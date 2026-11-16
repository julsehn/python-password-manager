import json
import unittest

from src.encryption import derive_key
from src.storage import deserialize_vault, serialize_vault


class VaultKeyDerivationTests(unittest.TestCase):
    def test_argon2id_vault_round_trip(self):
        password = "test-master-password"
        blob = serialize_vault([], password)

        self.assertNotIn("kdf", json.loads(blob))
        self.assertEqual(deserialize_vault(blob, password, "argon2id-test"), [])

    def test_argon2id_matches_rust_parameters(self):
        key, _ = derive_key("shared-test-password", bytes(range(16)))

        self.assertEqual(
            key.hex(),
            "24f35b029273a54b22a71e1aba8fb6d92d7eb469d00ed3eae30d735f0b0a5017",
        )


if __name__ == "__main__":
    unittest.main()

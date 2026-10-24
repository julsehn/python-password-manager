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
            "6685b845ce381b544d2390e669f56bed913e879a0f645d6533872e5b6c24b9c0",
        )


if __name__ == "__main__":
    unittest.main()
import base64
import json
import unittest

from src.encryption import derive_key, derive_legacy_pbkdf2_key, encrypt
from src.storage import deserialize_vault, serialize_vault


class VaultKeyDerivationTests(unittest.TestCase):
    def test_argon2id_vault_round_trip(self):
        password = "test-master-password"
        blob = serialize_vault([], password)

        self.assertEqual(json.loads(blob)["kdf"], "argon2id")
        self.assertEqual(deserialize_vault(blob, password, "argon2id-test"), [])

    def test_legacy_untagged_pbkdf2_vault_remains_readable(self):
        password = "test-master-password"
        salt = b"legacy-salt-1234"
        key = derive_legacy_pbkdf2_key(password, salt)
        nonce, ciphertext = encrypt(b'{"entries": []}', key)
        blob = json.dumps({
            "salt": base64.b64encode(salt).decode("ascii"),
            "nonce": base64.b64encode(nonce).decode("ascii"),
            "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
            "version": "1",
        })

        self.assertEqual(deserialize_vault(blob, password, "legacy-pbkdf2-test"), [])

    def test_argon2id_matches_rust_parameters(self):
        key, _ = derive_key("shared-test-password", bytes(range(16)))

        self.assertEqual(
            key.hex(),
            "6685b845ce381b544d2390e669f56bed913e879a0f645d6533872e5b6c24b9c0",
        )


if __name__ == "__main__":
    unittest.main()
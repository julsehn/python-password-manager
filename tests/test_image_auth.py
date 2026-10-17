import unittest

from src.storage import verify_image_auth_pattern


SALT_HEX = "ab" * 32
SAVED_PATTERN = [
    {"x_pct": 10.0, "y_pct": 10.0},
    {"x_pct": 50.0, "y_pct": 50.0},
    {"x_pct": 90.0, "y_pct": 90.0},
]


class VerifyImageAuthPatternTests(unittest.TestCase):
    def test_accepts_same_order_with_small_coordinate_variation(self):
        replay = [
            {"x_pct": 12.0, "y_pct": 11.0},
            {"x_pct": 49.0, "y_pct": 52.0},
            {"x_pct": 89.0, "y_pct": 92.0},
        ]

        self.assertTrue(verify_image_auth_pattern(replay, SAVED_PATTERN, SALT_HEX))

    def test_rejects_points_replayed_in_a_different_order(self):
        replay = [SAVED_PATTERN[2], SAVED_PATTERN[1], SAVED_PATTERN[0]]

        self.assertFalse(verify_image_auth_pattern(replay, SAVED_PATTERN, SALT_HEX))

    def test_rejects_a_different_number_of_points(self):
        replay = [*SAVED_PATTERN, {"x_pct": 30.0, "y_pct": 30.0}]

        self.assertFalse(verify_image_auth_pattern(replay, SAVED_PATTERN, SALT_HEX))

    def test_rejects_non_finite_coordinates(self):
        replay = [*SAVED_PATTERN[:-1], {"x_pct": float("nan"), "y_pct": 90.0}]

        self.assertFalse(verify_image_auth_pattern(replay, SAVED_PATTERN, SALT_HEX))

    def test_rejects_extreme_integer_coordinates(self):
        replay = [*SAVED_PATTERN[:-1], {"x_pct": 10**1000, "y_pct": 90.0}]

        self.assertFalse(verify_image_auth_pattern(replay, SAVED_PATTERN, SALT_HEX))

    def test_rejects_malformed_points_without_raising(self):
        self.assertFalse(verify_image_auth_pattern([None], SAVED_PATTERN[:1], SALT_HEX))
        self.assertFalse(verify_image_auth_pattern([{}], [{}], SALT_HEX))


if __name__ == "__main__":
    unittest.main()
import unittest

from telegram_mvp.summary import format_summary


class SummaryFormattingTests(unittest.TestCase):
    def test_empty_summary_message(self):
        self.assertIn("не найдено", format_summary([]).lower())


if __name__ == "__main__":
    unittest.main()

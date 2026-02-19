import tempfile
import unittest

from telegram_mvp.db import MessageRecord, MessageStore


class MessageStoreTests(unittest.TestCase):
    def test_insert_messages_returns_only_new_rows(self):
        with tempfile.NamedTemporaryFile() as tmp:
            store = MessageStore(tmp.name)
            msg = MessageRecord(
                chat_id=1,
                message_id=10,
                date_iso="2026-01-01T00:00:00+00:00",
                text="hello",
                sender_id=2,
                permalink="https://t.me/test/10",
            )

            self.assertEqual(store.insert_messages([msg]), 1)
            self.assertEqual(store.insert_messages([msg]), 0)
            store.close()


if __name__ == "__main__":
    unittest.main()

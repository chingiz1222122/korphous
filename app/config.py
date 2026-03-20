from __future__ import annotations

from dataclasses import dataclass
import os


@dataclass(slots=True)
class Settings:
    telegram_token: str
    openai_api_key: str
    recruiter_chat_id: int
    openai_model: str = "gpt-4.1-mini"
    database_path: str = "./data/candidates.db"
    google_sheet_name: str = "WB Candidates"
    google_service_account_json: str = "./credentials/google_service_account.json"
    min_answer_length: int = 15
    min_case_answer_length: int = 40
    webhook_base_url: str | None = None
    webhook_secret: str | None = None
    app_port: int = 8080



def _require(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value



def load_settings() -> Settings:
    recruiter_chat = _require("RECRUITER_CHAT_ID")
    return Settings(
        telegram_token=_require("TELEGRAM_BOT_TOKEN"),
        openai_api_key=_require("OPENAI_API_KEY"),
        recruiter_chat_id=int(recruiter_chat),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        database_path=os.getenv("DATABASE_PATH", "./data/candidates.db"),
        google_sheet_name=os.getenv("GOOGLE_SHEET_NAME", "WB Candidates"),
        google_service_account_json=os.getenv(
            "GOOGLE_SERVICE_ACCOUNT_JSON", "./credentials/google_service_account.json"
        ),
        min_answer_length=int(os.getenv("MIN_ANSWER_LENGTH", "15")),
        min_case_answer_length=int(os.getenv("MIN_CASE_ANSWER_LENGTH", "40")),
        webhook_base_url=os.getenv("WEBHOOK_BASE_URL"),
        webhook_secret=os.getenv("WEBHOOK_SECRET"),
        app_port=int(os.getenv("APP_PORT", "8080")),
    )

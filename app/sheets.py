from __future__ import annotations

import logging
from typing import Any

import gspread
from gspread.utils import rowcol_to_a1


logger = logging.getLogger(__name__)

HEADERS = [
    "Имя",
    "Город",
    "Опыт",
    "Категории",
    "Оборот",
    "SKU",
    "Зарплата",
    "Score",
    "Вердикт",
    "Summary",
]


class SheetsWriter:
    def __init__(self, service_account_json: str, sheet_name: str) -> None:
        self.gc = gspread.service_account(filename=service_account_json)
        self.sheet = self.gc.open(sheet_name).sheet1
        self._ensure_headers()

    def _ensure_headers(self) -> None:
        first_row = self.sheet.row_values(1)
        if first_row != HEADERS:
            self.sheet.update("A1:J1", [HEADERS])

    def append_candidate(self, candidate: dict[str, Any]) -> None:
        row = [
            candidate.get("full_name") or "",
            candidate.get("city_timezone") or "",
            candidate.get("wb_experience") or "",
            candidate.get("categories") or "",
            candidate.get("max_turnover") or "",
            candidate.get("sku_count") or "",
            candidate.get("salary_expectation") or "",
            candidate.get("score") or "",
            candidate.get("verdict") or "",
            candidate.get("summary") or "",
        ]
        self.sheet.append_row(row, value_input_option="USER_ENTERED")
        self._color_last_score(candidate.get("score"))

    def _color_last_score(self, score: Any) -> None:
        try:
            numeric_score = int(score)
        except (TypeError, ValueError):
            return

        last_row = len(self.sheet.get_all_values())
        cell_range = f"H{last_row}:J{last_row}"

        if numeric_score >= 70:
            rgb = {"red": 0.84, "green": 0.95, "blue": 0.84}
        elif numeric_score >= 50:
            rgb = {"red": 0.99, "green": 0.94, "blue": 0.75}
        else:
            rgb = {"red": 0.97, "green": 0.82, "blue": 0.82}

        ws_id = self.sheet.id
        start_col = 7
        end_col = 10
        start_row = last_row - 1
        end_row = last_row

        body = {
            "requests": [
                {
                    "repeatCell": {
                        "range": {
                            "sheetId": ws_id,
                            "startRowIndex": start_row,
                            "endRowIndex": end_row,
                            "startColumnIndex": start_col,
                            "endColumnIndex": end_col,
                        },
                        "cell": {"userEnteredFormat": {"backgroundColor": rgb}},
                        "fields": "userEnteredFormat.backgroundColor",
                    }
                }
            ]
        }
        self.sheet.spreadsheet.batch_update(body)
        logger.debug("Applied color formatting to range %s (%s)", cell_range, rowcol_to_a1(last_row, 8))

from __future__ import annotations

from app.models import Question


QUESTION_ORDER = [
    "full_name",
    "city_timezone",
    "wb_experience",
    "categories",
    "max_turnover",
    "sku_count",
    "hands_on_tasks",
    "quantified_results",
    "tools",
    "salary_expectation",
    "schedule_confirmation",
    "case_sales_drop",
    "case_low_conversion",
]



def build_questions(min_answer_length: int, min_case_answer_length: int) -> dict[str, Question]:
    return {
        "full_name": Question(
            key="full_name",
            text="Давайте начнём. Как вас зовут (имя и фамилия)?",
            min_length=max(5, min_answer_length // 2),
            hint="Напишите полное имя, чтобы мы корректно оформили карточку кандидата.",
        ),
        "city_timezone": Question(
            key="city_timezone",
            text="Из какого вы города и какой у вас часовой пояс относительно Москвы?",
            min_length=min_answer_length,
            hint="Например: Екатеринбург, +2 часа к МСК.",
        ),
        "wb_experience": Question(
            key="wb_experience",
            text="Опишите ваш опыт работы с Wildberries: сколько лет/месяцев и в каком формате работали?",
            min_length=min_answer_length,
            hint="Укажите период, роль и тип проектов (агентство, in-house, фриланс).",
        ),
        "categories": Question(
            key="categories",
            text="С какими категориями товаров на WB вы работали?",
            min_length=min_answer_length,
            hint="Приведите 2–5 категорий и пару примеров SKU.",
        ),
        "max_turnover": Question(
            key="max_turnover",
            text="Какой максимальный оборот (в месяц) вы вели лично?",
            min_length=min_answer_length,
            hint="Укажите диапазон или конкретную сумму в ₽ и период.",
        ),
        "sku_count": Question(
            key="sku_count",
            text="Сколько SKU было в вашем управлении одновременно?",
            min_length=min_answer_length,
            hint="Добавьте детализацию по активным/спящим SKU, если возможно.",
        ),
        "hands_on_tasks": Question(
            key="hands_on_tasks",
            text="Что вы делали руками ежедневно/еженедельно (контент, реклама, цены, поставки, аналитика)?",
            min_length=min_answer_length,
            hint="Важно понять, где вы реально работали сами, а не только управляли командой.",
        ),
        "quantified_results": Question(
            key="quantified_results",
            text="Каких результатов в цифрах вы достигали?",
            min_length=min_answer_length,
            hint="Пример: рост выручки, ROMI, DRR, конверсия, оборачиваемость, сроки в конкретных цифрах.",
        ),
        "tools": Question(
            key="tools",
            text="Какими инструментами пользуетесь: MPStats, Moneyplace, WB аналитика, Excel/Sheets, BI и т.д.?",
            min_length=min_answer_length,
            hint="Напишите, какие задачи решаете каждым инструментом.",
        ),
        "salary_expectation": Question(
            key="salary_expectation",
            text="Какие ожидания по зарплате (фикс/бонус), и на каких KPI готовы завязываться?",
            min_length=min_answer_length,
            hint="Укажите вилку в ₽ и условия, при которых она оправдана.",
        ),
        "schedule_confirmation": Question(
            key="schedule_confirmation",
            text="Подтвердите график: готовы работать в нашем режиме и быть на связи в рабочие часы?",
            min_length=min_answer_length,
            hint="Нужен чёткий ответ: да/нет + ограничения по времени.",
        ),
        "case_sales_drop": Question(
            key="case_sales_drop",
            text=(
                "Кейс 1: продажи упали на 25% за 2 недели по ключевому товару. "
                "Опишите пошаговый план диагностики и действий на первые 7 дней."
            ),
            min_length=min_case_answer_length,
            hint="Нужны конкретные метрики, гипотезы, приоритеты и ожидаемый эффект.",
            is_case=True,
        ),
        "case_low_conversion": Question(
            key="case_low_conversion",
            text=(
                "Кейс 2: у карточки высокие показы, но низкая конверсия в заказ. "
                "Что проверяете и как улучшаете ситуацию?"
            ),
            min_length=min_case_answer_length,
            hint="Опишите воронку: CTR, конверсия в корзину/заказ, контент, цена, отзывы, наличие.",
            is_case=True,
        ),
    }

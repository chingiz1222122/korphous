# WB Replenishment System

Production-grade система управления поставками для Wildberries.

## Быстрый старт

### 1. Создайте Google Spreadsheet
Создайте новую таблицу Google Sheets.

### 2. Откройте Apps Script
`Extensions → Apps Script`

### 3. Создайте файлы
Создайте следующие файлы в редакторе Apps Script и скопируйте код из `src/`:

| Файл | Назначение |
|------|-----------|
| `Config.gs` | Конфигурация, API endpoints, константы |
| `WbApi.gs` | Клиент WB API с retry и rate limiting |
| `DataWriter.gs` | Запись данных в листы, дедупликация |
| `FactsBuilder.gs` | Расчет метрик: скорость продаж, выкуп, возвраты |
| `ForecastEngine.gs` | Прогнозирование спроса, сезонность, ускорение |
| `SimulationEngine.gs` | Посуточная модель остатков |
| `PurchaseRecommendations.gs` | Рекомендации закупок, приоритеты |
| `DashboardBuilder.gs` | Управленческий дашборд |
| `SetupAndOps.gs` | Установка, триггеры, оркестрация |

### 4. Настройте API токен
`File → Project Settings → Script Properties`
Добавьте: `WB_API_TOKEN` = ваш токен статистики WB

### 5. Запустите установку
Выполните функцию `setupSystem()` — она создаст все листы и заполнит настройки по умолчанию.

### 6. Заполните MASTER
На листе `MASTER` добавьте ваши SKU с себестоимостью и MOQ.

### 7. Запустите пайплайн
- `runDailySync()` — загрузить данные из WB
- `runForecastAndSimulation()` — рассчитать прогноз
- `runFullPipeline()` — оба шага сразу

### 8. Автоматизация
`installTriggers()` — ежедневная автоматическая работа.

## Архитектура

```
WB API → RAW sheets → FACTS → FORECAST → SIMULATION → PURCHASE → DASHBOARD
```

Подробнее: [ARCHITECTURE.md](ARCHITECTURE.md)

## Листы

| Лист | Описание |
|------|---------|
| MASTER | Каталог SKU |
| SETTINGS | Параметры системы (lead time, target turnover, сезонность) |
| RAW_Stocks | Остатки WB (обновляются ежедневно) |
| RAW_Sales | Продажи (с дедупликацией) |
| RAW_Orders | Заказы |
| RAW_Returns | Возвраты |
| RAW_Inbound | Входящие поставки (из Китая) |
| FACTS | Агрегированные метрики по SKU |
| FORECAST | Прогноз спроса |
| SIMULATION | Посуточная модель остатков (60 дней) |
| PURCHASE | Рекомендации закупок |
| DASHBOARD | Управленческий дашборд |
| LOG | Системные логи |

## Алгоритмы

### Скорость продаж
Средневзвешенная: `0.35 × v3d + 0.30 × v7d + 0.20 × v12d + 0.15 × v30d`

### Количество закупки
```
orderQty = velocity × (leadTime + targetTurnover + safetyDays) - stock - inbound
orderQty = ceil(orderQty / MOQ) × MOQ
```

### Защита от ускорения
Если `v3d / v7d > 1.3` → ускорение, прогноз ограничен `v7d × 1.5`

### Приоритеты
- **CRITICAL**: запас ≤ 7 дней или OOS в пределах lead time
- **HIGH**: запас ≤ 14 дней
- **MEDIUM**: запас ≤ 21 день
- **OK**: запас достаточен
- **OVERSTOCK**: запас > 2× target turnover

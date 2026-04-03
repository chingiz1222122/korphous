/**
 * ============================================================
 * Warehouse KPI Dashboard — Configuration
 * ============================================================
 * Central configuration for sheet names, columns, formatting,
 * and business rules. Change values here instead of in code.
 */

// ── Sheet Names ──────────────────────────────────────────────
var CONFIG = {
  SHEETS: {
    QUEUE:     'Очередь',
    KPI_MONTH: 'KPI Месяц',
    TRIPS:     'Рейсы WB',
    DASHBOARD: 'Dashboard',
    ARCHIVE:   'Архив'
  },

  // ── Queue Column Layout (1-indexed) ────────────────────────
  QUEUE_COLS: {
    DATE_IN:      1,  // Дата поступления
    ARTICLE:      2,  // Артикул
    SKU:          3,  // SKU
    REASON:       4,  // Причина
    QTY:          5,  // Количество
    UNIT_COST:    6,  // Себестоимость за ед.
    TOTAL_COST:   7,  // Сумма себестоимости
    STATUS:       8,  // Статус
    READY_DATE:   9,  // Дата готовности
    SHIP_DATE:   10,  // Дата отправки
    EXECUTOR:    11,  // Исполнитель
    URGENCY:     12,  // Срочность
    CLIENT_CASE: 13,  // Кейс клиента
    AGE_DAYS:    14,  // Возраст в днях
    SLA_STATUS:  15   // SLA статус
  },

  QUEUE_HEADERS: [
    'Дата поступления', 'Артикул', 'SKU', 'Причина', 'Количество',
    'Себестоимость за ед.', 'Сумма себестоимости', 'Статус',
    'Дата готовности', 'Дата отправки', 'Исполнитель', 'Срочность',
    'Кейс клиента', 'Возраст в днях', 'SLA статус'
  ],

  // ── Trips Column Layout ────────────────────────────────────
  TRIPS_HEADERS: [
    'Дата', 'Номер рейса', 'Количество SKU', 'Количество единиц',
    'Сумма себестоимости', 'Стоимость рейса', 'Исполнитель', 'Комментарий'
  ],

  // ── Drop-down Values ───────────────────────────────────────
  STATUSES: [
    'В очереди', 'В работе', 'Готов к продаже',
    'Отправлено на WB', 'Невосстановимый'
  ],

  URGENCY: ['SLA 24h', 'SLA 5d'],

  REASONS: [
    'Смятая коробка', 'Не хватает комплектующей',
    'Возврат клиента', 'Донор комплектующей', 'Следы использования'
  ],

  // ── SLA Targets (days) ─────────────────────────────────────
  SLA: {
    '24H': 1,
    '5D':  5,
    YELLOW_BUFFER: 3   // days over target before RED
  },

  // ── Bonus Rules ────────────────────────────────────────────
  BONUS: {
    UNFREEZE_PCT:      0.02,    // 2% of unfrozen cost
    CLIENT_SLA_BONUS:  10000,   // if SLA > 90%
    CLIENT_SLA_THRESH: 0.90,
    TRIP_BONUS:        10000,   // per trip above threshold
    TRIP_THRESHOLD:    2,
    BASE_TRIPS:        2
  },

  // ── Vehicle Repair Vesting ─────────────────────────────────
  VEHICLE: {
    TOTAL:          150000,
    MONTHLY_VESTING: 15000
  },

  // ── Colors ─────────────────────────────────────────────────
  COLORS: {
    HEADER_BG:     '#1a237e',
    HEADER_FG:     '#ffffff',
    GREEN:         '#c8e6c9',
    YELLOW:        '#fff9c4',
    RED:           '#ffcdd2',
    LIGHT_BLUE:    '#e3f2fd',
    DARK_GREEN:    '#2e7d32',
    DARK_RED:      '#c62828',
    DARK_YELLOW:   '#f9a825',
    CARD_BG:       '#f5f5f5',
    CARD_BORDER:   '#bdbdbd',
    KPI_HEADER_BG: '#0d47a1',
    KPI_HEADER_FG: '#ffffff',
    ACCENT_BLUE:   '#1565c0',
    ACCENT_GREEN:  '#1b5e20',
    ACCENT_RED:    '#b71c1c'
  },

  // ── Formatting ─────────────────────────────────────────────
  FORMATS: {
    CURRENCY: '#,##0 ₽',
    PERCENT:  '0.0%',
    DATE:     'dd.MM.yyyy',
    NUMBER:   '#,##0'
  }
};

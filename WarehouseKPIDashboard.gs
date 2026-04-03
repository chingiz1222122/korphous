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
/**
 * ============================================================
 * Warehouse KPI Dashboard — Sheet Builder
 * ============================================================
 * Creates and configures individual sheets with headers,
 * data validation, formulas, and formatting.
 */

/**
 * Get or create a sheet by name, clearing existing content.
 * @param {Spreadsheet} ss
 * @param {string} name
 * @return {Sheet}
 */
function getOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  } else {
    sheet.clear();
    sheet.clearConditionalFormatRules();
  }
  return sheet;
}

/**
 * Apply standard header formatting to row 1.
 * @param {Sheet} sheet
 * @param {number} numCols
 */
function formatHeader_(sheet, numCols) {
  var headerRange = sheet.getRange(1, 1, 1, numCols);
  headerRange
    .setBackground(CONFIG.COLORS.HEADER_BG)
    .setFontColor(CONFIG.COLORS.HEADER_FG)
    .setFontWeight('bold')
    .setFontSize(10)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 40);
}

/**
 * Add data validation drop-downs.
 * @param {Sheet} sheet
 * @param {number} col        – 1-indexed column
 * @param {string[]} values   – allowed values
 * @param {number} [numRows]  – rows to apply (default 1000)
 */
function addDropdown_(sheet, col, values, numRows) {
  numRows = numRows || 1000;
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, col, numRows, 1).setDataValidation(rule);
}

// ═══════════════════════════════════════════════════════════════
// QUEUE SHEET
// ═══════════════════════════════════════════════════════════════

function buildQueueSheet_(ss) {
  var sheet = getOrCreateSheet_(ss, CONFIG.SHEETS.QUEUE);
  var headers = CONFIG.QUEUE_HEADERS;
  var C = CONFIG.QUEUE_COLS;

  // — Headers —
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  formatHeader_(sheet, headers.length);

  // — Data Validation —
  addDropdown_(sheet, C.STATUS,      CONFIG.STATUSES);
  addDropdown_(sheet, C.REASON,      CONFIG.REASONS);
  addDropdown_(sheet, C.URGENCY,     CONFIG.URGENCY);
  addDropdown_(sheet, C.CLIENT_CASE, ['Да', 'Нет']);

  // — Date columns formatting —
  [C.DATE_IN, C.READY_DATE, C.SHIP_DATE].forEach(function(col) {
    sheet.getRange(2, col, 1000, 1).setNumberFormat(CONFIG.FORMATS.DATE);
  });

  // — Currency columns —
  [C.UNIT_COST, C.TOTAL_COST].forEach(function(col) {
    sheet.getRange(2, col, 1000, 1).setNumberFormat(CONFIG.FORMATS.CURRENCY);
  });

  // — Array Formulas (row 2, extend automatically) —
  // Сумма себестоимости = Количество * Себестоимость за ед.
  sheet.getRange(2, C.TOTAL_COST).setFormula(
    '=ARRAYFORMULA(IF(E2:E<>"", E2:E * F2:F, ""))'
  );

  // Возраст в днях = TODAY() - Дата поступления
  sheet.getRange(2, C.AGE_DAYS).setFormula(
    '=ARRAYFORMULA(IF(A2:A<>"", TODAY() - A2:A, ""))'
  );

  // SLA статус
  // Logic: compare age vs SLA target; green/yellow/red
  var slaFormula =
    '=ARRAYFORMULA(IF(A2:A="","",IF(L2:L=""," ",' +
    'IF(L2:L="SLA 24h",' +
      'IF(N2:N<=1,"✅ В норме",IF(N2:N<=1+' + CONFIG.SLA.YELLOW_BUFFER + ',"⚠️ Близко к сроку","🔴 Просрочено")),' +
      'IF(N2:N<=5,"✅ В норме",IF(N2:N<=5+' + CONFIG.SLA.YELLOW_BUFFER + ',"⚠️ Близко к сроку","🔴 Просрочено"))' +
    '))))';
  sheet.getRange(2, C.SLA_STATUS).setFormula(slaFormula);

  // — Conditional Formatting —
  applyQueueConditionalFormatting_(sheet);

  // — Filter —
  var dataRange = sheet.getRange(1, 1, sheet.getMaxRows(), headers.length);
  if (!sheet.getFilter()) {
    dataRange.createFilter();
  }

  // — Column widths —
  var widths = [110, 100, 100, 160, 80, 130, 140, 120, 110, 110, 100, 80, 90, 90, 130];
  widths.forEach(function(w, i) {
    sheet.setColumnWidth(i + 1, w);
  });

  return sheet;
}

function applyQueueConditionalFormatting_(sheet) {
  var rules = [];
  var lastRow = 1000;
  var numCols = CONFIG.QUEUE_HEADERS.length;
  var range = sheet.getRange(2, 1, lastRow, numCols);

  // Green: Готов к продаже or Отправлено на WB
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=OR($H2="Готов к продаже", $H2="Отправлено на WB")')
    .setBackground(CONFIG.COLORS.GREEN)
    .setRanges([range])
    .build());

  // Red: Age > 21 days
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($A2<>"", $N2>21)')
    .setBackground(CONFIG.COLORS.RED)
    .setRanges([range])
    .build());

  // Yellow: Age 8-21 days
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($A2<>"", $N2>=8, $N2<=21)')
    .setBackground(CONFIG.COLORS.YELLOW)
    .setRanges([range])
    .build());

  // Urgent client cases: bold blue border-style via background highlight
  var clientRange = sheet.getRange(2, 1, lastRow, numCols);
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($M2="Да", $L2="SLA 24h")')
    .setBackground('#bbdefb')
    .setFontColor(CONFIG.COLORS.ACCENT_BLUE)
    .setBold(true)
    .setRanges([clientRange])
    .build());

  sheet.setConditionalFormatRules(rules);
}

// ═══════════════════════════════════════════════════════════════
// KPI MONTH SHEET
// ═══════════════════════════════════════════════════════════════

function buildKPIMonthSheet_(ss) {
  var sheet = getOrCreateSheet_(ss, CONFIG.SHEETS.KPI_MONTH);
  var Q = CONFIG.SHEETS.QUEUE;

  // ── Layout: label in col A, value/formula in col B ──
  var rows = [
    ['KPI Показатели за месяц', ''],
    ['', ''],
    ['Заморожено на начало месяца (₽)', ''],
    ['Разморожено за месяц (₽)', ''],
    ['Остаток замороженного капитала (₽)', ''],
    ['% разморозки', ''],
    ['', ''],
    ['SLA Показатели', ''],
    ['Всего кейсов SLA 24h', ''],
    ['Выполнено в срок SLA 24h', ''],
    ['% выполнения SLA 24h', ''],
    ['Всего кейсов SLA 5d', ''],
    ['Выполнено в срок SLA 5d', ''],
    ['% выполнения SLA 5d', ''],
    ['', ''],
    ['Клиентские кейсы', ''],
    ['Всего клиентских кейсов', ''],
    ['Решено в срок', ''],
    ['% SLA клиентских кейсов', ''],
    ['', ''],
    ['Рейсы и логистика', ''],
    ['Количество рейсов за месяц', ''],
    ['', ''],
    ['Бонус сотрудника', ''],
    ['Бонус за разморозку (2%)', ''],
    ['Бонус за SLA клиентов', ''],
    ['Бонус за рейсы', ''],
    ['Итого бонус', ''],
    ['', ''],
    ['KPI выполнен', '']
  ];

  sheet.getRange(1, 1, rows.length, 2).setValues(rows);

  // ── Formulas ──
  // Frozen at start of month: sum cost where status is В очереди or В работе + completed this month
  // For simplicity: total cost of all items in queue
  var frozenFormula = '=SUMPRODUCT((' +
    "'" + Q + "'!H2:H<>\"Готов к продаже\")*(" +
    "'" + Q + "'!H2:H<>\"Отправлено на WB\")*(" +
    "'" + Q + "'!H2:H<>\"Невосстановимый\")*(" +
    "'" + Q + "'!H2:H<>\"\")*" +
    "'" + Q + "'!G2:G)" +
    '+SUMPRODUCT((' +
    "'" + Q + "'!H2:H=\"Готов к продаже\")*'" + Q + "'!G2:G)" +
    '+SUMPRODUCT((' +
    "'" + Q + "'!H2:H=\"Отправлено на WB\")*'" + Q + "'!G2:G)";
  sheet.getRange(3, 2).setFormula(frozenFormula);

  // Unfrozen this month: items moved to Готов к продаже or Отправлено
  var unfrozenFormula = '=SUMPRODUCT((' +
    "'" + Q + "'!H2:H=\"Готов к продаже\")*'" + Q + "'!G2:G)" +
    '+SUMPRODUCT((' +
    "'" + Q + "'!H2:H=\"Отправлено на WB\")*'" + Q + "'!G2:G)";
  sheet.getRange(4, 2).setFormula(unfrozenFormula);

  // Remaining frozen
  sheet.getRange(5, 2).setFormula('=B3-B4');

  // % unfrozen
  sheet.getRange(6, 2).setFormula('=IF(B3>0, B4/B3, 0)');

  // SLA 24h totals
  sheet.getRange(9, 2).setFormula(
    "=COUNTIF('" + Q + "'!L2:L, \"SLA 24h\")"
  );
  // SLA 24h met (age <= 1 at ready date or status done and age was <=1)
  sheet.getRange(10, 2).setFormula(
    "=COUNTIFS('" + Q + "'!L2:L, \"SLA 24h\", '" + Q + "'!O2:O, \"✅ В норме\")"
  );
  sheet.getRange(11, 2).setFormula('=IF(B9>0, B10/B9, 0)');

  // SLA 5d totals
  sheet.getRange(12, 2).setFormula(
    "=COUNTIF('" + Q + "'!L2:L, \"SLA 5d\")"
  );
  sheet.getRange(13, 2).setFormula(
    "=COUNTIFS('" + Q + "'!L2:L, \"SLA 5d\", '" + Q + "'!O2:O, \"✅ В норме\")"
  );
  sheet.getRange(14, 2).setFormula('=IF(B12>0, B13/B12, 0)');

  // Client cases
  sheet.getRange(17, 2).setFormula(
    "=COUNTIF('" + Q + "'!M2:M, \"Да\")"
  );
  sheet.getRange(18, 2).setFormula(
    "=COUNTIFS('" + Q + "'!M2:M, \"Да\", '" + Q + "'!O2:O, \"✅ В норме\")"
  );
  sheet.getRange(19, 2).setFormula('=IF(B17>0, B18/B17, 0)');

  // Trips
  var T = CONFIG.SHEETS.TRIPS;
  sheet.getRange(22, 2).setFormula(
    "=COUNTA('" + T + "'!A2:A)"
  );

  // Bonus calculations
  sheet.getRange(25, 2).setFormula('=B4*' + CONFIG.BONUS.UNFREEZE_PCT);
  sheet.getRange(26, 2).setFormula(
    '=IF(B19>=' + CONFIG.BONUS.CLIENT_SLA_THRESH + ', ' + CONFIG.BONUS.CLIENT_SLA_BONUS + ', 0)'
  );
  sheet.getRange(27, 2).setFormula(
    '=IF(B22>' + CONFIG.BONUS.TRIP_THRESHOLD + ', (B22-' + CONFIG.BONUS.BASE_TRIPS + ')*' + CONFIG.BONUS.TRIP_BONUS + ', 0)'
  );
  sheet.getRange(28, 2).setFormula('=B25+B26+B27');

  // KPI met
  sheet.getRange(30, 2).setFormula('=IF(AND(B6>=0.5, B19>=0.9), "✅ ДА", "❌ НЕТ")');

  // ── Formatting ──
  // Section headers
  var sectionRows = [1, 8, 16, 21, 24];
  sectionRows.forEach(function(r) {
    sheet.getRange(r, 1, 1, 2)
      .setBackground(CONFIG.COLORS.KPI_HEADER_BG)
      .setFontColor(CONFIG.COLORS.KPI_HEADER_FG)
      .setFontWeight('bold')
      .setFontSize(12);
  });

  // Currency format
  [3, 4, 5, 25, 26, 27, 28].forEach(function(r) {
    sheet.getRange(r, 2).setNumberFormat(CONFIG.FORMATS.CURRENCY);
  });

  // Percent format
  [6, 11, 14, 19].forEach(function(r) {
    sheet.getRange(r, 2).setNumberFormat(CONFIG.FORMATS.PERCENT);
  });

  // Labels bold
  sheet.getRange(1, 1, rows.length, 1).setFontWeight('bold');

  // Column widths
  sheet.setColumnWidth(1, 300);
  sheet.setColumnWidth(2, 200);

  sheet.setFrozenRows(0);

  return sheet;
}

// ═══════════════════════════════════════════════════════════════
// TRIPS SHEET
// ═══════════════════════════════════════════════════════════════

function buildTripsSheet_(ss) {
  var sheet = getOrCreateSheet_(ss, CONFIG.SHEETS.TRIPS);
  var headers = CONFIG.TRIPS_HEADERS;

  // — Headers —
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  formatHeader_(sheet, headers.length);

  // — Formatting —
  sheet.getRange(2, 1, 1000, 1).setNumberFormat(CONFIG.FORMATS.DATE);
  [5, 6].forEach(function(col) {
    sheet.getRange(2, col, 1000, 1).setNumberFormat(CONFIG.FORMATS.CURRENCY);
  });
  [3, 4].forEach(function(col) {
    sheet.getRange(2, col, 1000, 1).setNumberFormat(CONFIG.FORMATS.NUMBER);
  });

  // — KPI Summary Block (columns J-K) —
  var summaryStart = 1;
  var summaryCol = 10; // col J

  var summary = [
    ['Сводка по рейсам', ''],
    ['', ''],
    ['Рейсов за месяц', '=COUNTA(A2:A)'],
    ['Средняя загрузка (ед.)', '=IF(COUNTA(A2:A)>0, AVERAGE(D2:D), 0)'],
    ['Стоимость за рейс (средн.)', '=IF(COUNTA(A2:A)>0, AVERAGE(F2:F), 0)'],
    ['Себестоимость товара за рейс', '=IF(COUNTA(A2:A)>0, AVERAGE(E2:E), 0)'],
    ['Общая себестоимость', '=SUM(E2:E)'],
    ['Общая стоимость рейсов', '=SUM(F2:F)']
  ];

  sheet.getRange(summaryStart, summaryCol, summary.length, 2).setValues(summary);

  // Summary header format
  sheet.getRange(summaryStart, summaryCol, 1, 2)
    .setBackground(CONFIG.COLORS.KPI_HEADER_BG)
    .setFontColor(CONFIG.COLORS.KPI_HEADER_FG)
    .setFontWeight('bold')
    .setFontSize(11);

  sheet.getRange(summaryStart, summaryCol, summary.length, 1).setFontWeight('bold');

  // Currency in summary
  [5, 6, 7, 8].forEach(function(r) {
    sheet.getRange(summaryStart + r - 1, summaryCol + 1).setNumberFormat(CONFIG.FORMATS.CURRENCY);
  });

  // Column widths
  var widths = [110, 100, 110, 120, 140, 120, 100, 200];
  widths.forEach(function(w, i) {
    sheet.setColumnWidth(i + 1, w);
  });
  sheet.setColumnWidth(summaryCol, 230);
  sheet.setColumnWidth(summaryCol + 1, 180);

  // Filter
  var dataRange = sheet.getRange(1, 1, sheet.getMaxRows(), headers.length);
  if (!sheet.getFilter()) {
    dataRange.createFilter();
  }

  return sheet;
}
/**
 * ============================================================
 * Warehouse KPI Dashboard — Executive Dashboard Builder
 * ============================================================
 * Creates the owner-facing dashboard with KPI cards, charts,
 * and vehicle repair vesting tracker.
 */

function buildDashboard_(ss) {
  var sheet = getOrCreateSheet_(ss, CONFIG.SHEETS.DASHBOARD);
  var KPI = CONFIG.SHEETS.KPI_MONTH;
  var Q = CONFIG.SHEETS.QUEUE;
  var T = CONFIG.SHEETS.TRIPS;

  // Hide gridlines for clean look
  sheet.setHiddenGridlines(true);

  // ── Title Row ──
  sheet.getRange('A1:L1').merge()
    .setValue('📊 Warehouse KPI Dashboard')
    .setFontSize(22)
    .setFontWeight('bold')
    .setFontColor(CONFIG.COLORS.HEADER_BG)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 55);

  // Subtitle with date
  sheet.getRange('A2:L2').merge()
    .setFormula('="Обновлено: "&TEXT(NOW(),"dd.MM.yyyy HH:mm")')
    .setFontSize(10)
    .setFontColor('#757575')
    .setHorizontalAlignment('center');
  sheet.setRowHeight(2, 25);

  // ══════════════════════════════════════════════════════════
  // KPI CARDS — Row 4-7
  // ══════════════════════════════════════════════════════════

  var cardRow = 4;
  var cards = [
    {
      col: 'A', mergeEnd: 'B',
      label: 'Разморожено за месяц',
      formula: "='" + KPI + "'!B4",
      format: CONFIG.FORMATS.CURRENCY,
      color: CONFIG.COLORS.ACCENT_GREEN
    },
    {
      col: 'C', mergeEnd: 'D',
      label: 'Остаток зависшего капитала',
      formula: "='" + KPI + "'!B5",
      format: CONFIG.FORMATS.CURRENCY,
      color: CONFIG.COLORS.ACCENT_RED
    },
    {
      col: 'E', mergeEnd: 'F',
      label: '% разморозки',
      formula: "='" + KPI + "'!B6",
      format: CONFIG.FORMATS.PERCENT,
      color: CONFIG.COLORS.ACCENT_BLUE
    },
    {
      col: 'G', mergeEnd: 'H',
      label: 'SLA клиентских кейсов',
      formula: "='" + KPI + "'!B19",
      format: CONFIG.FORMATS.PERCENT,
      color: CONFIG.COLORS.ACCENT_BLUE
    },
    {
      col: 'I', mergeEnd: 'J',
      label: 'Рейсов за месяц',
      formula: "='" + KPI + "'!B22",
      format: '#,##0',
      color: CONFIG.COLORS.HEADER_BG
    },
    {
      col: 'K', mergeEnd: 'L',
      label: 'Бонус сотрудника',
      formula: "='" + KPI + "'!B28",
      format: CONFIG.FORMATS.CURRENCY,
      color: CONFIG.COLORS.ACCENT_GREEN
    }
  ];

  cards.forEach(function(card) {
    var labelRange = sheet.getRange(card.col + cardRow + ':' + card.mergeEnd + cardRow);
    var valueRange = sheet.getRange(card.col + (cardRow + 1) + ':' + card.mergeEnd + (cardRow + 2));

    // Label
    labelRange.merge()
      .setValue(card.label)
      .setFontSize(9)
      .setFontWeight('bold')
      .setFontColor('#ffffff')
      .setBackground(card.color)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    // Value
    valueRange.merge()
      .setFormula(card.formula)
      .setFontSize(20)
      .setFontWeight('bold')
      .setFontColor(card.color)
      .setBackground(CONFIG.COLORS.CARD_BG)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setNumberFormat(card.format)
      .setBorder(true, true, true, true, false, false,
                 CONFIG.COLORS.CARD_BORDER, SpreadsheetApp.BorderStyle.SOLID);
  });

  sheet.setRowHeight(cardRow, 30);
  sheet.setRowHeight(cardRow + 1, 25);
  sheet.setRowHeight(cardRow + 2, 35);

  // ══════════════════════════════════════════════════════════
  // VEHICLE REPAIR VESTING — Row 8-12
  // ══════════════════════════════════════════════════════════

  var vestRow = 9;
  sheet.getRange('A' + vestRow + ':D' + vestRow).merge()
    .setValue('🚗 Vehicle Repair Vesting')
    .setFontSize(14)
    .setFontWeight('bold')
    .setFontColor(CONFIG.COLORS.HEADER_BG)
    .setHorizontalAlignment('left');

  var vestData = [
    ['Общая сумма ремонта:', CONFIG.VEHICLE.TOTAL, 'Ежемесячный вестинг:', CONFIG.VEHICLE.MONTHLY_VESTING],
    ['Успешных KPI месяцев:', '', 'Накоплено (vested):', ''],
    ['Остаток до полной оплаты:', '', 'Прогресс:', '']
  ];

  sheet.getRange(vestRow + 1, 1, vestData.length, 4).setValues(vestData);

  // Vehicle vesting formulas
  // Successful KPI months (manual entry or calculated from archive)
  sheet.getRange(vestRow + 2, 2).setValue(0).setNote('Введите количество успешных KPI месяцев');

  // Vested amount
  sheet.getRange(vestRow + 2, 4).setFormula(
    '=MIN(' + CONFIG.VEHICLE.TOTAL + ', B' + (vestRow + 2) + '*' + CONFIG.VEHICLE.MONTHLY_VESTING + ')'
  ).setNumberFormat(CONFIG.FORMATS.CURRENCY);

  // Remaining
  sheet.getRange(vestRow + 3, 2).setFormula(
    '=' + CONFIG.VEHICLE.TOTAL + '-D' + (vestRow + 2)
  ).setNumberFormat(CONFIG.FORMATS.CURRENCY);

  // Progress %
  sheet.getRange(vestRow + 3, 4).setFormula(
    '=D' + (vestRow + 2) + '/' + CONFIG.VEHICLE.TOTAL
  ).setNumberFormat(CONFIG.FORMATS.PERCENT);

  // Format vesting section
  sheet.getRange(vestRow + 1, 1).setNumberFormat(CONFIG.FORMATS.CURRENCY);
  sheet.getRange(vestRow + 1, 2).setNumberFormat(CONFIG.FORMATS.CURRENCY);
  sheet.getRange(vestRow + 1, 4).setNumberFormat(CONFIG.FORMATS.CURRENCY);

  [vestRow + 1, vestRow + 2, vestRow + 3].forEach(function(r) {
    sheet.getRange(r, 1).setFontWeight('bold');
    sheet.getRange(r, 3).setFontWeight('bold');
  });

  // ══════════════════════════════════════════════════════════
  // QUEUE STATUS SUMMARY — Row 14-20
  // ══════════════════════════════════════════════════════════

  var qRow = 14;
  sheet.getRange('A' + qRow + ':D' + qRow).merge()
    .setValue('📦 Статус очереди')
    .setFontSize(14)
    .setFontWeight('bold')
    .setFontColor(CONFIG.COLORS.HEADER_BG);

  var statusSummary = [
    ['Статус', 'Количество', 'Сумма себестоимости', '% от общего'],
    ['В очереди', '', '', ''],
    ['В работе', '', '', ''],
    ['Готов к продаже', '', '', ''],
    ['Отправлено на WB', '', '', ''],
    ['Невосстановимый', '', '', ''],
    ['ИТОГО', '', '', '']
  ];

  sheet.getRange(qRow + 1, 1, statusSummary.length, 4).setValues(statusSummary);

  // Status summary header
  sheet.getRange(qRow + 1, 1, 1, 4)
    .setBackground(CONFIG.COLORS.HEADER_BG)
    .setFontColor(CONFIG.COLORS.HEADER_FG)
    .setFontWeight('bold');

  // Formulas for each status
  CONFIG.STATUSES.forEach(function(status, i) {
    var row = qRow + 2 + i;
    sheet.getRange(row, 2).setFormula(
      "=COUNTIF('" + Q + "'!H2:H, \"" + status + "\")"
    );
    sheet.getRange(row, 3).setFormula(
      "=SUMPRODUCT(('" + Q + "'!H2:H=\"" + status + "\")*'" + Q + "'!G2:G)"
    ).setNumberFormat(CONFIG.FORMATS.CURRENCY);
    sheet.getRange(row, 4).setFormula(
      '=IF(B' + (qRow + 8) + '>0, B' + row + '/B' + (qRow + 8) + ', 0)'
    ).setNumberFormat(CONFIG.FORMATS.PERCENT);
  });

  // Totals
  var totalRow = qRow + 7;
  sheet.getRange(totalRow, 2).setFormula("=COUNTA('" + Q + "'!H2:H)");
  sheet.getRange(totalRow, 3).setFormula("=SUM('" + Q + "'!G2:G)").setNumberFormat(CONFIG.FORMATS.CURRENCY);
  sheet.getRange(totalRow, 4).setValue(1).setNumberFormat(CONFIG.FORMATS.PERCENT);
  sheet.getRange(totalRow, 1, 1, 4).setFontWeight('bold').setBackground('#e0e0e0');

  // ══════════════════════════════════════════════════════════
  // COLUMN WIDTHS
  // ══════════════════════════════════════════════════════════

  for (var c = 1; c <= 12; c++) {
    sheet.setColumnWidth(c, 130);
  }

  return sheet;
}

// ══════════════════════════════════════════════════════════════
// CHARTS
// ══════════════════════════════════════════════════════════════

function buildCharts_(ss) {
  var dashboard = ss.getSheetByName(CONFIG.SHEETS.DASHBOARD);
  var queue = ss.getSheetByName(CONFIG.SHEETS.QUEUE);
  var trips = ss.getSheetByName(CONFIG.SHEETS.TRIPS);

  // Remove existing charts
  dashboard.getCharts().forEach(function(chart) {
    dashboard.removeChart(chart);
  });

  // ── Chart 1: Queue Status Distribution (Pie) ──
  // Build from dashboard's status summary
  var statusRange = dashboard.getRange('A16:B20'); // status names and counts
  var chart1 = dashboard.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(statusRange)
    .setPosition(23, 1, 0, 0)
    .setOption('title', 'Распределение по статусам')
    .setOption('titleTextStyle', { fontSize: 12, bold: true })
    .setOption('pieHole', 0.4)
    .setOption('width', 480)
    .setOption('height', 300)
    .setOption('legend', { position: 'right' })
    .setOption('colors', ['#ffca28', '#42a5f5', '#66bb6a', '#26a69a', '#ef5350'])
    .build();
  dashboard.insertChart(chart1);

  // ── Chart 2: Age Distribution (Bar) ──
  // We'll create a helper data block for age buckets
  var ageRow = 23;
  var ageCol = 7;
  var ageBuckets = [
    ['Возрастная группа', 'Количество'],
    ['0-3 дня', '=COUNTIFS(\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,">="&0,\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,"<="&3)'],
    ['4-7 дней', '=COUNTIFS(\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,">="&4,\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,"<="&7)'],
    ['8-14 дней', '=COUNTIFS(\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,">="&8,\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,"<="&14)'],
    ['15-21 день', '=COUNTIFS(\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,">="&15,\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,"<="&21)'],
    ['22+ дней', '=COUNTIFS(\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,">="&22)']
  ];

  dashboard.getRange(ageRow, ageCol, ageBuckets.length, 2).setValues(ageBuckets);
  dashboard.getRange(ageRow, ageCol, 1, 2)
    .setFontWeight('bold')
    .setFontSize(9);

  var ageRange = dashboard.getRange(ageRow, ageCol, ageBuckets.length, 2);
  var chart2 = dashboard.newChart()
    .setChartType(Charts.ChartType.BAR)
    .addRange(ageRange)
    .setPosition(23, 5, 0, 0)
    .setOption('title', 'Возраст товаров в очереди')
    .setOption('titleTextStyle', { fontSize: 12, bold: true })
    .setOption('width', 480)
    .setOption('height', 300)
    .setOption('legend', { position: 'none' })
    .setOption('colors', ['#1565c0'])
    .setOption('hAxis', { title: 'Количество' })
    .build();
  dashboard.insertChart(chart2);

  // ── Chart 3: SLA Compliance (Gauge-style bar) ──
  var slaRow = 30;
  var slaData = [
    ['Метрика', 'Значение'],
    ['SLA 24h %', "='" + CONFIG.SHEETS.KPI_MONTH + "'!B11"],
    ['SLA 5d %', "='" + CONFIG.SHEETS.KPI_MONTH + "'!B14"],
    ['SLA клиентов %', "='" + CONFIG.SHEETS.KPI_MONTH + "'!B19"]
  ];

  dashboard.getRange(slaRow, 1, slaData.length, 2).setValues(slaData);
  dashboard.getRange(slaRow, 1, 1, 2).setFontWeight('bold');
  dashboard.getRange(slaRow + 1, 2, 3, 1).setNumberFormat(CONFIG.FORMATS.PERCENT);

  var slaRange = dashboard.getRange(slaRow, 1, slaData.length, 2);
  var chart3 = dashboard.newChart()
    .setChartType(Charts.ChartType.BAR)
    .addRange(slaRange)
    .setPosition(30, 1, 0, 0)
    .setOption('title', 'SLA Compliance')
    .setOption('titleTextStyle', { fontSize: 12, bold: true })
    .setOption('width', 480)
    .setOption('height', 250)
    .setOption('legend', { position: 'none' })
    .setOption('colors', ['#2e7d32'])
    .setOption('hAxis', { minValue: 0, maxValue: 1, format: '#%' })
    .build();
  dashboard.insertChart(chart3);

  // ── Chart 4: Trips Summary (from Trips sheet) ──
  var tripsRange = trips.getRange('A1:D' + Math.max(2, trips.getLastRow()));
  var chart4 = dashboard.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(trips.getRange('A1:A' + Math.max(2, trips.getLastRow())))
    .addRange(trips.getRange('D1:D' + Math.max(2, trips.getLastRow())))
    .setPosition(30, 5, 0, 0)
    .setOption('title', 'Загрузка рейсов (единиц)')
    .setOption('titleTextStyle', { fontSize: 12, bold: true })
    .setOption('width', 480)
    .setOption('height', 250)
    .setOption('legend', { position: 'none' })
    .setOption('colors', ['#1a237e'])
    .build();
  dashboard.insertChart(chart4);
}
/**
 * ============================================================
 * Warehouse KPI Dashboard — Automation & Menu
 * ============================================================
 * Custom menu, refresh, archival, and vesting functions.
 */

/**
 * Add custom menu on spreadsheet open.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 KPI Dashboard')
    .addItem('🔄 Refresh Dashboard', 'refreshDashboard')
    .addItem('📈 Recalculate KPI', 'recalculateMonthlyKPI')
    .addItem('📸 Create New Month Snapshot', 'createMonthSnapshot')
    .addItem('📦 Archive Completed Queue', 'archiveCompletedQueue')
    .addItem('🚗 Update Vehicle Vesting', 'updateVehicleRepairVesting')
    .addSeparator()
    .addItem('🏗️ Rebuild All Sheets', 'createWarehouseKPIDashboard')
    .addToUi();
}

/**
 * Refresh the dashboard: recalculate formulas and rebuild charts.
 */
function refreshDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Force recalc by touching a volatile cell
  SpreadsheetApp.flush();

  // Rebuild charts (they depend on data ranges)
  buildCharts_(ss);

  // Update timestamp
  var dashboard = ss.getSheetByName(CONFIG.SHEETS.DASHBOARD);
  if (dashboard) {
    dashboard.getRange('A2:L2').merge()
      .setFormula('="Обновлено: "&TEXT(NOW(),"dd.MM.yyyy HH:mm")');
  }

  SpreadsheetApp.getUi().alert('✅ Dashboard обновлён!');
}

/**
 * Recalculate monthly KPI — rebuilds the KPI sheet formulas.
 */
function recalculateMonthlyKPI() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  buildKPIMonthSheet_(ss);
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('✅ KPI пересчитан!');
}

/**
 * Create a monthly snapshot: copies current KPI values to a new sheet.
 */
function createMonthSnapshot() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var kpi = ss.getSheetByName(CONFIG.SHEETS.KPI_MONTH);
  if (!kpi) {
    SpreadsheetApp.getUi().alert('❌ Лист KPI не найден.');
    return;
  }

  var now = new Date();
  var monthName = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM');
  var snapshotName = 'KPI_' + monthName;

  // Check if snapshot already exists
  if (ss.getSheetByName(snapshotName)) {
    var ui = SpreadsheetApp.getUi();
    var response = ui.alert(
      'Снимок ' + snapshotName + ' уже существует. Перезаписать?',
      ui.ButtonSet.YES_NO
    );
    if (response !== ui.Button.YES) return;
    ss.deleteSheet(ss.getSheetByName(snapshotName));
  }

  // Copy KPI sheet
  var snapshot = kpi.copyTo(ss).setName(snapshotName);

  // Convert formulas to values (freeze the snapshot)
  var data = snapshot.getDataRange();
  data.setValues(data.getValues());

  // Add metadata
  var lastRow = snapshot.getLastRow();
  snapshot.getRange(lastRow + 2, 1).setValue('Дата снимка:');
  snapshot.getRange(lastRow + 2, 2).setValue(now).setNumberFormat('dd.MM.yyyy HH:mm');

  SpreadsheetApp.getUi().alert('✅ Снимок создан: ' + snapshotName);
}

/**
 * Archive completed queue items (Отправлено на WB) to Archive sheet.
 */
function archiveCompletedQueue() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var queue = ss.getSheetByName(CONFIG.SHEETS.QUEUE);
  if (!queue) return;

  // Get or create archive sheet
  var archive = ss.getSheetByName(CONFIG.SHEETS.ARCHIVE);
  if (!archive) {
    archive = ss.insertSheet(CONFIG.SHEETS.ARCHIVE);
    archive.getRange(1, 1, 1, CONFIG.QUEUE_HEADERS.length)
      .setValues([CONFIG.QUEUE_HEADERS]);
    formatHeader_(archive, CONFIG.QUEUE_HEADERS.length);
  }

  // Find rows to archive
  var data = queue.getDataRange().getValues();
  var rowsToArchive = [];
  var rowIndicesToDelete = [];

  for (var i = 1; i < data.length; i++) {
    var status = data[i][CONFIG.QUEUE_COLS.STATUS - 1];
    if (status === 'Отправлено на WB' || status === 'Невосстановимый') {
      rowsToArchive.push(data[i]);
      rowIndicesToDelete.push(i + 1); // 1-indexed sheet rows
    }
  }

  if (rowsToArchive.length === 0) {
    SpreadsheetApp.getUi().alert('Нет записей для архивации.');
    return;
  }

  // Batch write to archive
  var archiveLastRow = Math.max(archive.getLastRow(), 1);
  archive.getRange(archiveLastRow + 1, 1, rowsToArchive.length, rowsToArchive[0].length)
    .setValues(rowsToArchive);

  // Delete from queue (bottom-up to preserve indices)
  rowIndicesToDelete.reverse().forEach(function(rowIdx) {
    queue.deleteRow(rowIdx);
  });

  // Re-apply array formulas if first data row was deleted
  ensureQueueFormulas_(queue);

  SpreadsheetApp.getUi().alert(
    '✅ Архивировано записей: ' + rowsToArchive.length
  );
}

/**
 * Ensure array formulas exist in the Queue sheet after row deletions.
 */
function ensureQueueFormulas_(queue) {
  var C = CONFIG.QUEUE_COLS;

  // Check if row 2 has formulas; if not, re-insert
  var totalCostCell = queue.getRange(2, C.TOTAL_COST);
  if (!totalCostCell.getFormula()) {
    totalCostCell.setFormula('=ARRAYFORMULA(IF(E2:E<>"", E2:E * F2:F, ""))');
  }

  var ageDaysCell = queue.getRange(2, C.AGE_DAYS);
  if (!ageDaysCell.getFormula()) {
    ageDaysCell.setFormula('=ARRAYFORMULA(IF(A2:A<>"", TODAY() - A2:A, ""))');
  }

  var slaCell = queue.getRange(2, C.SLA_STATUS);
  if (!slaCell.getFormula()) {
    var slaFormula =
      '=ARRAYFORMULA(IF(A2:A="","",IF(L2:L=""," ",' +
      'IF(L2:L="SLA 24h",' +
        'IF(N2:N<=1,"✅ В норме",IF(N2:N<=1+' + CONFIG.SLA.YELLOW_BUFFER + ',"⚠️ Близко к сроку","🔴 Просрочено")),' +
        'IF(N2:N<=5,"✅ В норме",IF(N2:N<=5+' + CONFIG.SLA.YELLOW_BUFFER + ',"⚠️ Близко к сроку","🔴 Просрочено"))' +
      '))))';
    slaCell.setFormula(slaFormula);
  }
}

/**
 * Update vehicle repair vesting based on successful KPI months.
 */
function updateVehicleRepairVesting() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dashboard = ss.getSheetByName(CONFIG.SHEETS.DASHBOARD);
  if (!dashboard) {
    SpreadsheetApp.getUi().alert('❌ Dashboard не найден.');
    return;
  }

  // Count snapshot sheets that have KPI met = ДА
  var sheets = ss.getSheets();
  var successfulMonths = 0;

  sheets.forEach(function(sheet) {
    var name = sheet.getName();
    if (name.indexOf('KPI_') === 0 && name !== CONFIG.SHEETS.KPI_MONTH) {
      // Look for the KPI met cell — should be the last meaningful row
      var data = sheet.getDataRange().getValues();
      for (var i = 0; i < data.length; i++) {
        if (data[i][0] === 'KPI выполнен' && String(data[i][1]).indexOf('ДА') > -1) {
          successfulMonths++;
          break;
        }
      }
    }
  });

  // Update the vesting cell on dashboard (row 11, col 2 — "Успешных KPI месяцев")
  dashboard.getRange(11, 2).setValue(successfulMonths);

  var vested = Math.min(CONFIG.VEHICLE.TOTAL, successfulMonths * CONFIG.VEHICLE.MONTHLY_VESTING);
  var remaining = CONFIG.VEHICLE.TOTAL - vested;

  SpreadsheetApp.getUi().alert(
    '🚗 Vehicle Repair Vesting обновлён!\n\n' +
    'Успешных месяцев: ' + successfulMonths + '\n' +
    'Накоплено: ' + vested.toLocaleString() + ' ₽\n' +
    'Остаток: ' + remaining.toLocaleString() + ' ₽'
  );
}
/**
 * ============================================================
 * Warehouse KPI Dashboard — Main Entry Point
 * ============================================================
 *
 * USAGE:
 *   1. Open Google Sheets
 *   2. Extensions > Apps Script
 *   3. Copy all .gs files into the project
 *   4. Run createWarehouseKPIDashboard()
 *   5. Authorize when prompted
 *
 * The script will create all sheets, formulas, formatting,
 * charts, and a custom menu automatically.
 *
 * Files:
 *   Config.gs      — Central configuration
 *   SheetBuilder.gs — Queue, KPI Month, Trips sheet builders
 *   Dashboard.gs   — Executive dashboard with KPI cards & charts
 *   Automation.gs  — Menu, refresh, archive, vesting functions
 *   Main.gs        — This file (entry point + sample data)
 * ============================================================
 */

/**
 * Main entry point: builds the entire KPI dashboard system.
 * Safe to re-run — it will reset all sheets to clean state.
 */
function createWarehouseKPIDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Remove default "Sheet1" if it exists and is empty
  var defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('Лист1');
  var needsCleanup = false;
  if (defaultSheet && defaultSheet.getLastRow() <= 1 && defaultSheet.getLastColumn() <= 1) {
    needsCleanup = true;
  }

  // ── Build all sheets ──
  Logger.log('Building Queue sheet...');
  buildQueueSheet_(ss);

  Logger.log('Building Trips sheet...');
  buildTripsSheet_(ss);

  Logger.log('Building KPI Month sheet...');
  buildKPIMonthSheet_(ss);

  Logger.log('Building Dashboard...');
  buildDashboard_(ss);

  Logger.log('Building Charts...');
  buildCharts_(ss);

  // ── Insert sample data for demonstration ──
  insertSampleData_(ss);

  // ── Clean up default sheet ──
  if (needsCleanup && ss.getSheets().length > 1) {
    try { ss.deleteSheet(defaultSheet); } catch (e) { /* ignore */ }
  }

  // ── Set Dashboard as active ──
  ss.setActiveSheet(ss.getSheetByName(CONFIG.SHEETS.DASHBOARD));

  // ── Show custom menu ──
  onOpen();

  Logger.log('✅ Warehouse KPI Dashboard created successfully!');
  SpreadsheetApp.getUi().alert(
    '✅ Warehouse KPI Dashboard создан!\n\n' +
    'Листы:\n' +
    '• ' + CONFIG.SHEETS.QUEUE + ' — очередь товаров\n' +
    '• ' + CONFIG.SHEETS.KPI_MONTH + ' — KPI за месяц\n' +
    '• ' + CONFIG.SHEETS.TRIPS + ' — рейсы на WB\n' +
    '• ' + CONFIG.SHEETS.DASHBOARD + ' — сводка для руководителя\n\n' +
    'Используйте меню "📊 KPI Dashboard" для управления.'
  );
}

/**
 * Insert sample data to demonstrate functionality.
 * In production, remove or skip this function.
 */
function insertSampleData_(ss) {
  var queue = ss.getSheetByName(CONFIG.SHEETS.QUEUE);
  var trips = ss.getSheetByName(CONFIG.SHEETS.TRIPS);

  // ── Sample Queue Data ──
  var today = new Date();
  var sampleQueue = [
    [daysAgo_(2),  'ART-001', 'SKU-1001', 'Смятая коробка',         3, 1200, '', 'В работе',        '', '', 'Иванов', 'SLA 5d',  'Нет', '', ''],
    [daysAgo_(1),  'ART-002', 'SKU-1002', 'Не хватает комплектующей', 1, 4500, '', 'В очереди',       '', '', '',       'SLA 24h', 'Да',  '', ''],
    [daysAgo_(5),  'ART-003', 'SKU-1003', 'Возврат клиента',         2, 2300, '', 'Готов к продаже',  daysAgo_(-1), '', 'Петров', 'SLA 5d', 'Нет', '', ''],
    [daysAgo_(10), 'ART-004', 'SKU-1004', 'Следы использования',     1, 8700, '', 'В работе',        '', '', 'Иванов', 'SLA 5d',  'Нет', '', ''],
    [daysAgo_(15), 'ART-005', 'SKU-1005', 'Смятая коробка',         5, 950,  '', 'В очереди',       '', '', '',       'SLA 5d',  'Нет', '', ''],
    [daysAgo_(0),  'ART-006', 'SKU-1006', 'Не хватает комплектующей', 1, 3200, '', 'В очереди',       '', '', '',       'SLA 24h', 'Да',  '', ''],
    [daysAgo_(3),  'ART-007', 'SKU-1007', 'Возврат клиента',         2, 1800, '', 'Отправлено на WB', daysAgo_(1), daysAgo_(0), 'Иванов', 'SLA 5d', 'Нет', '', ''],
    [daysAgo_(25), 'ART-008', 'SKU-1008', 'Донор комплектующей',     1, 6500, '', 'Невосстановимый', '', '', 'Петров', 'SLA 5d',  'Нет', '', ''],
    [daysAgo_(7),  'ART-009', 'SKU-1009', 'Смятая коробка',         4, 1100, '', 'В работе',        '', '', 'Иванов', 'SLA 5d',  'Нет', '', ''],
    [daysAgo_(1),  'ART-010', 'SKU-1010', 'Не хватает комплектующей', 1, 5600, '', 'В очереди',       '', '', '',       'SLA 24h', 'Да',  '', '']
  ];

  // Write sample data (skip formula columns 7, 14, 15 — they are array formulas)
  var numCols = CONFIG.QUEUE_HEADERS.length;
  queue.getRange(2, 1, sampleQueue.length, numCols).setValues(sampleQueue);

  // ── Sample Trips Data ──
  var sampleTrips = [
    [daysAgo_(20), 'Р-001', 15, 42, 185000, 3500, 'Иванов', 'Плановый рейс'],
    [daysAgo_(10), 'Р-002', 22, 65, 290000, 3500, 'Иванов', 'Срочный рейс'],
    [daysAgo_(3),  'Р-003', 8,  18, 78000,  4200, 'Петров', 'Дополнительный рейс']
  ];

  trips.getRange(2, 1, sampleTrips.length, CONFIG.TRIPS_HEADERS.length).setValues(sampleTrips);
}

/**
 * Helper: return a Date object N days ago.
 * @param {number} n — days ago (negative = future)
 * @return {Date}
 */
function daysAgo_(n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

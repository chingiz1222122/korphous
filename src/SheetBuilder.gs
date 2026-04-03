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

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

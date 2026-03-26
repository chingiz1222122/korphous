/**
 * SetupAndOps.gs — System setup, triggers, health check, main orchestrator.
 *
 * Entry points:
 * - setupSystem() — creates all sheets, sets headers, populates defaults
 * - runDailySync() — fetches WB data, writes to RAW
 * - runForecastAndSimulation() — builds FACTS → FORECAST → SIMULATION → PURCHASE → DASHBOARD
 * - runFullPipeline() — daily sync + full computation
 * - runHealthCheck() — validates system state
 * - installTriggers() — sets up daily triggers
 */

// ──────────────────────────────────────────────
// System Setup
// ──────────────────────────────────────────────

/**
 * Creates all required sheets with headers and default data.
 * Safe to run multiple times (idempotent).
 */
function setupSystem() {
  logSystem('INFO', 'Setup', '=== Setting up WB Replenishment System v' + SYSTEM.VERSION + ' ===');

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Create all sheets with headers
  var sheetConfigs = [
    { name: SHEETS.MASTER, columns: COLUMNS.MASTER },
    { name: SHEETS.SETTINGS, columns: COLUMNS.SETTINGS },
    { name: SHEETS.RAW_STOCKS, columns: COLUMNS.RAW_STOCKS },
    { name: SHEETS.RAW_SALES, columns: COLUMNS.RAW_SALES },
    { name: SHEETS.RAW_ORDERS, columns: COLUMNS.RAW_ORDERS },
    { name: SHEETS.RAW_RETURNS, columns: COLUMNS.RAW_RETURNS },
    { name: SHEETS.RAW_INBOUND, columns: COLUMNS.RAW_INBOUND },
    { name: SHEETS.FACTS, columns: COLUMNS.FACTS },
    { name: SHEETS.FORECAST, columns: COLUMNS.FORECAST },
    { name: SHEETS.SIMULATION, columns: [] },  // dynamic headers
    { name: SHEETS.PURCHASE, columns: COLUMNS.PURCHASE },
    { name: SHEETS.DASHBOARD, columns: [] },    // built dynamically
    { name: SHEETS.LOG, columns: COLUMNS.LOG }
  ];

  sheetConfigs.forEach(function(config) {
    var sheet = getOrCreateSheet(config.name);
    if (config.columns && config.columns.length > 0) {
      ensureHeaders(sheet, config.columns);
    }
  });

  // Populate default settings
  populateDefaultSettings();

  // Add sample master data instruction
  addMasterDataInstruction();

  logSystem('INFO', 'Setup', '=== System setup complete ===');

  SpreadsheetApp.getUi().alert(
    'WB Replenishment System v' + SYSTEM.VERSION + ' установлена!\n\n' +
    'Следующие шаги:\n' +
    '1. Добавьте WB_API_TOKEN в Script Properties\n' +
    '2. Заполните лист MASTER (каталог SKU)\n' +
    '3. Настройте параметры на листе SETTINGS\n' +
    '4. Запустите runDailySync() для загрузки данных\n' +
    '5. Запустите runFullPipeline() для полного расчета'
  );
}

/**
 * Populates SETTINGS sheet with default values.
 */
function populateDefaultSettings() {
  var sheet = getOrCreateSheet(SHEETS.SETTINGS);
  var existing = readSheetAsObjects(SHEETS.SETTINGS);

  var existingKeys = {};
  existing.forEach(function(r) { existingKeys[r.parameter] = true; });

  var defaults = [
    ['target_turnover_days', FORECAST_CONFIG.TARGET_TURNOVER_DAYS, 'Целевой оборот запаса (дней)'],
    ['safety_stock_days', FORECAST_CONFIG.SAFETY_STOCK_DAYS, 'Страховой запас (дней)'],
    ['lead_time_production', DEFAULT_LEAD_TIME.PRODUCTION, 'Производство в Китае (дней)'],
    ['lead_time_shipping', DEFAULT_LEAD_TIME.SHIPPING, 'Доставка Китай→РФ (дней)'],
    ['lead_time_customs', DEFAULT_LEAD_TIME.CUSTOMS, 'Таможня (дней)'],
    ['lead_time_delivery_to_wb', DEFAULT_LEAD_TIME.DELIVERY_TO_WB, 'Доставка на склад WB (дней)'],
    ['lead_time_wb_acceptance', DEFAULT_LEAD_TIME.WB_ACCEPTANCE, 'Приемка WB (дней)'],
    ['seasonality_global', 1.0, 'Глобальный множитель сезонности (1.0 = без изменений)'],
    ['default_buyout_rate', FORECAST_CONFIG.DEFAULT_BUYOUT_RATE, 'Процент выкупа по умолчанию'],
    ['velocity_weight_3d', FORECAST_CONFIG.VELOCITY_WEIGHTS.D3, 'Вес 3-дневной скорости'],
    ['velocity_weight_7d', FORECAST_CONFIG.VELOCITY_WEIGHTS.D7, 'Вес 7-дневной скорости'],
    ['velocity_weight_12d', FORECAST_CONFIG.VELOCITY_WEIGHTS.D12, 'Вес 12-дневной скорости'],
    ['velocity_weight_30d', FORECAST_CONFIG.VELOCITY_WEIGHTS.D30, 'Вес 30-дневной скорости'],
    ['simulation_horizon', FORECAST_CONFIG.SIMULATION_HORIZON_DAYS, 'Горизонт симуляции (дней)'],
    ['acceleration_threshold', FORECAST_CONFIG.ACCELERATION_THRESHOLD, 'Порог детекции ускорения (3d/7d ratio)'],
    ['acceleration_cap', FORECAST_CONFIG.ACCELERATION_CAP, 'Максимальный множитель при ускорении']
  ];

  var newRows = [];
  defaults.forEach(function(d) {
    if (!existingKeys[d[0]]) {
      newRows.push(d);
    }
  });

  if (newRows.length > 0) {
    appendRows(sheet, newRows);
    logSystem('INFO', 'Setup', 'Added ' + newRows.length + ' default settings');
  }
}

/**
 * Adds instruction to MASTER sheet if empty.
 */
function addMasterDataInstruction() {
  var sheet = getOrCreateSheet(SHEETS.MASTER);
  if (sheet.getLastRow() <= 1) {
    var sampleRow = [
      12345678, 'SAMPLE-SKU-001', 'Пример товара', 'Категория',
      'Бренд', 500, 1500, 100, 'Поставщик', true, 'Заполните свои данные'
    ];
    sheet.getRange(2, 1, 1, sampleRow.length).setValues([sampleRow]);
    sheet.getRange(2, 1, 1, sampleRow.length).setFontColor('#999999');
  }
}

// ──────────────────────────────────────────────
// Main Orchestrators
// ──────────────────────────────────────────────

/**
 * Daily data sync: fetch from WB API → write to RAW sheets.
 */
function runDailySync() {
  var runId = generateRunId();
  logSystem('INFO', 'Ops', '=== Daily Sync started [' + runId + '] ===');

  try {
    var data = fetchAllWbData(35);
    writeAllRawData(data);

    logSystem('INFO', 'Ops', '=== Daily Sync complete [' + runId + ']. Errors: ' + data.errors.length + ' ===');

    if (data.errors.length > 0) {
      logSystem('WARN', 'Ops', 'Sync errors: ' + data.errors.join('; '));
    }

    return { success: true, errors: data.errors, runId: runId };
  } catch (e) {
    logSystem('ERROR', 'Ops', 'Daily Sync FAILED [' + runId + ']: ' + e.message);
    return { success: false, error: e.message, runId: runId };
  }
}

/**
 * Computation pipeline: FACTS → FORECAST → SIMULATION → PURCHASE → DASHBOARD.
 * Can run independently of sync (uses existing RAW data).
 */
function runForecastAndSimulation() {
  var runId = generateRunId();
  logSystem('INFO', 'Ops', '=== Forecast & Simulation started [' + runId + '] ===');

  try {
    // Step 1: Build FACTS
    var facts = buildFacts();
    if (facts.length === 0) {
      logSystem('WARN', 'Ops', 'No facts generated. Check RAW data.');
      return { success: false, error: 'No data', runId: runId };
    }

    // Step 2: Build FORECAST
    var forecasts = buildForecast(facts);

    // Step 3: Run SIMULATION
    var simResults = runSimulation(facts, forecasts);

    // Step 4: Build PURCHASE RECOMMENDATIONS
    var recommendations = buildPurchaseRecommendations(facts, forecasts, simResults);

    // Step 5: Build DASHBOARD
    buildDashboard(recommendations, forecasts, facts, simResults);

    logSystem('INFO', 'Ops', '=== Pipeline complete [' + runId + ']. SKUs: ' + facts.length + ' ===');

    return { success: true, skuCount: facts.length, runId: runId };
  } catch (e) {
    logSystem('ERROR', 'Ops', 'Pipeline FAILED [' + runId + ']: ' + e.message + '\n' + e.stack);
    return { success: false, error: e.message, runId: runId };
  }
}

/**
 * Full pipeline: sync + compute.
 * This is the main daily entry point.
 */
function runFullPipeline() {
  var runId = generateRunId();
  logSystem('INFO', 'Ops', '=== Full Pipeline started [' + runId + '] ===');

  // Step 1: Sync
  var syncResult = runDailySync();
  if (!syncResult.success) {
    logSystem('ERROR', 'Ops', 'Sync failed, aborting pipeline');
    return syncResult;
  }

  // Step 2: Compute
  var computeResult = runForecastAndSimulation();

  logSystem('INFO', 'Ops', '=== Full Pipeline complete [' + runId + '] ===');
  return computeResult;
}

// ──────────────────────────────────────────────
// Triggers
// ──────────────────────────────────────────────

/**
 * Installs daily triggers for automated operation.
 * Safe to run multiple times (removes existing triggers first).
 */
function installTriggers() {
  // Remove existing triggers for our functions
  var functionsToTrigger = ['runDailySync', 'runForecastAndSimulation', 'runHealthCheck'];

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (functionsToTrigger.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Daily sync at 06:00 Moscow time
  ScriptApp.newTrigger('runDailySync')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .inTimezone(SYSTEM.TIMEZONE)
    .create();

  // Forecast at 07:00 (after sync completes)
  ScriptApp.newTrigger('runForecastAndSimulation')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .inTimezone(SYSTEM.TIMEZONE)
    .create();

  // Health check at 08:00
  ScriptApp.newTrigger('runHealthCheck')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .inTimezone(SYSTEM.TIMEZONE)
    .create();

  logSystem('INFO', 'Setup', 'Triggers installed: sync@06:00, forecast@07:00, health@08:00');

  SpreadsheetApp.getUi().alert(
    'Триггеры установлены:\n' +
    '• 06:00 — Синхронизация данных WB\n' +
    '• 07:00 — Расчет прогноза и рекомендаций\n' +
    '• 08:00 — Проверка здоровья системы'
  );
}

/**
 * Removes all triggers.
 */
function removeTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
  logSystem('INFO', 'Setup', 'All triggers removed (' + triggers.length + ')');
}

// ──────────────────────────────────────────────
// Health Check
// ──────────────────────────────────────────────

/**
 * Validates system health: data freshness, sheet integrity, API connectivity.
 */
function runHealthCheck() {
  logSystem('INFO', 'HealthCheck', '=== Health Check started ===');
  var issues = [];
  var today = new Date();

  // 1. Check API token exists
  try {
    getWbApiToken();
  } catch (e) {
    issues.push('CRITICAL: WB API token not configured');
  }

  // 2. Check sheet existence
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function(key) {
    var sheetName = SHEETS[key];
    if (!ss.getSheetByName(sheetName)) {
      issues.push('WARN: Sheet "' + sheetName + '" missing');
    }
  });

  // 3. Check data freshness
  var factsData = readSheetAsObjects(SHEETS.FACTS);
  if (factsData.length === 0) {
    issues.push('WARN: FACTS sheet is empty. Run pipeline.');
  } else {
    var lastUpdate = factsData[0].lastUpdated;
    if (lastUpdate) {
      var lastDate = new Date(lastUpdate);
      var hoursAgo = (today - lastDate) / (1000 * 60 * 60);
      if (hoursAgo > 26) {
        issues.push('WARN: FACTS data is ' + Math.round(hoursAgo) + 'h old (last: ' + lastUpdate + ')');
      }
    }
  }

  // 4. Check MASTER data
  var masterData = readSheetAsObjects(SHEETS.MASTER);
  if (masterData.length <= 1) { // 1 = sample row
    issues.push('INFO: MASTER sheet needs SKU data');
  }

  // 5. Check for critical SKUs without action
  var purchaseData = readSheetAsObjects(SHEETS.PURCHASE);
  var criticalCount = purchaseData.filter(function(r) { return r.priority === 'CRITICAL'; }).length;
  if (criticalCount > 0) {
    issues.push('ALERT: ' + criticalCount + ' SKU(s) in CRITICAL priority');
  }

  // 6. Check LOG for recent errors
  var logData = readSheetAsObjects(SHEETS.LOG);
  var recentErrors = logData.filter(function(r) {
    if (r.level !== 'ERROR') return false;
    var logDate = new Date(r.timestamp);
    return (today - logDate) < 86400000; // last 24h
  });
  if (recentErrors.length > 0) {
    issues.push('WARN: ' + recentErrors.length + ' errors in last 24h');
  }

  // Log results
  if (issues.length === 0) {
    logSystem('INFO', 'HealthCheck', '=== All checks passed ===');
  } else {
    issues.forEach(function(issue) {
      logSystem('WARN', 'HealthCheck', issue);
    });
    logSystem('INFO', 'HealthCheck', '=== ' + issues.length + ' issues found ===');
  }

  return issues;
}

// ──────────────────────────────────────────────
// Logging
// ──────────────────────────────────────────────

/**
 * Writes a log entry to the LOG sheet.
 * @param {string} level - DEBUG, INFO, WARN, ERROR
 * @param {string} source - module name
 * @param {string} message
 * @param {string} details - optional extra details
 */
function logSystem(level, source, message, details) {
  try {
    // Always log to Apps Script console
    var consoleMsg = '[' + level + '] [' + source + '] ' + message;
    if (level === 'ERROR') {
      console.error(consoleMsg);
    } else if (level === 'WARN') {
      console.warn(consoleMsg);
    } else {
      console.log(consoleMsg);
    }

    // Write to LOG sheet (skip DEBUG to reduce volume)
    if (level === 'DEBUG') return;

    var sheet = getOrCreateSheet(SHEETS.LOG);
    var timestamp = Utilities.formatDate(new Date(), SYSTEM.TIMEZONE, SYSTEM.DATETIME_FORMAT);
    sheet.appendRow([timestamp, level, source, message, details || '']);
  } catch (e) {
    // Logging should never break the system
    console.error('Logging failed: ' + e.message);
  }
}

/**
 * Cleans old log entries (older than LOG_RETENTION_DAYS).
 */
function cleanOldLogs() {
  var sheet = getOrCreateSheet(SHEETS.LOG);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SYSTEM.LOG_RETENTION_DAYS);

  var timestamps = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var rowsToDelete = [];

  for (var i = 0; i < timestamps.length; i++) {
    var ts = new Date(timestamps[i][0]);
    if (ts < cutoff) {
      rowsToDelete.push(i + 2); // +2 for header offset
    }
  }

  // Delete from bottom to top to preserve row indices
  for (var j = rowsToDelete.length - 1; j >= 0; j--) {
    sheet.deleteRow(rowsToDelete[j]);
  }

  if (rowsToDelete.length > 0) {
    logSystem('INFO', 'Ops', 'Cleaned ' + rowsToDelete.length + ' old log entries');
  }
}

// ──────────────────────────────────────────────
// Custom Menu
// ──────────────────────────────────────────────

/**
 * Adds custom menu to the spreadsheet on open.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🔄 WB Replenishment')
    .addItem('⚙️ Первоначальная настройка', 'setupSystem')
    .addSeparator()
    .addItem('📥 Синхронизировать данные WB', 'runDailySync')
    .addItem('📊 Пересчитать прогноз', 'runForecastAndSimulation')
    .addItem('🚀 Полный пайплайн (синхр + расчет)', 'runFullPipeline')
    .addSeparator()
    .addItem('🏥 Проверка здоровья системы', 'runHealthCheck')
    .addItem('⏰ Установить триггеры', 'installTriggers')
    .addItem('🗑️ Удалить триггеры', 'removeTriggers')
    .addItem('🧹 Очистить старые логи', 'cleanOldLogs')
    .addToUi();
}

// ──────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────

/**
 * Generates a unique run ID for tracing.
 */
function generateRunId() {
  return Utilities.formatDate(new Date(), SYSTEM.TIMEZONE, 'yyyyMMdd-HHmmss') +
    '-' + Math.random().toString(36).substring(2, 6);
}

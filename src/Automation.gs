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

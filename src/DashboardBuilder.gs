/**
 * DashboardBuilder.gs — Management dashboard with KPIs, critical SKUs, cash requirements.
 *
 * Sections:
 * 1. Executive Summary (KPIs)
 * 2. Critical SKUs table
 * 3. Cash Requirement breakdown
 * 4. Acceleration alerts
 * 5. Overstock alerts
 * 6. Inbound pipeline
 */

// ──────────────────────────────────────────────
// Main Entry Point
// ──────────────────────────────────────────────

/**
 * Builds the DASHBOARD sheet from recommendations + forecasts.
 * @param {Array<Object>} recommendations - from PurchaseRecommendations
 * @param {Array<Object>} forecasts - from ForecastEngine
 * @param {Array<Object>} facts - from FactsBuilder
 * @param {Array<Object>} simResults - from SimulationEngine
 */
function buildDashboard(recommendations, forecasts, facts, simResults) {
  logSystem('INFO', 'Dashboard', '=== Building Dashboard ===');

  var sheet = getOrCreateSheet(SHEETS.DASHBOARD);
  sheet.clear();

  var today = new Date();
  var todayStr = Utilities.formatDate(today, SYSTEM.TIMEZONE, SYSTEM.DATETIME_FORMAT);

  var row = 1;

  // ── Section 1: Executive Summary ──
  row = writeSectionHeader(sheet, row, 'УПРАВЛЕНЧЕСКИЙ ДАШБОРД — ' + todayStr);
  row++;
  row = writeExecutiveSummary(sheet, row, recommendations, forecasts, facts);
  row += 2;

  // ── Section 2: Critical SKUs ──
  row = writeSectionHeader(sheet, row, 'КРИТИЧНЫЕ SKU (требуют немедленного действия)');
  row = writeCriticalSkus(sheet, row, recommendations);
  row += 2;

  // ── Section 3: Cash Requirement ──
  row = writeSectionHeader(sheet, row, 'ПОТРЕБНОСТЬ В ФИНАНСИРОВАНИИ');
  row = writeCashRequirement(sheet, row, recommendations);
  row += 2;

  // ── Section 4: Acceleration Alerts ──
  row = writeSectionHeader(sheet, row, 'УСКОРЕНИЕ СПРОСА');
  row = writeAccelerationAlerts(sheet, row, forecasts);
  row += 2;

  // ── Section 5: Overstock ──
  row = writeSectionHeader(sheet, row, 'ИЗБЫТОЧНЫЕ ОСТАТКИ');
  row = writeOverstockAlerts(sheet, row, recommendations);
  row += 2;

  // ── Section 6: Inbound Pipeline ──
  row = writeSectionHeader(sheet, row, 'ОЖИДАЕМЫЕ ПОСТАВКИ');
  row = writeInboundPipeline(sheet, row, facts);

  // Format
  formatDashboard(sheet);

  logSystem('INFO', 'Dashboard', '=== Dashboard built ===');
}

// ──────────────────────────────────────────────
// Section: Executive Summary
// ──────────────────────────────────────────────

function writeExecutiveSummary(sheet, startRow, recommendations, forecasts, facts) {
  var row = startRow;

  // Count by priority
  var counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, OK: 0, OVERSTOCK: 0 };
  var totalCost = 0;
  var totalSkus = recommendations.length;

  recommendations.forEach(function(r) {
    counts[r.priority] = (counts[r.priority] || 0) + 1;
    totalCost += (r.totalCost || 0);
  });

  // Total stock value
  var totalStockValue = 0;
  var totalStockUnits = 0;
  facts.forEach(function(f) {
    totalStockUnits += (Number(f.stockTotal) || 0);
  });

  // Average days cover
  var totalDaysCover = 0;
  var daysCoverCount = 0;
  forecasts.forEach(function(f) {
    var dc = Number(f.daysCover) || 0;
    if (dc > 0 && dc < 999) {
      totalDaysCover += dc;
      daysCoverCount++;
    }
  });
  var avgDaysCover = daysCoverCount > 0 ? Math.round(totalDaysCover / daysCoverCount) : 0;

  // OOS risk count
  var oosNext7d = 0;
  var oosNext14d = 0;
  forecasts.forEach(function(f) {
    var dc = Number(f.daysCover) || 999;
    if (dc <= 7) oosNext7d++;
    if (dc <= 14) oosNext14d++;
  });

  // Write KPIs
  var kpis = [
    ['Метрика', 'Значение', 'Статус'],
    ['Всего SKU', totalSkus, ''],
    ['CRITICAL (заказ срочно)', counts.CRITICAL, counts.CRITICAL > 0 ? '⚠ ВНИМАНИЕ' : 'OK'],
    ['HIGH (заказ скоро)', counts.HIGH, counts.HIGH > 0 ? 'Следить' : 'OK'],
    ['MEDIUM (запланировать)', counts.MEDIUM, ''],
    ['OK (запас достаточен)', counts.OK, ''],
    ['OVERSTOCK (избыток)', counts.OVERSTOCK, counts.OVERSTOCK > 0 ? 'Оптимизировать' : ''],
    ['', '', ''],
    ['OOS риск (≤7 дней)', oosNext7d + ' SKU', oosNext7d > 0 ? 'КРИТИЧНО' : 'OK'],
    ['OOS риск (≤14 дней)', oosNext14d + ' SKU', ''],
    ['Средний запас (дней)', avgDaysCover + ' дн.', avgDaysCover < 14 ? 'НИЗКИЙ' : 'Норма'],
    ['Всего единиц на складе', totalStockUnits, ''],
    ['', '', ''],
    ['Требуется на закупку', formatCurrency(totalCost), ''],
    ['CRITICAL закупка', formatCurrency(sumCostByPriority(recommendations, 'CRITICAL')), ''],
    ['HIGH закупка', formatCurrency(sumCostByPriority(recommendations, 'HIGH')), '']
  ];

  sheet.getRange(row, 1, kpis.length, 3).setValues(kpis);
  sheet.getRange(row, 1, 1, 3).setFontWeight('bold');

  return row + kpis.length;
}

// ──────────────────────────────────────────────
// Section: Critical SKUs
// ──────────────────────────────────────────────

function writeCriticalSkus(sheet, startRow, recommendations) {
  var row = startRow;
  var critical = recommendations.filter(function(r) {
    return r.priority === 'CRITICAL' || r.priority === 'HIGH';
  });

  if (critical.length === 0) {
    sheet.getRange(row, 1).setValue('Нет критичных SKU. Все в норме.');
    return row + 1;
  }

  var headers = ['nmId', 'SKU', 'Название', 'Приоритет', 'Остаток', 'Запас (дн)', 'OOS дата', 'Скорость/день', 'Заказать', 'Дедлайн', 'Сумма ₽'];
  sheet.getRange(row, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(row, 1, 1, headers.length).setFontWeight('bold');
  row++;

  var rows = critical.map(function(r) {
    return [
      r.nmId, r.sku, (r.title || '').substring(0, 40),
      r.priority, r.currentStock, r.daysCover, r.oosDate,
      r.velocityPerDay, r.orderQty, r.orderDeadline,
      r.totalCost
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(row, 1, rows.length, headers.length).setValues(rows);
  }

  return row + rows.length;
}

// ──────────────────────────────────────────────
// Section: Cash Requirement
// ──────────────────────────────────────────────

function writeCashRequirement(sheet, startRow, recommendations) {
  var row = startRow;

  var byPriority = {};
  recommendations.forEach(function(r) {
    if (!byPriority[r.priority]) byPriority[r.priority] = { count: 0, cost: 0, units: 0 };
    byPriority[r.priority].count++;
    byPriority[r.priority].cost += (r.totalCost || 0);
    byPriority[r.priority].units += (r.orderQty || 0);
  });

  var headers = ['Приоритет', 'SKU', 'Единиц', 'Сумма ₽'];
  sheet.getRange(row, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(row, 1, 1, headers.length).setFontWeight('bold');
  row++;

  var totalCost = 0;
  var totalUnits = 0;

  ['CRITICAL', 'HIGH', 'MEDIUM', 'OK', 'OVERSTOCK'].forEach(function(p) {
    var data = byPriority[p] || { count: 0, cost: 0, units: 0 };
    sheet.getRange(row, 1, 1, 4).setValues([[p, data.count, data.units, formatCurrency(data.cost)]]);
    totalCost += data.cost;
    totalUnits += data.units;
    row++;
  });

  sheet.getRange(row, 1, 1, 4).setValues([['ИТОГО', recommendations.length, totalUnits, formatCurrency(totalCost)]]);
  sheet.getRange(row, 1, 1, 4).setFontWeight('bold');

  return row + 1;
}

// ──────────────────────────────────────────────
// Section: Acceleration Alerts
// ──────────────────────────────────────────────

function writeAccelerationAlerts(sheet, startRow, forecasts) {
  var row = startRow;
  var accelerating = forecasts.filter(function(f) {
    return f.accelerationFlag === 'ACCELERATING' || f.accelerationFlag === 'NEW_DEMAND';
  });

  if (accelerating.length === 0) {
    sheet.getRange(row, 1).setValue('Нет SKU с ускорением спроса.');
    return row + 1;
  }

  var headers = ['nmId', 'SKU', 'Название', 'Флаг', 'Ratio', 'Скорость 3д', 'Скорость 7д', 'Прогноз/день'];
  sheet.getRange(row, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(row, 1, 1, headers.length).setFontWeight('bold');
  row++;

  var rows = accelerating.map(function(f) {
    return [
      f.nmId, f.sku, (f.title || '').substring(0, 40),
      f.accelerationFlag, f.accelerationRatio,
      '', '', // velocity3d/7d are in facts, not forecast — use velocityWeighted
      f.adjustedVelocity
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(row, 1, rows.length, headers.length).setValues(rows);
  }

  return row + rows.length;
}

// ──────────────────────────────────────────────
// Section: Overstock
// ──────────────────────────────────────────────

function writeOverstockAlerts(sheet, startRow, recommendations) {
  var row = startRow;
  var overstock = recommendations.filter(function(r) { return r.priority === 'OVERSTOCK'; });

  if (overstock.length === 0) {
    sheet.getRange(row, 1).setValue('Нет SKU с избытком.');
    return row + 1;
  }

  var headers = ['nmId', 'SKU', 'Название', 'Остаток', 'Запас (дн)', 'Скорость/день', 'Заморожено ₽'];
  sheet.getRange(row, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(row, 1, 1, headers.length).setFontWeight('bold');
  row++;

  var rows = overstock.map(function(r) {
    var frozenValue = r.currentStock * r.costPerUnit;
    return [
      r.nmId, r.sku, (r.title || '').substring(0, 40),
      r.currentStock, r.daysCover, r.velocityPerDay,
      formatCurrency(frozenValue)
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(row, 1, rows.length, headers.length).setValues(rows);
  }

  return row + rows.length;
}

// ──────────────────────────────────────────────
// Section: Inbound Pipeline
// ──────────────────────────────────────────────

function writeInboundPipeline(sheet, startRow, facts) {
  var row = startRow;
  var withInbound = facts.filter(function(f) { return Number(f.inboundQty) > 0; });

  if (withInbound.length === 0) {
    sheet.getRange(row, 1).setValue('Нет ожидаемых поставок.');
    return row + 1;
  }

  var headers = ['nmId', 'SKU', 'Название', 'В пути (шт)', 'Ожидаемая дата', 'Текущий остаток'];
  sheet.getRange(row, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(row, 1, 1, headers.length).setFontWeight('bold');
  row++;

  var rows = withInbound.map(function(f) {
    return [
      f.nmId, f.sku, (f.title || '').substring(0, 40),
      f.inboundQty, f.inboundDate, f.stockTotal
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(row, 1, rows.length, headers.length).setValues(rows);
  }

  return row + rows.length;
}

// ──────────────────────────────────────────────
// Formatting
// ──────────────────────────────────────────────

function writeSectionHeader(sheet, row, title) {
  sheet.getRange(row, 1).setValue(title);
  sheet.getRange(row, 1, 1, 6).merge();
  sheet.getRange(row, 1).setFontSize(12).setFontWeight('bold').setBackground('#4A86C8').setFontColor('#FFFFFF');
  return row + 1;
}

function formatDashboard(sheet) {
  // Auto-resize columns
  for (var i = 1; i <= 11; i++) {
    try {
      sheet.autoResizeColumn(i);
    } catch (e) {
      // ignore if column doesn't exist
    }
  }

  // Set minimum widths
  try {
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 120);
    sheet.setColumnWidth(3, 200);
  } catch (e) {}
}

function formatCurrency(value) {
  if (!value || value === 0) return '0 ₽';
  return Math.round(value).toLocaleString('ru-RU') + ' ₽';
}

function sumCostByPriority(recommendations, priority) {
  return recommendations
    .filter(function(r) { return r.priority === priority; })
    .reduce(function(sum, r) { return sum + (r.totalCost || 0); }, 0);
}

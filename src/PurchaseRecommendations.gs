/**
 * PurchaseRecommendations.gs — Purchase recommendations engine.
 *
 * Takes forecast + simulation data and generates:
 * - Priority classification (CRITICAL / HIGH / MEDIUM / OK)
 * - Action items (what to do)
 * - Order quantities
 * - Order deadlines
 * - Budget requirements
 *
 * CORE ALGORITHM (Order Quantity):
 *   orderQty = dailyVelocity × (leadTime + targetTurnover + safetyDays) - stockOnHand - inbound
 *   orderQty = max(orderQty, 0)
 *   orderQty = roundUp(orderQty / MOQ) × MOQ   // respect minimum order quantity
 */

// ──────────────────────────────────────────────
// Main Entry Point
// ──────────────────────────────────────────────

/**
 * Generates purchase recommendations from facts, forecasts, and simulations.
 * @param {Array<Object>} facts
 * @param {Array<Object>} forecasts
 * @param {Array<Object>} simResults
 * @return {Array<Object>} purchase recommendations
 */
function buildPurchaseRecommendations(facts, forecasts, simResults) {
  logSystem('INFO', 'PurchaseRec', '=== Building Purchase Recommendations ===');
  var startTime = new Date();
  var today = new Date();

  var settings = loadSettings();
  var master = readSheetAsObjects(SHEETS.MASTER);

  // Build lookup maps
  var factsMap = buildLookupMap(facts, 'nmId');
  var forecastMap = buildLookupMap(forecasts, 'nmId');
  var simMap = buildLookupMap(simResults, 'nmId');
  var masterMap = buildLookupMap(master, 'nmId');

  var totalLeadTime = getTotalLeadTime(settings);
  var targetTurnover = Number(settings['target_turnover_days']) || FORECAST_CONFIG.TARGET_TURNOVER_DAYS;
  var safetyDays = Number(settings['safety_stock_days']) || FORECAST_CONFIG.SAFETY_STOCK_DAYS;

  var recommendations = [];

  Object.keys(forecastMap).forEach(function(nmId) {
    var forecast = forecastMap[nmId];
    var fact = factsMap[nmId] || {};
    var sim = simMap[nmId] || {};
    var masterItem = masterMap[nmId] || {};

    var rec = computeRecommendation(
      nmId, fact, forecast, sim, masterItem,
      totalLeadTime, targetTurnover, safetyDays, today
    );
    recommendations.push(rec);
  });

  // Sort by priority: CRITICAL first, then HIGH, MEDIUM, OK
  var priorityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'OK': 3, 'OVERSTOCK': 4 };
  recommendations.sort(function(a, b) {
    return (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99);
  });

  // Write to PURCHASE sheet
  writePurchaseSheet(recommendations, today);

  var elapsed = ((new Date()) - startTime) / 1000;
  logSystem('INFO', 'PurchaseRec', '=== Recommendations built: ' + recommendations.length + ' SKUs in ' + elapsed + 's ===');

  return recommendations;
}

// ──────────────────────────────────────────────
// Per-SKU Recommendation
// ──────────────────────────────────────────────

/**
 * Computes purchase recommendation for a single SKU.
 *
 * @param {string} nmId
 * @param {Object} fact
 * @param {Object} forecast
 * @param {Object} sim
 * @param {Object} masterItem
 * @param {number} totalLeadTime
 * @param {number} targetTurnover
 * @param {number} safetyDays
 * @param {Date} today
 * @return {Object} recommendation
 */
function computeRecommendation(nmId, fact, forecast, sim, masterItem, totalLeadTime, targetTurnover, safetyDays, today) {
  var dailyVelocity = Number(forecast.adjustedVelocity) || 0;
  var stockTotal = Number(fact.stockTotal) || 0;
  var inboundQty = Number(fact.inboundQty) || 0;
  var inboundDate = fact.inboundDate || '';
  var costPrice = Number(masterItem.costPrice) || 0;
  var moq = Number(masterItem.moq) || 1;
  var daysCover = Number(forecast.daysCover) || 0;
  var oosDate = sim.oosDate || forecast.oosDate || '';
  var oosDay = sim.oosDay !== undefined ? sim.oosDay : -1;

  // --- Calculate Order Quantity ---
  // Need enough stock for: leadTime + targetTurnover + safetyDays
  var targetStockDays = totalLeadTime + targetTurnover + safetyDays;
  var targetStock = Math.ceil(dailyVelocity * targetStockDays);
  var availableStock = stockTotal + inboundQty;
  var rawOrderQty = targetStock - availableStock;

  // Round up to MOQ
  var orderQty = 0;
  if (rawOrderQty > 0) {
    orderQty = Math.ceil(rawOrderQty / moq) * moq;
  }

  // --- Calculate Order Deadline ---
  // Must order by: OOS date - totalLeadTime
  var orderDeadline = '';
  if (oosDay >= 0) {
    var deadlineDate = new Date(today);
    deadlineDate.setDate(deadlineDate.getDate() + oosDay - totalLeadTime);
    // If deadline is in the past, it's already urgent
    orderDeadline = formatDateForSheet(deadlineDate);
  }

  // --- Classify Priority ---
  var priority = classifyPriority(daysCover, oosDay, totalLeadTime, dailyVelocity, stockTotal, targetTurnover);

  // --- Generate Action ---
  var action = generateAction(priority, orderQty, orderDeadline, oosDay, dailyVelocity);

  // --- Calculate Cost ---
  var totalCost = orderQty * costPrice;

  // --- Forecast demand for lead time period ---
  var forecastDemand = Math.round(dailyVelocity * totalLeadTime);

  return {
    nmId: nmId,
    sku: fact.sku || masterItem.sku || '',
    title: fact.title || masterItem.title || '',
    priority: priority,
    action: action,
    currentStock: stockTotal,
    daysCover: daysCover,
    oosDate: oosDate,
    velocityPerDay: dailyVelocity,
    forecastDemand: forecastDemand,
    orderQty: orderQty,
    orderDeadline: orderDeadline,
    costPerUnit: costPrice,
    totalCost: totalCost,
    inboundQty: inboundQty,
    inboundDate: inboundDate,
    leadTimeDays: totalLeadTime
  };
}

// ──────────────────────────────────────────────
// Priority Classification
// ──────────────────────────────────────────────

/**
 * Classifies SKU priority based on days cover and OOS risk.
 *
 * RULES:
 * CRITICAL: daysCover ≤ 7 OR OOS within lead time
 * HIGH:     daysCover ≤ 14 OR OOS within 2× lead time
 * MEDIUM:   daysCover ≤ 21
 * OVERSTOCK: daysCover > targetTurnover × 2
 * OK:       everything else
 */
function classifyPriority(daysCover, oosDay, totalLeadTime, dailyVelocity, stockTotal, targetTurnover) {
  // No sales = can't classify meaningfully
  if (dailyVelocity <= 0 && stockTotal > 0) {
    return 'OK';
  }
  if (dailyVelocity <= 0 && stockTotal === 0) {
    return 'MEDIUM'; // no stock, no sales — needs review
  }

  // Check overstock first
  if (daysCover > targetTurnover * 2) {
    return 'OVERSTOCK';
  }

  // CRITICAL: OOS imminent or within safety window
  if (daysCover <= PRIORITY.CRITICAL.daysCoverMax) {
    return 'CRITICAL';
  }
  if (oosDay >= 0 && oosDay <= totalLeadTime) {
    return 'CRITICAL';
  }

  // HIGH: OOS within 2× lead time
  if (daysCover <= PRIORITY.HIGH.daysCoverMax) {
    return 'HIGH';
  }
  if (oosDay >= 0 && oosDay <= totalLeadTime * 2) {
    return 'HIGH';
  }

  // MEDIUM
  if (daysCover <= PRIORITY.MEDIUM.daysCoverMax) {
    return 'MEDIUM';
  }

  return 'OK';
}

// ──────────────────────────────────────────────
// Action Generator
// ──────────────────────────────────────────────

/**
 * Generates human-readable action string.
 */
function generateAction(priority, orderQty, orderDeadline, oosDay, dailyVelocity) {
  if (priority === 'OVERSTOCK') {
    return 'Избыток. Рассмотреть акцию или перемещение.';
  }

  if (dailyVelocity <= 0) {
    if (priority === 'MEDIUM') {
      return 'Нет остатков и продаж. Проверить актуальность SKU.';
    }
    return 'Нет продаж. Мониторить.';
  }

  if (priority === 'CRITICAL') {
    if (oosDay >= 0 && oosDay <= 3) {
      return 'СРОЧНО! OOS через ' + oosDay + ' дн. Заказать ' + orderQty + ' шт. НЕМЕДЛЕННО.';
    }
    return 'Критично! Заказать ' + orderQty + ' шт. до ' + orderDeadline;
  }

  if (priority === 'HIGH') {
    return 'Заказать ' + orderQty + ' шт. до ' + orderDeadline;
  }

  if (priority === 'MEDIUM') {
    return 'Запланировать заказ ' + orderQty + ' шт.';
  }

  return 'Запас достаточен.';
}

// ──────────────────────────────────────────────
// Sheet Writer
// ──────────────────────────────────────────────

/**
 * Writes recommendations to PURCHASE sheet with formatting.
 */
function writePurchaseSheet(recommendations, today) {
  var sheet = getOrCreateSheet(SHEETS.PURCHASE);

  var rows = recommendations.map(function(r) {
    return [
      r.nmId, r.sku, r.title,
      r.priority, r.action,
      r.currentStock, r.daysCover, r.oosDate,
      r.velocityPerDay, r.forecastDemand,
      r.orderQty, r.orderDeadline,
      r.costPerUnit, r.totalCost,
      r.inboundQty, r.inboundDate,
      r.leadTimeDays,
      formatDateForSheet(today)
    ];
  });

  overwriteSheetData(sheet, rows, COLUMNS.PURCHASE);

  // Apply conditional formatting for priority
  applyPriorityFormatting(sheet, rows.length);

  logSystem('INFO', 'PurchaseRec', 'Purchase sheet written: ' + rows.length + ' recommendations');
}

/**
 * Applies color coding to priority column.
 */
function applyPriorityFormatting(sheet, numRows) {
  if (numRows === 0) return;

  var priorityCol = 4; // 'priority' is 4th column
  var range = sheet.getRange(2, priorityCol, numRows, 1);

  // Clear existing rules for this sheet
  var rules = sheet.getConditionalFormatRules();
  var newRules = rules.filter(function(rule) {
    var ranges = rule.getRanges();
    return !ranges.some(function(r) { return r.getColumn() === priorityCol; });
  });

  // Add rules
  var criticalRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('CRITICAL')
    .setBackground('#FF0000')
    .setFontColor('#FFFFFF')
    .setRanges([range])
    .build();

  var highRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('HIGH')
    .setBackground('#FF9900')
    .setFontColor('#000000')
    .setRanges([range])
    .build();

  var mediumRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('MEDIUM')
    .setBackground('#FFFF00')
    .setFontColor('#000000')
    .setRanges([range])
    .build();

  var okRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('OK')
    .setBackground('#00FF00')
    .setFontColor('#000000')
    .setRanges([range])
    .build();

  var overstockRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('OVERSTOCK')
    .setBackground('#9900FF')
    .setFontColor('#FFFFFF')
    .setRanges([range])
    .build();

  newRules.push(criticalRule, highRule, mediumRule, okRule, overstockRule);
  sheet.setConditionalFormatRules(newRules);
}

// ──────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────

/**
 * Builds a lookup map from an array of objects.
 * @param {Array<Object>} arr
 * @param {string} key
 * @return {Object}
 */
function buildLookupMap(arr, key) {
  var map = {};
  if (!arr) return map;
  arr.forEach(function(item) {
    if (item[key] !== undefined) {
      map[String(item[key])] = item;
    }
  });
  return map;
}

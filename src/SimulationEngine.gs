/**
 * SimulationEngine.gs — Day-by-day inventory simulation.
 *
 * Projects stock levels for each SKU over SIMULATION_HORIZON_DAYS.
 * Accounts for:
 * - Daily demand (from forecast)
 * - Inbound shipments (on expected arrival date)
 * - Safety stock thresholds
 * - Actual OOS detection (day when stock hits 0)
 *
 * Output: SIMULATION sheet with per-SKU daily stock levels.
 */

// ──────────────────────────────────────────────
// Main Entry Point
// ──────────────────────────────────────────────

/**
 * Runs day-by-day inventory simulation for all SKUs.
 * @param {Array<Object>} facts - FACTS data
 * @param {Array<Object>} forecasts - FORECAST data
 * @return {Array<Object>} simulation results per SKU
 */
function runSimulation(facts, forecasts) {
  logSystem('INFO', 'SimulationEngine', '=== Running Simulation ===');
  var startTime = new Date();
  var today = new Date();
  var horizon = FORECAST_CONFIG.SIMULATION_HORIZON_DAYS;

  // Load inbound shipments
  var inbound = readSheetAsObjects(SHEETS.RAW_INBOUND);
  var settings = loadSettings();

  // Build lookup maps
  var factsMap = {};
  facts.forEach(function(f) { factsMap[f.nmId] = f; });

  var forecastMap = {};
  forecasts.forEach(function(f) { forecastMap[f.nmId] = f; });

  // Build results
  var simResults = [];

  Object.keys(factsMap).forEach(function(nmId) {
    var fact = factsMap[nmId];
    var forecast = forecastMap[nmId];
    if (!forecast) return;

    var result = simulateSku(nmId, fact, forecast, inbound, today, horizon, settings);
    simResults.push(result);
  });

  // Write to SIMULATION sheet
  writeSimulationSheet(simResults, today, horizon);

  var elapsed = ((new Date()) - startTime) / 1000;
  logSystem('INFO', 'SimulationEngine', '=== Simulation complete: ' + simResults.length + ' SKUs, ' + horizon + ' days, ' + elapsed + 's ===');

  return simResults;
}

// ──────────────────────────────────────────────
// Per-SKU Simulation
// ──────────────────────────────────────────────

/**
 * Simulates daily inventory for a single SKU.
 *
 * ALGORITHM:
 * For each day d from 0 to horizon:
 *   1. Start with previous day's ending stock (or current stock for day 0)
 *   2. Add any inbound arriving on day d
 *   3. Subtract daily demand (adjustedVelocity from forecast)
 *   4. Stock cannot go below 0 (lost sales, not negative)
 *   5. Track first day stock hits 0 → oosDay
 *   6. Track days where stock < safetyStock → at risk
 *
 * @param {string|number} nmId
 * @param {Object} fact - from FACTS
 * @param {Object} forecast - from FORECAST
 * @param {Array<Object>} inbound - all inbound records
 * @param {Date} today
 * @param {number} horizon - days to simulate
 * @param {Object} settings
 * @return {Object} { nmId, sku, dailyStock[], oosDay, oosDate, daysAtRisk }
 */
function simulateSku(nmId, fact, forecast, inbound, today, horizon, settings) {
  var dailyDemand = Number(forecast.adjustedVelocity) || 0;
  var currentStock = Number(fact.stockTotal) || 0;
  var safetyDays = Number(settings['safety_stock_days']) || FORECAST_CONFIG.SAFETY_STOCK_DAYS;
  var safetyStock = Math.round(dailyDemand * safetyDays);

  // Build inbound schedule: { dayOffset: qty }
  var inboundSchedule = buildInboundSchedule(nmId, inbound, today, horizon);

  // Simulate
  var dailyStock = [];
  var stock = currentStock;
  var oosDay = -1;
  var daysAtRisk = 0;
  var totalLostSales = 0;

  for (var day = 0; day < horizon; day++) {
    // Add inbound
    if (inboundSchedule[day]) {
      stock += inboundSchedule[day];
    }

    // Subtract demand
    if (stock >= dailyDemand) {
      stock -= dailyDemand;
    } else {
      // Partial fulfillment
      totalLostSales += (dailyDemand - stock);
      stock = 0;
    }

    // Round to avoid floating point issues
    stock = Math.round(stock * 100) / 100;
    dailyStock.push(stock);

    // Track OOS
    if (stock <= 0 && oosDay === -1) {
      oosDay = day;
    }

    // Track risk
    if (stock < safetyStock && stock > 0) {
      daysAtRisk++;
    }
  }

  // Calculate OOS date
  var oosDate = '';
  if (oosDay >= 0) {
    var oos = new Date(today);
    oos.setDate(oos.getDate() + oosDay);
    oosDate = formatDateForSheet(oos);
  }

  return {
    nmId: nmId,
    sku: fact.sku || '',
    title: fact.title || '',
    dailyStock: dailyStock,
    oosDay: oosDay,
    oosDate: oosDate,
    daysAtRisk: daysAtRisk,
    totalLostSales: Math.round(totalLostSales),
    safetyStock: safetyStock,
    currentStock: currentStock,
    dailyDemand: dailyDemand
  };
}

// ──────────────────────────────────────────────
// Inbound Schedule Builder
// ──────────────────────────────────────────────

/**
 * Builds a day-offset → quantity map for inbound shipments.
 * @param {string|number} nmId
 * @param {Array<Object>} inbound - all inbound records
 * @param {Date} today
 * @param {number} horizon
 * @return {Object} { dayOffset: totalQty }
 */
function buildInboundSchedule(nmId, inbound, today, horizon) {
  var schedule = {};
  var todayMs = today.getTime();
  var msPerDay = 86400000;

  inbound.forEach(function(i) {
    if (Number(i.nmId) !== Number(nmId)) return;
    if (i.status === 'delivered' || i.status === 'cancelled') return;

    var expectedDate = i.expectedDate instanceof Date ? i.expectedDate : new Date(i.expectedDate);
    if (isNaN(expectedDate.getTime())) return;

    var dayOffset = Math.round((expectedDate.getTime() - todayMs) / msPerDay);

    // Only include if within simulation horizon and in the future
    if (dayOffset >= 0 && dayOffset < horizon) {
      schedule[dayOffset] = (schedule[dayOffset] || 0) + (Number(i.quantity) || 0);
    }
  });

  return schedule;
}

// ──────────────────────────────────────────────
// Sheet Writer
// ──────────────────────────────────────────────

/**
 * Writes simulation results to SIMULATION sheet.
 * Columns: nmId, sku, day1, day2, ..., dayN
 */
function writeSimulationSheet(simResults, today, horizon) {
  var sheet = getOrCreateSheet(SHEETS.SIMULATION);

  // Build dynamic headers
  var headers = ['nmId', 'sku', 'oosDay', 'oosDate', 'daysAtRisk', 'lostSales'];
  for (var d = 0; d < horizon; d++) {
    var dayDate = new Date(today);
    dayDate.setDate(dayDate.getDate() + d);
    headers.push(Utilities.formatDate(dayDate, SYSTEM.TIMEZONE, 'MM/dd'));
  }

  // Build rows
  var rows = simResults.map(function(sim) {
    var row = [
      sim.nmId, sim.sku, sim.oosDay, sim.oosDate, sim.daysAtRisk, sim.totalLostSales
    ];
    sim.dailyStock.forEach(function(stock) {
      row.push(Math.round(stock));
    });
    return row;
  });

  overwriteSheetData(sheet, rows, headers);
  logSystem('INFO', 'SimulationEngine', 'Simulation sheet written: ' + rows.length + ' SKUs × ' + horizon + ' days');
}

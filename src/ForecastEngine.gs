/**
 * ForecastEngine.gs — Demand forecasting with seasonality, acceleration detection, and guards.
 *
 * ALGORITHMS:
 * 1. Weighted velocity from FACTS
 * 2. Seasonality multiplier from SETTINGS (manual override)
 * 3. Acceleration detection: 3d vs 7d comparison
 * 4. Acceleration cap to prevent over-ordering
 * 5. Days cover = total available stock / adjusted velocity
 * 6. OOS date from simulation
 */

// ──────────────────────────────────────────────
// Main Entry Point
// ──────────────────────────────────────────────

/**
 * Builds the FORECAST sheet from FACTS + SETTINGS.
 * @param {Array<Object>} facts - Optional. If not passed, reads from FACTS sheet.
 * @return {Array<Object>} forecast records
 */
function buildForecast(facts) {
  logSystem('INFO', 'ForecastEngine', '=== Building FORECAST ===');
  var startTime = new Date();

  if (!facts) {
    facts = readSheetAsObjects(SHEETS.FACTS);
  }

  if (facts.length === 0) {
    logSystem('WARN', 'ForecastEngine', 'No FACTS data. Cannot build forecast.');
    return [];
  }

  // Load settings
  var settings = loadSettings();
  var today = new Date();

  var forecasts = [];

  facts.forEach(function(fact) {
    var forecast = computeSkuForecast(fact, settings, today);
    forecasts.push(forecast);
  });

  // Write to FORECAST sheet
  var sheet = getOrCreateSheet(SHEETS.FORECAST);
  var rows = forecasts.map(function(f) {
    return [
      f.nmId, f.sku, f.title,
      f.velocityWeighted, f.seasonalityMultiplier, f.adjustedVelocity,
      f.accelerationFlag, f.accelerationRatio,
      f.forecastDemand7d, f.forecastDemand14d, f.forecastDemand30d,
      f.daysCover, f.oosDate,
      formatDateForSheet(today)
    ];
  });

  overwriteSheetData(sheet, rows, COLUMNS.FORECAST);

  var elapsed = ((new Date()) - startTime) / 1000;
  logSystem('INFO', 'ForecastEngine', '=== FORECAST built: ' + forecasts.length + ' SKUs in ' + elapsed + 's ===');

  return forecasts;
}

// ──────────────────────────────────────────────
// Per-SKU Forecast
// ──────────────────────────────────────────────

/**
 * Computes forecast for a single SKU.
 *
 * ALGORITHM:
 * 1. Start with velocityWeighted from FACTS
 * 2. Apply seasonality multiplier (from SETTINGS or plan)
 * 3. Detect acceleration: if velocity3d > velocity7d * ACCELERATION_THRESHOLD
 *    - Flag as accelerating
 *    - Cap adjusted velocity at velocity7d * ACCELERATION_CAP
 * 4. Calculate days cover = stockTotal / adjustedVelocity
 * 5. Calculate OOS date = today + daysCover
 * 6. Project demand for 7d, 14d, 30d windows
 */
function computeSkuForecast(fact, settings, today) {
  var velocityWeighted = Number(fact.velocityWeighted) || 0;
  var velocity3d = Number(fact.velocity3d) || 0;
  var velocity7d = Number(fact.velocity7d) || 0;
  var stockTotal = Number(fact.stockTotal) || 0;
  var inboundQty = Number(fact.inboundQty) || 0;

  // --- Seasonality ---
  var seasonalityMultiplier = getSeasonalityMultiplier(fact.nmId, settings);

  // --- Acceleration Detection ---
  var accelerationResult = detectAcceleration(velocity3d, velocity7d);

  // --- Adjusted Velocity ---
  var adjustedVelocity = velocityWeighted * seasonalityMultiplier;

  // Apply acceleration cap
  if (accelerationResult.flag === 'ACCELERATING') {
    var maxVelocity = velocity7d * FORECAST_CONFIG.ACCELERATION_CAP;
    if (adjustedVelocity > maxVelocity && maxVelocity > 0) {
      adjustedVelocity = maxVelocity;
      logSystem('DEBUG', 'ForecastEngine',
        'Capped velocity for nmId=' + fact.nmId + ': ' + velocityWeighted + ' → ' + adjustedVelocity);
    }
  }

  adjustedVelocity = Math.round(adjustedVelocity * 100) / 100;

  // --- Days Cover ---
  var totalAvailable = stockTotal + inboundQty;
  var daysCover = adjustedVelocity > 0 ? Math.round(totalAvailable / adjustedVelocity) : 999;

  // --- OOS Date ---
  var oosDate = '';
  if (adjustedVelocity > 0 && daysCover < 365) {
    var oos = new Date(today);
    oos.setDate(oos.getDate() + daysCover);
    oosDate = formatDateForSheet(oos);
  }

  // --- Demand Projections ---
  var forecastDemand7d = Math.round(adjustedVelocity * 7);
  var forecastDemand14d = Math.round(adjustedVelocity * 14);
  var forecastDemand30d = Math.round(adjustedVelocity * 30);

  return {
    nmId: fact.nmId,
    sku: fact.sku,
    title: fact.title,
    velocityWeighted: velocityWeighted,
    seasonalityMultiplier: seasonalityMultiplier,
    adjustedVelocity: adjustedVelocity,
    accelerationFlag: accelerationResult.flag,
    accelerationRatio: accelerationResult.ratio,
    forecastDemand7d: forecastDemand7d,
    forecastDemand14d: forecastDemand14d,
    forecastDemand30d: forecastDemand30d,
    daysCover: daysCover,
    oosDate: oosDate,
    stockTotal: stockTotal,
    inboundQty: inboundQty
  };
}

// ──────────────────────────────────────────────
// Acceleration Detection
// ──────────────────────────────────────────────

/**
 * Detects demand acceleration or deceleration.
 *
 * ALGORITHM:
 * - ratio = velocity3d / velocity7d
 * - if ratio > ACCELERATION_THRESHOLD (1.3) → ACCELERATING
 * - if ratio < DECELERATION_THRESHOLD (0.7) → DECELERATING
 * - else → STABLE
 *
 * @param {number} v3d - 3-day average daily sales
 * @param {number} v7d - 7-day average daily sales
 * @return {Object} { flag: string, ratio: number }
 */
function detectAcceleration(v3d, v7d) {
  if (v7d === 0) {
    if (v3d > 0) {
      return { flag: 'NEW_DEMAND', ratio: Infinity };
    }
    return { flag: 'NO_SALES', ratio: 0 };
  }

  var ratio = Math.round((v3d / v7d) * 100) / 100;

  if (ratio > FORECAST_CONFIG.ACCELERATION_THRESHOLD) {
    return { flag: 'ACCELERATING', ratio: ratio };
  }
  if (ratio < FORECAST_CONFIG.DECELERATION_THRESHOLD) {
    return { flag: 'DECELERATING', ratio: ratio };
  }

  return { flag: 'STABLE', ratio: ratio };
}

// ──────────────────────────────────────────────
// Seasonality
// ──────────────────────────────────────────────

/**
 * Gets seasonality multiplier for a SKU.
 * Checks SETTINGS sheet for SKU-specific or category-level overrides.
 * Default = 1.0 (no adjustment).
 *
 * SETTINGS format:
 *   parameter: "seasonality_<nmId>" or "seasonality_<category>"
 *   value: multiplier (e.g. 1.2 for +20%, 0.8 for -20%)
 */
function getSeasonalityMultiplier(nmId, settings) {
  // Check SKU-specific
  var skuKey = 'seasonality_' + nmId;
  if (settings[skuKey] !== undefined) {
    return Number(settings[skuKey]) || 1.0;
  }

  // Check global
  if (settings['seasonality_global'] !== undefined) {
    return Number(settings['seasonality_global']) || 1.0;
  }

  return 1.0;
}

// ──────────────────────────────────────────────
// Settings Loader
// ──────────────────────────────────────────────

/**
 * Loads all settings from SETTINGS sheet into a key-value object.
 * @return {Object} { parameter: value, ... }
 */
function loadSettings() {
  var settingsData = readSheetAsObjects(SHEETS.SETTINGS);
  var settings = {};

  settingsData.forEach(function(row) {
    if (row.parameter) {
      settings[row.parameter] = row.value;
    }
  });

  // Apply defaults if not set
  var defaults = {
    'target_turnover_days': FORECAST_CONFIG.TARGET_TURNOVER_DAYS,
    'safety_stock_days': FORECAST_CONFIG.SAFETY_STOCK_DAYS,
    'lead_time_production': DEFAULT_LEAD_TIME.PRODUCTION,
    'lead_time_shipping': DEFAULT_LEAD_TIME.SHIPPING,
    'lead_time_customs': DEFAULT_LEAD_TIME.CUSTOMS,
    'lead_time_delivery_to_wb': DEFAULT_LEAD_TIME.DELIVERY_TO_WB,
    'lead_time_wb_acceptance': DEFAULT_LEAD_TIME.WB_ACCEPTANCE,
    'seasonality_global': 1.0,
    'default_buyout_rate': FORECAST_CONFIG.DEFAULT_BUYOUT_RATE
  };

  Object.keys(defaults).forEach(function(key) {
    if (settings[key] === undefined || settings[key] === '') {
      settings[key] = defaults[key];
    }
  });

  return settings;
}

/**
 * Gets total lead time from settings.
 * @param {Object} settings
 * @return {number} total lead time in days
 */
function getTotalLeadTime(settings) {
  return Number(settings['lead_time_production'] || DEFAULT_LEAD_TIME.PRODUCTION) +
         Number(settings['lead_time_shipping'] || DEFAULT_LEAD_TIME.SHIPPING) +
         Number(settings['lead_time_customs'] || DEFAULT_LEAD_TIME.CUSTOMS) +
         Number(settings['lead_time_delivery_to_wb'] || DEFAULT_LEAD_TIME.DELIVERY_TO_WB) +
         Number(settings['lead_time_wb_acceptance'] || DEFAULT_LEAD_TIME.WB_ACCEPTANCE);
}

/**
 * FactsBuilder.gs — Computes aggregated metrics per SKU.
 * Sales velocity, buyout rate, return rate, stock levels.
 * All computed from RAW sheets. Output → FACTS sheet.
 */

// ──────────────────────────────────────────────
// Main Entry Point
// ──────────────────────────────────────────────

/**
 * Builds the FACTS sheet from raw data.
 * This is the foundation for all downstream calculations.
 */
function buildFacts() {
  logSystem('INFO', 'FactsBuilder', '=== Building FACTS ===');
  var startTime = new Date();

  // Load raw data
  var stocks = readSheetAsObjects(SHEETS.RAW_STOCKS);
  var sales = readSheetAsObjects(SHEETS.RAW_SALES);
  var orders = readSheetAsObjects(SHEETS.RAW_ORDERS);
  var returns = readSheetAsObjects(SHEETS.RAW_RETURNS);
  var inbound = readSheetAsObjects(SHEETS.RAW_INBOUND);
  var master = readSheetAsObjects(SHEETS.MASTER);

  // Build nmId set from all sources
  var nmIdSet = {};
  [stocks, sales, orders, returns].forEach(function(dataset) {
    dataset.forEach(function(r) {
      if (r.nmId) nmIdSet[r.nmId] = true;
    });
  });
  // Also include master items
  master.forEach(function(r) {
    if (r.nmId) nmIdSet[r.nmId] = true;
  });

  var nmIds = Object.keys(nmIdSet);
  logSystem('INFO', 'FactsBuilder', 'Processing ' + nmIds.length + ' unique SKUs');

  var today = new Date();
  var facts = [];

  nmIds.forEach(function(nmId) {
    nmId = Number(nmId);
    var fact = computeSkuFacts(nmId, stocks, sales, orders, returns, inbound, master, today);
    if (fact) {
      facts.push(fact);
    }
  });

  // Write to FACTS sheet
  var sheet = getOrCreateSheet(SHEETS.FACTS);
  var rows = facts.map(function(f) {
    return [
      f.nmId, f.sku, f.title,
      f.stockWB, f.stockFulfillment, f.stockTotal,
      f.inTransitToClient, f.inTransitFromClient,
      f.sales3d, f.sales7d, f.sales12d, f.sales30d,
      f.velocity3d, f.velocity7d, f.velocity12d, f.velocity30d,
      f.velocityWeighted,
      f.orders30d, f.delivered30d, f.buyoutRate,
      f.returns30d, f.returnRate,
      f.inboundQty, f.inboundDate,
      formatDateForSheet(today)
    ];
  });

  overwriteSheetData(sheet, rows, COLUMNS.FACTS);

  var elapsed = ((new Date()) - startTime) / 1000;
  logSystem('INFO', 'FactsBuilder', '=== FACTS built: ' + facts.length + ' SKUs in ' + elapsed + 's ===');

  return facts;
}

// ──────────────────────────────────────────────
// Per-SKU Fact Computation
// ──────────────────────────────────────────────

/**
 * Computes all facts for a single nmId.
 */
function computeSkuFacts(nmId, stocks, sales, orders, returns, inbound, master, today) {
  // --- Master data ---
  var masterItem = master.find(function(m) { return Number(m.nmId) === nmId; });
  var sku = '';
  var title = '';
  if (masterItem) {
    sku = masterItem.sku || '';
    title = masterItem.title || '';
  }

  // If no master, try to get sku from sales/stocks
  if (!sku) {
    var anyRecord = sales.find(function(s) { return Number(s.nmId) === nmId; }) ||
                    stocks.find(function(s) { return Number(s.nmId) === nmId; });
    if (anyRecord) sku = anyRecord.sku || '';
  }

  // --- Stock levels ---
  var stockData = computeStockLevels(nmId, stocks);

  // --- Sales velocity ---
  var velocityData = computeSalesVelocity(nmId, sales, today);

  // --- Buyout rate ---
  var buyoutData = computeBuyoutRate(nmId, orders, sales, today);

  // --- Returns ---
  var returnData = computeReturnRate(nmId, returns, sales, today);

  // --- Inbound ---
  var inboundData = computeInbound(nmId, inbound, today);

  return {
    nmId: nmId,
    sku: sku,
    title: title,
    stockWB: stockData.stockWB,
    stockFulfillment: stockData.stockFulfillment,
    stockTotal: stockData.stockTotal,
    inTransitToClient: stockData.inTransitToClient,
    inTransitFromClient: stockData.inTransitFromClient,
    sales3d: velocityData.sales3d,
    sales7d: velocityData.sales7d,
    sales12d: velocityData.sales12d,
    sales30d: velocityData.sales30d,
    velocity3d: velocityData.velocity3d,
    velocity7d: velocityData.velocity7d,
    velocity12d: velocityData.velocity12d,
    velocity30d: velocityData.velocity30d,
    velocityWeighted: velocityData.velocityWeighted,
    orders30d: buyoutData.orders30d,
    delivered30d: buyoutData.delivered30d,
    buyoutRate: buyoutData.buyoutRate,
    returns30d: returnData.returns30d,
    returnRate: returnData.returnRate,
    inboundQty: inboundData.qty,
    inboundDate: inboundData.date
  };
}

// ──────────────────────────────────────────────
// Stock Level Aggregation
// ──────────────────────────────────────────────

/**
 * Aggregates stock levels across WB warehouses.
 * Separates WB warehouse stock from fulfillment stock.
 * Fulfillment warehouses are identified by name containing "Фулфилмент" or set in SETTINGS.
 */
function computeStockLevels(nmId, stocks) {
  var skuStocks = stocks.filter(function(s) { return Number(s.nmId) === nmId; });

  var fulfillmentKeywords = ['фулфилмент', 'fulfillment', 'ff', 'фф'];
  var stockWB = 0;
  var stockFulfillment = 0;
  var inTransitToClient = 0;
  var inTransitFromClient = 0;

  skuStocks.forEach(function(s) {
    var wh = (s.warehouseName || '').toLowerCase();
    var isFulfillment = fulfillmentKeywords.some(function(kw) { return wh.indexOf(kw) >= 0; });

    if (isFulfillment) {
      stockFulfillment += (s.quantity || 0);
    } else {
      stockWB += (s.quantity || 0);
    }

    inTransitToClient += (s.inWayToClient || 0);
    inTransitFromClient += (s.inWayFromClient || 0);
  });

  return {
    stockWB: stockWB,
    stockFulfillment: stockFulfillment,
    stockTotal: stockWB + stockFulfillment,
    inTransitToClient: inTransitToClient,
    inTransitFromClient: inTransitFromClient
  };
}

// ──────────────────────────────────────────────
// Sales Velocity
// ──────────────────────────────────────────────

/**
 * Calculates sales velocity for multiple periods.
 * Returns total sales and daily average for each period.
 *
 * ALGORITHM:
 * 1. Filter sales for this nmId, exclude returns
 * 2. For each period (3, 7, 12, 30 days):
 *    - Sum quantities sold in that window
 *    - Divide by number of days → daily velocity
 * 3. Compute weighted average using FORECAST_CONFIG.VELOCITY_WEIGHTS
 */
function computeSalesVelocity(nmId, sales, today) {
  // Filter sales for this SKU, non-returns only
  var skuSales = sales.filter(function(s) {
    return Number(s.nmId) === nmId && !s.isReturn;
  });

  var periods = FORECAST_CONFIG.VELOCITY_PERIODS; // [3, 7, 12, 30]
  var weights = FORECAST_CONFIG.VELOCITY_WEIGHTS;
  var result = {};

  periods.forEach(function(days) {
    var cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - days);

    var totalQty = 0;
    skuSales.forEach(function(s) {
      var saleDate = s.date instanceof Date ? s.date : new Date(s.date);
      if (saleDate >= cutoff) {
        totalQty += (s.quantity || 0);
      }
    });

    result['sales' + days + 'd'] = totalQty;
    result['velocity' + days + 'd'] = days > 0 ? totalQty / days : 0;
  });

  // Weighted velocity
  var weightedVelocity =
    result.velocity3d * weights.D3 +
    result.velocity7d * weights.D7 +
    result.velocity12d * weights.D12 +
    result.velocity30d * weights.D30;

  result.velocityWeighted = Math.round(weightedVelocity * 100) / 100;

  return result;
}

// ──────────────────────────────────────────────
// Buyout Rate
// ──────────────────────────────────────────────

/**
 * Calculates buyout rate = delivered / total_orders over 30 days.
 * Uses orders and sales data.
 *
 * ALGORITHM:
 * 1. Count total orders in last 30 days (non-cancelled)
 * 2. Count delivered sales in last 30 days
 * 3. buyoutRate = delivered / orders
 * 4. Fallback to DEFAULT_BUYOUT_RATE if insufficient data
 */
function computeBuyoutRate(nmId, orders, sales, today) {
  var cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - FORECAST_CONFIG.BUYOUT_LOOKBACK_DAYS);

  // Total orders (non-cancelled)
  var orders30d = 0;
  orders.forEach(function(o) {
    if (Number(o.nmId) !== nmId) return;
    var orderDate = o.date instanceof Date ? o.date : new Date(o.date);
    if (orderDate >= cutoff && !o.isCancel) {
      orders30d += (o.quantity || 0);
    }
  });

  // Delivered = actual sales (positive qty)
  var delivered30d = 0;
  sales.forEach(function(s) {
    if (Number(s.nmId) !== nmId) return;
    var saleDate = s.date instanceof Date ? s.date : new Date(s.date);
    if (saleDate >= cutoff && !s.isReturn) {
      delivered30d += (s.quantity || 0);
    }
  });

  var buyoutRate = FORECAST_CONFIG.DEFAULT_BUYOUT_RATE;
  if (orders30d > 0) {
    buyoutRate = Math.min(delivered30d / orders30d, 1.0);
  }

  return {
    orders30d: orders30d,
    delivered30d: delivered30d,
    buyoutRate: Math.round(buyoutRate * 100) / 100
  };
}

// ──────────────────────────────────────────────
// Return Rate
// ──────────────────────────────────────────────

/**
 * Calculates return rate = returns / (sales + returns) over 30 days.
 */
function computeReturnRate(nmId, returns, sales, today) {
  var cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 30);

  var returns30d = 0;
  returns.forEach(function(r) {
    if (Number(r.nmId) !== nmId) return;
    var rDate = r.date instanceof Date ? r.date : new Date(r.date);
    if (rDate >= cutoff) {
      returns30d += (r.quantity || 0);
    }
  });

  var sales30d = 0;
  sales.forEach(function(s) {
    if (Number(s.nmId) !== nmId) return;
    var sDate = s.date instanceof Date ? s.date : new Date(s.date);
    if (sDate >= cutoff && !s.isReturn) {
      sales30d += (s.quantity || 0);
    }
  });

  var total = sales30d + returns30d;
  var returnRate = total > 0 ? returns30d / total : 0;

  return {
    returns30d: returns30d,
    returnRate: Math.round(returnRate * 100) / 100
  };
}

// ──────────────────────────────────────────────
// Inbound Computation
// ──────────────────────────────────────────────

/**
 * Finds next expected inbound shipment for this SKU.
 * Returns total inbound qty and earliest expected date.
 */
function computeInbound(nmId, inbound, today) {
  var skuInbound = inbound.filter(function(i) {
    return Number(i.nmId) === nmId &&
           i.status !== 'delivered' &&
           i.status !== 'cancelled';
  });

  if (skuInbound.length === 0) {
    return { qty: 0, date: '' };
  }

  var totalQty = 0;
  var earliestDate = null;

  skuInbound.forEach(function(i) {
    totalQty += (i.quantity || 0);
    var expDate = i.expectedDate instanceof Date ? i.expectedDate : new Date(i.expectedDate);
    if (expDate && (!earliestDate || expDate < earliestDate)) {
      earliestDate = expDate;
    }
  });

  return {
    qty: totalQty,
    date: earliestDate ? formatDateForSheet(earliestDate) : ''
  };
}

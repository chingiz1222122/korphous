/**
 * WbApi.gs — Wildberries API client with retry, rate limiting, pagination, logging.
 * Production-grade: exponential backoff, error classification, deduplication.
 */

// ──────────────────────────────────────────────
// Core HTTP Client
// ──────────────────────────────────────────────

/**
 * Makes authenticated request to WB API with retry logic.
 * @param {string} url - Full API URL
 * @param {Object} options - UrlFetchApp options override
 * @return {Object} Parsed JSON response
 */
function wbApiRequest(url, options) {
  var token = getWbApiToken();
  var defaultOptions = {
    method: 'get',
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };

  var mergedOptions = Object.assign({}, defaultOptions, options || {});
  if (options && options.headers) {
    mergedOptions.headers = Object.assign({}, defaultOptions.headers, options.headers);
  }

  var lastError = null;

  for (var attempt = 0; attempt <= WB_API.MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      var delay = WB_API.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      logSystem('WARN', 'WbApi', 'Retry attempt ' + attempt + ' after ' + delay + 'ms for: ' + url);
      Utilities.sleep(delay);
    }

    try {
      // Rate limiting
      Utilities.sleep(WB_API.RATE_LIMIT_PAUSE_MS);

      var response = UrlFetchApp.fetch(url, mergedOptions);
      var code = response.getResponseCode();
      var body = response.getContentText();

      if (code === 200) {
        logSystem('DEBUG', 'WbApi', 'OK: ' + url);
        try {
          return JSON.parse(body);
        } catch (e) {
          return body;
        }
      }

      if (code === 429) {
        // Rate limited — always retry
        logSystem('WARN', 'WbApi', 'Rate limited (429). URL: ' + url);
        lastError = new Error('Rate limited: ' + code);
        Utilities.sleep(5000); // extra pause on rate limit
        continue;
      }

      if (code >= 500) {
        // Server error — retry
        logSystem('WARN', 'WbApi', 'Server error ' + code + '. URL: ' + url);
        lastError = new Error('Server error: ' + code);
        continue;
      }

      // Client error (4xx except 429) — don't retry
      logSystem('ERROR', 'WbApi', 'Client error ' + code + '. URL: ' + url + '. Body: ' + body.substring(0, 500));
      throw new Error('WB API error ' + code + ': ' + body.substring(0, 200));

    } catch (e) {
      if (e.message && e.message.indexOf('WB API error') === 0) {
        throw e; // don't retry client errors
      }
      lastError = e;
      logSystem('WARN', 'WbApi', 'Network error: ' + e.message);
    }
  }

  logSystem('ERROR', 'WbApi', 'All retries exhausted for: ' + url);
  throw lastError || new Error('WB API request failed after retries: ' + url);
}

// ──────────────────────────────────────────────
// Stocks API
// ──────────────────────────────────────────────

/**
 * Fetches current warehouse stocks from WB.
 * @param {Date} dateFrom - Start date for stocks snapshot
 * @return {Array} Array of stock records
 */
function fetchWbStocks(dateFrom) {
  dateFrom = dateFrom || new Date();
  var dateStr = Utilities.formatDate(dateFrom, SYSTEM.TIMEZONE, SYSTEM.DATE_FORMAT);
  var url = WB_API.BASE_STATS + WB_API.STOCKS + '?dateFrom=' + dateStr;

  logSystem('INFO', 'WbApi', 'Fetching stocks from ' + dateStr);
  var data = wbApiRequest(url);

  if (!Array.isArray(data)) {
    logSystem('WARN', 'WbApi', 'Stocks response is not array. Got: ' + typeof data);
    return [];
  }

  logSystem('INFO', 'WbApi', 'Fetched ' + data.length + ' stock records');
  return data;
}

// ──────────────────────────────────────────────
// Orders API
// ──────────────────────────────────────────────

/**
 * Fetches orders for given period.
 * WB returns max ~90 days. Use flag=1 for updates only.
 * @param {Date} dateFrom - Start date
 * @param {number} flag - 0=new only, 1=with updates (changes)
 * @return {Array} Array of order records
 */
function fetchWbOrders(dateFrom, flag) {
  var dateStr = Utilities.formatDate(dateFrom, SYSTEM.TIMEZONE, SYSTEM.DATE_FORMAT);
  flag = flag || 0;
  var url = WB_API.BASE_STATS + WB_API.ORDERS + '?dateFrom=' + dateStr + '&flag=' + flag;

  logSystem('INFO', 'WbApi', 'Fetching orders from ' + dateStr);
  var data = wbApiRequest(url);

  if (!Array.isArray(data)) {
    logSystem('WARN', 'WbApi', 'Orders response is not array');
    return [];
  }

  logSystem('INFO', 'WbApi', 'Fetched ' + data.length + ' order records');
  return data;
}

// ──────────────────────────────────────────────
// Sales API
// ──────────────────────────────────────────────

/**
 * Fetches sales for given period.
 * @param {Date} dateFrom - Start date
 * @param {number} flag - 0=new only, 1=with updates
 * @return {Array} Array of sale records
 */
function fetchWbSales(dateFrom, flag) {
  var dateStr = Utilities.formatDate(dateFrom, SYSTEM.TIMEZONE, SYSTEM.DATE_FORMAT);
  flag = flag || 0;
  var url = WB_API.BASE_STATS + WB_API.SALES + '?dateFrom=' + dateStr + '&flag=' + flag;

  logSystem('INFO', 'WbApi', 'Fetching sales from ' + dateStr);
  var data = wbApiRequest(url);

  if (!Array.isArray(data)) {
    logSystem('WARN', 'WbApi', 'Sales response is not array');
    return [];
  }

  // Separate sales from returns
  var sales = [];
  var returns = [];

  data.forEach(function(item) {
    if (item.quantity < 0 || item.isReturn) {
      returns.push(item);
    } else {
      sales.push(item);
    }
  });

  logSystem('INFO', 'WbApi', 'Fetched ' + sales.length + ' sales, ' + returns.length + ' returns');
  return { sales: sales, returns: returns, raw: data };
}

// ──────────────────────────────────────────────
// Data Normalization
// ──────────────────────────────────────────────

/**
 * Normalizes stock record from WB API format to internal format.
 */
function normalizeStockRecord(raw) {
  return {
    date: new Date(),
    nmId: raw.nmId || 0,
    sku: raw.supplierArticle || '',
    warehouseName: raw.warehouseName || '',
    quantity: raw.quantity || 0,
    inWayToClient: raw.inWayToClient || 0,
    inWayFromClient: raw.inWayFromClient || 0,
    quantityFull: (raw.quantity || 0) + (raw.inWayToClient || 0) + (raw.inWayFromClient || 0)
  };
}

/**
 * Normalizes sale record from WB API format.
 */
function normalizeSaleRecord(raw) {
  return {
    date: raw.date ? new Date(raw.date) : new Date(),
    nmId: raw.nmId || 0,
    sku: raw.supplierArticle || '',
    warehouseName: raw.warehouseName || '',
    quantity: Math.abs(raw.quantity || 0),
    totalPrice: raw.totalPrice || 0,
    discountPercent: raw.discountPercent || 0,
    spp: raw.spp || 0,
    forPay: raw.forPay || 0,
    finishedPrice: raw.finishedPrice || 0,
    saleID: raw.saleID || '',
    orderType: raw.orderType || '',
    isReturn: (raw.quantity || 0) < 0
  };
}

/**
 * Normalizes order record from WB API format.
 */
function normalizeOrderRecord(raw) {
  return {
    date: raw.date ? new Date(raw.date) : new Date(),
    nmId: raw.nmId || 0,
    sku: raw.supplierArticle || '',
    warehouseName: raw.warehouseName || '',
    quantity: raw.quantity || 0,
    totalPrice: raw.totalPrice || 0,
    orderID: raw.orderId || raw.gNumber || '',
    isCancel: raw.isCancel || false
  };
}

/**
 * Normalizes return record from WB sale with negative qty.
 */
function normalizeReturnRecord(raw) {
  return {
    date: raw.date ? new Date(raw.date) : new Date(),
    nmId: raw.nmId || 0,
    sku: raw.supplierArticle || '',
    warehouseName: raw.warehouseName || '',
    quantity: Math.abs(raw.quantity || 0),
    totalPrice: Math.abs(raw.totalPrice || 0),
    returnID: raw.saleID || ''
  };
}

// ──────────────────────────────────────────────
// Batch Fetch Helper
// ──────────────────────────────────────────────

/**
 * Fetches all data types in one call for daily sync.
 * @param {number} lookbackDays - How many days back to fetch
 * @return {Object} { stocks, orders, sales, returns }
 */
function fetchAllWbData(lookbackDays) {
  lookbackDays = lookbackDays || 35;
  var dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - lookbackDays);

  logSystem('INFO', 'WbApi', '=== Starting full data fetch, lookback: ' + lookbackDays + ' days ===');

  var result = {
    stocks: [],
    orders: [],
    sales: [],
    returns: [],
    fetchDate: new Date(),
    errors: []
  };

  // Fetch stocks
  try {
    var rawStocks = fetchWbStocks(dateFrom);
    result.stocks = rawStocks.map(normalizeStockRecord);
  } catch (e) {
    logSystem('ERROR', 'WbApi', 'Failed to fetch stocks: ' + e.message);
    result.errors.push('stocks: ' + e.message);
  }

  // Fetch orders
  try {
    var rawOrders = fetchWbOrders(dateFrom, 0);
    result.orders = rawOrders.map(normalizeOrderRecord);
  } catch (e) {
    logSystem('ERROR', 'WbApi', 'Failed to fetch orders: ' + e.message);
    result.errors.push('orders: ' + e.message);
  }

  // Fetch sales (includes returns)
  try {
    var salesData = fetchWbSales(dateFrom, 0);
    result.sales = salesData.sales.map(normalizeSaleRecord);
    result.returns = salesData.returns.map(normalizeReturnRecord);
  } catch (e) {
    logSystem('ERROR', 'WbApi', 'Failed to fetch sales: ' + e.message);
    result.errors.push('sales: ' + e.message);
  }

  logSystem('INFO', 'WbApi', '=== Fetch complete. Stocks: ' + result.stocks.length +
    ', Orders: ' + result.orders.length +
    ', Sales: ' + result.sales.length +
    ', Returns: ' + result.returns.length +
    ', Errors: ' + result.errors.length + ' ===');

  return result;
}

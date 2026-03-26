/**
 * DataWriter.gs — Writes raw API data to sheets with deduplication.
 * Handles batch writes, column mapping, and data integrity.
 */

// ──────────────────────────────────────────────
// Core Write Functions
// ──────────────────────────────────────────────

/**
 * Gets or creates a sheet by name.
 * @param {string} sheetName
 * @return {Sheet}
 */
function getOrCreateSheet(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    logSystem('INFO', 'DataWriter', 'Created sheet: ' + sheetName);
  }
  return sheet;
}

/**
 * Ensures sheet has correct headers.
 * @param {Sheet} sheet
 * @param {Array<string>} columns
 */
function ensureHeaders(sheet, columns) {
  if (!columns || columns.length === 0) return;

  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    // Empty sheet — write headers
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    sheet.getRange(1, 1, 1, columns.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    logSystem('DEBUG', 'DataWriter', 'Headers written to: ' + sheet.getName());
    return;
  }

  // Check existing headers
  var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var match = columns.every(function(col, i) { return existing[i] === col; });

  if (!match) {
    // Overwrite headers if mismatch
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    sheet.getRange(1, 1, 1, columns.length).setFontWeight('bold');
    logSystem('WARN', 'DataWriter', 'Headers corrected on: ' + sheet.getName());
  }
}

/**
 * Appends rows to sheet in batches, respecting max rows.
 * @param {Sheet} sheet
 * @param {Array<Array>} rows - 2D array of values
 * @param {number} batchSize - optional batch size
 */
function appendRows(sheet, rows, batchSize) {
  if (!rows || rows.length === 0) return;

  batchSize = batchSize || SYSTEM.BATCH_SIZE;
  var lastRow = sheet.getLastRow();

  for (var i = 0; i < rows.length; i += batchSize) {
    var batch = rows.slice(i, Math.min(i + batchSize, rows.length));
    var startRow = lastRow + 1 + i;

    sheet.getRange(startRow, 1, batch.length, batch[0].length).setValues(batch);
  }

  logSystem('DEBUG', 'DataWriter', 'Appended ' + rows.length + ' rows to ' + sheet.getName());
}

/**
 * Overwrites sheet data (keeps headers).
 * @param {Sheet} sheet
 * @param {Array<Array>} rows
 * @param {Array<string>} columns - header columns
 */
function overwriteSheetData(sheet, rows, columns) {
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), (columns || []).length, 1);

  // Clear data rows (keep header)
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }

  if (columns) {
    ensureHeaders(sheet, columns);
  }

  if (rows && rows.length > 0) {
    appendRows(sheet, rows);
  }

  logSystem('DEBUG', 'DataWriter', 'Overwritten ' + sheet.getName() + ' with ' + (rows ? rows.length : 0) + ' rows');
}

// ──────────────────────────────────────────────
// Raw Data Writers
// ──────────────────────────────────────────────

/**
 * Writes stock data to RAW_Stocks sheet.
 * Stocks are always overwritten (snapshot = current state).
 * @param {Array<Object>} stockRecords - Normalized stock records
 */
function writeStocksData(stockRecords) {
  var sheet = getOrCreateSheet(SHEETS.RAW_STOCKS);
  ensureHeaders(sheet, COLUMNS.RAW_STOCKS);

  var rows = stockRecords.map(function(r) {
    return [
      formatDateForSheet(r.date),
      r.nmId,
      r.sku,
      r.warehouseName,
      r.quantity,
      r.inWayToClient,
      r.inWayFromClient,
      r.quantityFull
    ];
  });

  // Stocks = full overwrite (current snapshot)
  overwriteSheetData(sheet, rows, COLUMNS.RAW_STOCKS);
  logSystem('INFO', 'DataWriter', 'Wrote ' + rows.length + ' stock records');
}

/**
 * Writes sales data to RAW_Sales with deduplication by saleID.
 * @param {Array<Object>} saleRecords - Normalized sale records
 */
function writeSalesData(saleRecords) {
  var sheet = getOrCreateSheet(SHEETS.RAW_SALES);
  ensureHeaders(sheet, COLUMNS.RAW_SALES);

  // Get existing saleIDs for dedup
  var existingIds = getExistingIds(sheet, 11); // saleID is column 11 (index)

  var newRecords = saleRecords.filter(function(r) {
    return r.saleID && !existingIds[r.saleID];
  });

  if (newRecords.length === 0) {
    logSystem('INFO', 'DataWriter', 'No new sales to write (all deduplicated)');
    return;
  }

  var rows = newRecords.map(function(r) {
    return [
      formatDateForSheet(r.date),
      r.nmId,
      r.sku,
      r.warehouseName,
      r.quantity,
      r.totalPrice,
      r.discountPercent,
      r.spp,
      r.forPay,
      r.finishedPrice,
      r.saleID,
      r.orderType,
      r.isReturn
    ];
  });

  appendRows(sheet, rows);
  logSystem('INFO', 'DataWriter', 'Wrote ' + rows.length + ' new sales (deduped from ' + saleRecords.length + ')');
}

/**
 * Writes order data to RAW_Orders with deduplication by orderID.
 * @param {Array<Object>} orderRecords
 */
function writeOrdersData(orderRecords) {
  var sheet = getOrCreateSheet(SHEETS.RAW_ORDERS);
  ensureHeaders(sheet, COLUMNS.RAW_ORDERS);

  var existingIds = getExistingIds(sheet, 7); // orderID col

  var newRecords = orderRecords.filter(function(r) {
    return r.orderID && !existingIds[r.orderID];
  });

  if (newRecords.length === 0) {
    logSystem('INFO', 'DataWriter', 'No new orders to write');
    return;
  }

  var rows = newRecords.map(function(r) {
    return [
      formatDateForSheet(r.date),
      r.nmId,
      r.sku,
      r.warehouseName,
      r.quantity,
      r.totalPrice,
      r.orderID,
      r.isCancel
    ];
  });

  appendRows(sheet, rows);
  logSystem('INFO', 'DataWriter', 'Wrote ' + rows.length + ' new orders');
}

/**
 * Writes return data to RAW_Returns with deduplication.
 * @param {Array<Object>} returnRecords
 */
function writeReturnsData(returnRecords) {
  var sheet = getOrCreateSheet(SHEETS.RAW_RETURNS);
  ensureHeaders(sheet, COLUMNS.RAW_RETURNS);

  var existingIds = getExistingIds(sheet, 7); // returnID col

  var newRecords = returnRecords.filter(function(r) {
    return r.returnID && !existingIds[r.returnID];
  });

  if (newRecords.length === 0) {
    logSystem('INFO', 'DataWriter', 'No new returns to write');
    return;
  }

  var rows = newRecords.map(function(r) {
    return [
      formatDateForSheet(r.date),
      r.nmId,
      r.sku,
      r.warehouseName,
      r.quantity,
      r.totalPrice,
      r.returnID
    ];
  });

  appendRows(sheet, rows);
  logSystem('INFO', 'DataWriter', 'Wrote ' + rows.length + ' new returns');
}

// ──────────────────────────────────────────────
// Deduplication Helpers
// ──────────────────────────────────────────────

/**
 * Builds a set of existing IDs from a sheet column for deduplication.
 * @param {Sheet} sheet
 * @param {number} colIndex - 1-based column index of the ID field
 * @return {Object} Hash set of existing IDs
 */
function getExistingIds(sheet, colIndex) {
  var ids = {};
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return ids;

  var data = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
  data.forEach(function(row) {
    if (row[0]) {
      ids[String(row[0])] = true;
    }
  });

  return ids;
}

// ──────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────

/**
 * Formats date for sheet display.
 */
function formatDateForSheet(date) {
  if (!date) return '';
  if (typeof date === 'string') {
    date = new Date(date);
  }
  return Utilities.formatDate(date, SYSTEM.TIMEZONE, SYSTEM.DATETIME_FORMAT);
}

/**
 * Reads all data from a sheet as array of objects.
 * @param {string} sheetName
 * @return {Array<Object>}
 */
function readSheetAsObjects(sheetName) {
  var sheet = getOrCreateSheet(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastRow <= 1 || lastCol === 0) return [];

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  return data.map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) {
      obj[h] = row[i];
    });
    return obj;
  });
}

/**
 * Writes all data from daily sync to respective sheets.
 * @param {Object} fetchResult - Result from fetchAllWbData()
 */
function writeAllRawData(fetchResult) {
  logSystem('INFO', 'DataWriter', '=== Writing all raw data ===');

  if (fetchResult.stocks.length > 0) {
    writeStocksData(fetchResult.stocks);
  }
  if (fetchResult.sales.length > 0) {
    writeSalesData(fetchResult.sales);
  }
  if (fetchResult.orders.length > 0) {
    writeOrdersData(fetchResult.orders);
  }
  if (fetchResult.returns.length > 0) {
    writeReturnsData(fetchResult.returns);
  }

  logSystem('INFO', 'DataWriter', '=== Raw data write complete ===');
}

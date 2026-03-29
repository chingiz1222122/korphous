/**
 * Config.gs — Central configuration for WB Replenishment System
 * All constants, API keys, sheet names, and defaults.
 */

// ──────────────────────────────────────────────
// API Configuration
// ──────────────────────────────────────────────

/**
 * Returns WB API token from script properties (secure storage).
 * Set via: File → Project Settings → Script Properties → WB_API_TOKEN
 */
function getWbApiToken() {
  var token = PropertiesService.getScriptProperties().getProperty('WB_API_TOKEN');
  if (!token) {
    throw new Error('WB_API_TOKEN not set in Script Properties. Go to File → Project Settings → Script Properties.');
  }
  return token;
}

// ──────────────────────────────────────────────
// Sheet Names
// ──────────────────────────────────────────────

var SHEETS = {
  MASTER: 'MASTER',
  SETTINGS: 'SETTINGS',
  RAW_STOCKS: 'RAW_Stocks',
  RAW_SALES: 'RAW_Sales',
  RAW_ORDERS: 'RAW_Orders',
  RAW_RETURNS: 'RAW_Returns',
  RAW_INBOUND: 'RAW_Inbound',
  FACTS: 'FACTS',
  FORECAST: 'FORECAST',
  SIMULATION: 'SIMULATION',
  PURCHASE: 'PURCHASE',
  DASHBOARD: 'DASHBOARD',
  LOG: 'LOG'
};

// ──────────────────────────────────────────────
// WB API Endpoints
// ──────────────────────────────────────────────

var WB_API = {
  BASE_STATS: 'https://statistics-api.wildberries.ru/api/v1',
  BASE_CONTENT: 'https://content-api.wildberries.ru',
  BASE_MARKETPLACE: 'https://marketplace-api.wildberries.ru/api/v3',
  BASE_ANALYTICS: 'https://seller-analytics-api.wildberries.ru/api/v2',

  STOCKS: '/supplier/stocks',          // GET, param: dateFrom
  ORDERS: '/supplier/orders',          // GET, param: dateFrom
  SALES: '/supplier/sales',            // GET, param: dateFrom
  WAREHOUSES: '/offices',              // GET - list of WB warehouses

  // Rate limits
  RATE_LIMIT_PAUSE_MS: 350,            // min pause between requests
  MAX_RETRIES: 3,
  RETRY_BASE_DELAY_MS: 2000
};

// ──────────────────────────────────────────────
// Default Lead Time Components (days)
// ──────────────────────────────────────────────

var DEFAULT_LEAD_TIME = {
  PRODUCTION: 15,       // Manufacturing in China
  SHIPPING: 25,         // Sea freight China → Russia
  CUSTOMS: 5,           // Customs clearance
  DELIVERY_TO_WB: 3,    // Fulfillment → WB warehouse
  WB_ACCEPTANCE: 3,     // WB intake processing
  TOTAL: 51             // Sum of above
};

// ──────────────────────────────────────────────
// Forecast & Replenishment Defaults
// ──────────────────────────────────────────────

var FORECAST_CONFIG = {
  // Velocity calculation weights
  VELOCITY_WEIGHTS: {
    D3: 0.35,
    D7: 0.30,
    D12: 0.20,
    D30: 0.15
  },

  // Velocity periods (days)
  VELOCITY_PERIODS: [3, 7, 12, 30],

  // Acceleration thresholds
  ACCELERATION_THRESHOLD: 1.3,     // 3d > 7d * 1.3 → acceleration detected
  ACCELERATION_CAP: 1.5,           // cap forecast at 1.5x of 7d avg
  DECELERATION_THRESHOLD: 0.7,     // 3d < 7d * 0.7 → deceleration

  // Target inventory
  TARGET_TURNOVER_DAYS: 30,
  SAFETY_STOCK_DAYS: 7,

  // Simulation
  SIMULATION_HORIZON_DAYS: 60,

  // Buyout rate defaults
  DEFAULT_BUYOUT_RATE: 0.75,       // 75% if no data
  BUYOUT_LOOKBACK_DAYS: 30,

  // Minimum data points for reliable forecast
  MIN_SALES_DAYS: 3
};

// ──────────────────────────────────────────────
// Priority Thresholds
// ──────────────────────────────────────────────

var PRIORITY = {
  CRITICAL: {
    label: 'CRITICAL',
    daysCoverMax: 7,
    color: '#FF0000'
  },
  HIGH: {
    label: 'HIGH',
    daysCoverMax: 14,
    color: '#FF9900'
  },
  MEDIUM: {
    label: 'MEDIUM',
    daysCoverMax: 21,
    color: '#FFFF00'
  },
  OK: {
    label: 'OK',
    daysCoverMax: Infinity,
    color: '#00FF00'
  }
};

// ──────────────────────────────────────────────
// Sheet Column Definitions
// ──────────────────────────────────────────────

var COLUMNS = {
  MASTER: [
    'nmId', 'sku', 'title', 'category', 'brand',
    'costPrice', 'sellPrice', 'moq', 'supplier',
    'isActive', 'notes'
  ],

  SETTINGS: [
    'parameter', 'value', 'description'
  ],

  RAW_STOCKS: [
    'date', 'nmId', 'sku', 'warehouseName', 'quantity',
    'inWayToClient', 'inWayFromClient', 'quantityFull'
  ],

  RAW_SALES: [
    'date', 'nmId', 'sku', 'warehouseName',
    'quantity', 'totalPrice', 'discountPercent',
    'spp', 'forPay', 'finishedPrice', 'saleID',
    'orderType', 'isReturn'
  ],

  RAW_ORDERS: [
    'date', 'nmId', 'sku', 'warehouseName',
    'quantity', 'totalPrice', 'orderID', 'isCancel'
  ],

  RAW_RETURNS: [
    'date', 'nmId', 'sku', 'warehouseName',
    'quantity', 'totalPrice', 'returnID'
  ],

  RAW_INBOUND: [
    'shipmentId', 'nmId', 'sku', 'quantity',
    'status', 'createdDate', 'expectedDate',
    'actualDate', 'source', 'notes'
  ],

  FACTS: [
    'nmId', 'sku', 'title',
    'stockWB', 'stockFulfillment', 'stockTotal',
    'inTransitToClient', 'inTransitFromClient',
    'sales3d', 'sales7d', 'sales12d', 'sales30d',
    'velocity3d', 'velocity7d', 'velocity12d', 'velocity30d',
    'velocityWeighted',
    'orders30d', 'delivered30d', 'buyoutRate',
    'returns30d', 'returnRate',
    'inboundQty', 'inboundDate',
    'lastUpdated'
  ],

  FORECAST: [
    'nmId', 'sku', 'title',
    'velocityWeighted', 'seasonalityMultiplier', 'adjustedVelocity',
    'accelerationFlag', 'accelerationRatio',
    'forecastDemand7d', 'forecastDemand14d', 'forecastDemand30d',
    'daysCover', 'oosDate',
    'lastUpdated'
  ],

  SIMULATION: [
    'nmId', 'sku'
    // + day1..day60 columns added dynamically
  ],

  PURCHASE: [
    'nmId', 'sku', 'title',
    'priority', 'action',
    'currentStock', 'daysCover', 'oosDate',
    'velocityPerDay', 'forecastDemand',
    'orderQty', 'orderDeadline',
    'costPerUnit', 'totalCost',
    'inboundQty', 'inboundDate',
    'leadTimeDays',
    'lastUpdated'
  ],

  DASHBOARD: [],  // built dynamically

  LOG: [
    'timestamp', 'level', 'source', 'message', 'details'
  ]
};

// ──────────────────────────────────────────────
// System Constants
// ──────────────────────────────────────────────

var SYSTEM = {
  VERSION: '1.0.0',
  LOG_RETENTION_DAYS: 30,
  MAX_ROWS_PER_WRITE: 5000,
  BATCH_SIZE: 500,
  DATE_FORMAT: 'yyyy-MM-dd',
  DATETIME_FORMAT: 'yyyy-MM-dd HH:mm:ss',
  TIMEZONE: 'Europe/Moscow'
};

# WB Replenishment System — Architecture

## System Layers

```
┌─────────────────────────────────────────────────┐
│              DASHBOARD (Google Sheet)            │
│  Summary │ Critical SKU │ Cash │ Overstock       │
├─────────────────────────────────────────────────┤
│           PURCHASE RECOMMENDATIONS              │
│  Priority │ Action │ Qty │ Deadline │ Budget     │
├─────────────────────────────────────────────────┤
│              SIMULATION ENGINE                   │
│  Day-by-day inventory projection (30d forward)  │
├─────────────────────────────────────────────────┤
│              FORECAST ENGINE                     │
│  Weighted avg sales │ Seasonality │ Acceleration │
├─────────────────────────────────────────────────┤
│              FACTS BUILDER                       │
│  Sales velocity │ Buyout │ Returns │ Stock       │
├─────────────────────────────────────────────────┤
│              DATA LAYER (RAW)                    │
│  WB API → Stocks, Orders, Sales, Inbound        │
├─────────────────────────────────────────────────┤
│              WB API CLIENT                       │
│  Retry │ Rate limit │ Pagination │ Logging       │
└─────────────────────────────────────────────────┘
```

## Data Flow

```
WB API ──→ RAW sheets ──→ FACTS ──→ FORECAST ──→ SIMULATION ──→ PURCHASE
                                        ↑              ↑
                                   SETTINGS        INBOUND
                                   MASTER          SETTINGS
```

## Google Sheets Structure

| Sheet | Purpose |
|-------|---------|
| MASTER | SKU catalog: nmId, title, category, costPrice, moq, supplier |
| SETTINGS | Lead times, target turnover, safety stock, seasonality multipliers |
| RAW_Stocks | Daily WB warehouse + fulfillment stocks snapshot |
| RAW_Sales | Daily sales data from WB API |
| RAW_Orders | Daily orders data from WB API |
| RAW_Returns | Returns data from WB API |
| RAW_Inbound | Inbound shipments (manual + API) |
| FACTS | Computed: sales velocity (3/7/12/30d), buyout rate, returns rate, current stock |
| FORECAST | Projected daily demand with seasonality and acceleration detection |
| SIMULATION | Day-by-day inventory model for 30 days forward |
| PURCHASE | Recommendations: priority, qty, deadline, budget |
| DASHBOARD | Summary KPIs, critical SKUs, cash requirement |
| LOG | System log: runs, errors, API calls |

## Apps Script Files

| File | Responsibility |
|------|----------------|
| Config.gs | API keys, sheet names, constants, lead time defaults |
| WbApi.gs | WB API client with retry, rate limiting, pagination |
| DataWriter.gs | Write raw API data to sheets, deduplication |
| FactsBuilder.gs | Compute sales velocity, buyout, returns, stock levels |
| ForecastEngine.gs | Weighted demand forecast, seasonality, acceleration guard |
| SimulationEngine.gs | Day-by-day inventory projection with inbound |
| PurchaseRecommendations.gs | Priority classification, order qty, deadlines, budget |
| DashboardBuilder.gs | Build summary dashboard with KPIs |
| SetupAndOps.gs | Sheet creation, triggers, health check, main orchestrator |

## Key Algorithms

1. **Sales Velocity**: Weighted average of 3d/7d/12d/30d with configurable weights
2. **Buyout Rate**: orders_delivered / orders_total over 30d window
3. **Acceleration Detection**: if 3d_avg > 7d_avg * 1.3 → flag, cap forecast
4. **Days Cover**: total_stock / daily_forecast
5. **OOS Date**: simulation day when stock hits 0
6. **Order Date**: OOS_date - total_lead_time
7. **Order Quantity**: daily_forecast * (lead_time + target_turnover + safety_days) - stock_on_hand - inbound

## Triggers

| Trigger | Schedule | Function |
|---------|----------|----------|
| Daily sync | 06:00 | runDailySync |
| Forecast refresh | 07:00 | runForecastAndSimulation |
| Health check | 08:00 | runHealthCheck |

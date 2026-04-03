/**
 * ============================================================
 * Warehouse KPI Dashboard — Executive Dashboard Builder
 * ============================================================
 * Creates the owner-facing dashboard with KPI cards, charts,
 * and vehicle repair vesting tracker.
 */

function buildDashboard_(ss) {
  var sheet = getOrCreateSheet_(ss, CONFIG.SHEETS.DASHBOARD);
  var KPI = CONFIG.SHEETS.KPI_MONTH;
  var Q = CONFIG.SHEETS.QUEUE;
  var T = CONFIG.SHEETS.TRIPS;

  // Hide gridlines for clean look
  sheet.setHiddenGridlines(true);

  // ── Title Row ──
  sheet.getRange('A1:L1').merge()
    .setValue('📊 Warehouse KPI Dashboard')
    .setFontSize(22)
    .setFontWeight('bold')
    .setFontColor(CONFIG.COLORS.HEADER_BG)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 55);

  // Subtitle with date
  sheet.getRange('A2:L2').merge()
    .setFormula('="Обновлено: "&TEXT(NOW(),"dd.MM.yyyy HH:mm")')
    .setFontSize(10)
    .setFontColor('#757575')
    .setHorizontalAlignment('center');
  sheet.setRowHeight(2, 25);

  // ══════════════════════════════════════════════════════════
  // KPI CARDS — Row 4-7
  // ══════════════════════════════════════════════════════════

  var cardRow = 4;
  var cards = [
    {
      col: 'A', mergeEnd: 'B',
      label: 'Разморожено за месяц',
      formula: "='" + KPI + "'!B4",
      format: CONFIG.FORMATS.CURRENCY,
      color: CONFIG.COLORS.ACCENT_GREEN
    },
    {
      col: 'C', mergeEnd: 'D',
      label: 'Остаток зависшего капитала',
      formula: "='" + KPI + "'!B5",
      format: CONFIG.FORMATS.CURRENCY,
      color: CONFIG.COLORS.ACCENT_RED
    },
    {
      col: 'E', mergeEnd: 'F',
      label: '% разморозки',
      formula: "='" + KPI + "'!B6",
      format: CONFIG.FORMATS.PERCENT,
      color: CONFIG.COLORS.ACCENT_BLUE
    },
    {
      col: 'G', mergeEnd: 'H',
      label: 'SLA клиентских кейсов',
      formula: "='" + KPI + "'!B19",
      format: CONFIG.FORMATS.PERCENT,
      color: CONFIG.COLORS.ACCENT_BLUE
    },
    {
      col: 'I', mergeEnd: 'J',
      label: 'Рейсов за месяц',
      formula: "='" + KPI + "'!B22",
      format: '#,##0',
      color: CONFIG.COLORS.HEADER_BG
    },
    {
      col: 'K', mergeEnd: 'L',
      label: 'Бонус сотрудника',
      formula: "='" + KPI + "'!B28",
      format: CONFIG.FORMATS.CURRENCY,
      color: CONFIG.COLORS.ACCENT_GREEN
    }
  ];

  cards.forEach(function(card) {
    var labelRange = sheet.getRange(card.col + cardRow + ':' + card.mergeEnd + cardRow);
    var valueRange = sheet.getRange(card.col + (cardRow + 1) + ':' + card.mergeEnd + (cardRow + 2));

    // Label
    labelRange.merge()
      .setValue(card.label)
      .setFontSize(9)
      .setFontWeight('bold')
      .setFontColor('#ffffff')
      .setBackground(card.color)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    // Value
    valueRange.merge()
      .setFormula(card.formula)
      .setFontSize(20)
      .setFontWeight('bold')
      .setFontColor(card.color)
      .setBackground(CONFIG.COLORS.CARD_BG)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setNumberFormat(card.format)
      .setBorder(true, true, true, true, false, false,
                 CONFIG.COLORS.CARD_BORDER, SpreadsheetApp.BorderStyle.SOLID);
  });

  sheet.setRowHeight(cardRow, 30);
  sheet.setRowHeight(cardRow + 1, 25);
  sheet.setRowHeight(cardRow + 2, 35);

  // ══════════════════════════════════════════════════════════
  // VEHICLE REPAIR VESTING — Row 8-12
  // ══════════════════════════════════════════════════════════

  var vestRow = 9;
  sheet.getRange('A' + vestRow + ':D' + vestRow).merge()
    .setValue('🚗 Vehicle Repair Vesting')
    .setFontSize(14)
    .setFontWeight('bold')
    .setFontColor(CONFIG.COLORS.HEADER_BG)
    .setHorizontalAlignment('left');

  var vestData = [
    ['Общая сумма ремонта:', CONFIG.VEHICLE.TOTAL, 'Ежемесячный вестинг:', CONFIG.VEHICLE.MONTHLY_VESTING],
    ['Успешных KPI месяцев:', '', 'Накоплено (vested):', ''],
    ['Остаток до полной оплаты:', '', 'Прогресс:', '']
  ];

  sheet.getRange(vestRow + 1, 1, vestData.length, 4).setValues(vestData);

  // Vehicle vesting formulas
  // Successful KPI months (manual entry or calculated from archive)
  sheet.getRange(vestRow + 2, 2).setValue(0).setNote('Введите количество успешных KPI месяцев');

  // Vested amount
  sheet.getRange(vestRow + 2, 4).setFormula(
    '=MIN(' + CONFIG.VEHICLE.TOTAL + ', B' + (vestRow + 2) + '*' + CONFIG.VEHICLE.MONTHLY_VESTING + ')'
  ).setNumberFormat(CONFIG.FORMATS.CURRENCY);

  // Remaining
  sheet.getRange(vestRow + 3, 2).setFormula(
    '=' + CONFIG.VEHICLE.TOTAL + '-D' + (vestRow + 2)
  ).setNumberFormat(CONFIG.FORMATS.CURRENCY);

  // Progress %
  sheet.getRange(vestRow + 3, 4).setFormula(
    '=D' + (vestRow + 2) + '/' + CONFIG.VEHICLE.TOTAL
  ).setNumberFormat(CONFIG.FORMATS.PERCENT);

  // Format vesting section
  sheet.getRange(vestRow + 1, 1).setNumberFormat(CONFIG.FORMATS.CURRENCY);
  sheet.getRange(vestRow + 1, 2).setNumberFormat(CONFIG.FORMATS.CURRENCY);
  sheet.getRange(vestRow + 1, 4).setNumberFormat(CONFIG.FORMATS.CURRENCY);

  [vestRow + 1, vestRow + 2, vestRow + 3].forEach(function(r) {
    sheet.getRange(r, 1).setFontWeight('bold');
    sheet.getRange(r, 3).setFontWeight('bold');
  });

  // ══════════════════════════════════════════════════════════
  // QUEUE STATUS SUMMARY — Row 14-20
  // ══════════════════════════════════════════════════════════

  var qRow = 14;
  sheet.getRange('A' + qRow + ':D' + qRow).merge()
    .setValue('📦 Статус очереди')
    .setFontSize(14)
    .setFontWeight('bold')
    .setFontColor(CONFIG.COLORS.HEADER_BG);

  var statusSummary = [
    ['Статус', 'Количество', 'Сумма себестоимости', '% от общего'],
    ['В очереди', '', '', ''],
    ['В работе', '', '', ''],
    ['Готов к продаже', '', '', ''],
    ['Отправлено на WB', '', '', ''],
    ['Невосстановимый', '', '', ''],
    ['ИТОГО', '', '', '']
  ];

  sheet.getRange(qRow + 1, 1, statusSummary.length, 4).setValues(statusSummary);

  // Status summary header
  sheet.getRange(qRow + 1, 1, 1, 4)
    .setBackground(CONFIG.COLORS.HEADER_BG)
    .setFontColor(CONFIG.COLORS.HEADER_FG)
    .setFontWeight('bold');

  // Formulas for each status
  CONFIG.STATUSES.forEach(function(status, i) {
    var row = qRow + 2 + i;
    sheet.getRange(row, 2).setFormula(
      "=COUNTIF('" + Q + "'!H2:H, \"" + status + "\")"
    );
    sheet.getRange(row, 3).setFormula(
      "=SUMPRODUCT(('" + Q + "'!H2:H=\"" + status + "\")*'" + Q + "'!G2:G)"
    ).setNumberFormat(CONFIG.FORMATS.CURRENCY);
    sheet.getRange(row, 4).setFormula(
      '=IF(B' + (qRow + 8) + '>0, B' + row + '/B' + (qRow + 8) + ', 0)'
    ).setNumberFormat(CONFIG.FORMATS.PERCENT);
  });

  // Totals
  var totalRow = qRow + 7;
  sheet.getRange(totalRow, 2).setFormula("=COUNTA('" + Q + "'!H2:H)");
  sheet.getRange(totalRow, 3).setFormula("=SUM('" + Q + "'!G2:G)").setNumberFormat(CONFIG.FORMATS.CURRENCY);
  sheet.getRange(totalRow, 4).setValue(1).setNumberFormat(CONFIG.FORMATS.PERCENT);
  sheet.getRange(totalRow, 1, 1, 4).setFontWeight('bold').setBackground('#e0e0e0');

  // ══════════════════════════════════════════════════════════
  // COLUMN WIDTHS
  // ══════════════════════════════════════════════════════════

  for (var c = 1; c <= 12; c++) {
    sheet.setColumnWidth(c, 130);
  }

  return sheet;
}

// ══════════════════════════════════════════════════════════════
// CHARTS
// ══════════════════════════════════════════════════════════════

function buildCharts_(ss) {
  var dashboard = ss.getSheetByName(CONFIG.SHEETS.DASHBOARD);
  var queue = ss.getSheetByName(CONFIG.SHEETS.QUEUE);
  var trips = ss.getSheetByName(CONFIG.SHEETS.TRIPS);

  // Remove existing charts
  dashboard.getCharts().forEach(function(chart) {
    dashboard.removeChart(chart);
  });

  // ── Chart 1: Queue Status Distribution (Pie) ──
  // Build from dashboard's status summary
  var statusRange = dashboard.getRange('A16:B20'); // status names and counts
  var chart1 = dashboard.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(statusRange)
    .setPosition(23, 1, 0, 0)
    .setOption('title', 'Распределение по статусам')
    .setOption('titleTextStyle', { fontSize: 12, bold: true })
    .setOption('pieHole', 0.4)
    .setOption('width', 480)
    .setOption('height', 300)
    .setOption('legend', { position: 'right' })
    .setOption('colors', ['#ffca28', '#42a5f5', '#66bb6a', '#26a69a', '#ef5350'])
    .build();
  dashboard.insertChart(chart1);

  // ── Chart 2: Age Distribution (Bar) ──
  // We'll create a helper data block for age buckets
  var ageRow = 23;
  var ageCol = 7;
  var ageBuckets = [
    ['Возрастная группа', 'Количество'],
    ['0-3 дня', '=COUNTIFS(\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,">="&0,\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,"<="&3)'],
    ['4-7 дней', '=COUNTIFS(\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,">="&4,\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,"<="&7)'],
    ['8-14 дней', '=COUNTIFS(\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,">="&8,\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,"<="&14)'],
    ['15-21 день', '=COUNTIFS(\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,">="&15,\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,"<="&21)'],
    ['22+ дней', '=COUNTIFS(\'' + CONFIG.SHEETS.QUEUE + '\'!N2:N,">="&22)']
  ];

  dashboard.getRange(ageRow, ageCol, ageBuckets.length, 2).setValues(ageBuckets);
  dashboard.getRange(ageRow, ageCol, 1, 2)
    .setFontWeight('bold')
    .setFontSize(9);

  var ageRange = dashboard.getRange(ageRow, ageCol, ageBuckets.length, 2);
  var chart2 = dashboard.newChart()
    .setChartType(Charts.ChartType.BAR)
    .addRange(ageRange)
    .setPosition(23, 5, 0, 0)
    .setOption('title', 'Возраст товаров в очереди')
    .setOption('titleTextStyle', { fontSize: 12, bold: true })
    .setOption('width', 480)
    .setOption('height', 300)
    .setOption('legend', { position: 'none' })
    .setOption('colors', ['#1565c0'])
    .setOption('hAxis', { title: 'Количество' })
    .build();
  dashboard.insertChart(chart2);

  // ── Chart 3: SLA Compliance (Gauge-style bar) ──
  var slaRow = 30;
  var slaData = [
    ['Метрика', 'Значение'],
    ['SLA 24h %', "='" + CONFIG.SHEETS.KPI_MONTH + "'!B11"],
    ['SLA 5d %', "='" + CONFIG.SHEETS.KPI_MONTH + "'!B14"],
    ['SLA клиентов %', "='" + CONFIG.SHEETS.KPI_MONTH + "'!B19"]
  ];

  dashboard.getRange(slaRow, 1, slaData.length, 2).setValues(slaData);
  dashboard.getRange(slaRow, 1, 1, 2).setFontWeight('bold');
  dashboard.getRange(slaRow + 1, 2, 3, 1).setNumberFormat(CONFIG.FORMATS.PERCENT);

  var slaRange = dashboard.getRange(slaRow, 1, slaData.length, 2);
  var chart3 = dashboard.newChart()
    .setChartType(Charts.ChartType.BAR)
    .addRange(slaRange)
    .setPosition(30, 1, 0, 0)
    .setOption('title', 'SLA Compliance')
    .setOption('titleTextStyle', { fontSize: 12, bold: true })
    .setOption('width', 480)
    .setOption('height', 250)
    .setOption('legend', { position: 'none' })
    .setOption('colors', ['#2e7d32'])
    .setOption('hAxis', { minValue: 0, maxValue: 1, format: '#%' })
    .build();
  dashboard.insertChart(chart3);

  // ── Chart 4: Trips Summary (from Trips sheet) ──
  var tripsRange = trips.getRange('A1:D' + Math.max(2, trips.getLastRow()));
  var chart4 = dashboard.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(trips.getRange('A1:A' + Math.max(2, trips.getLastRow())))
    .addRange(trips.getRange('D1:D' + Math.max(2, trips.getLastRow())))
    .setPosition(30, 5, 0, 0)
    .setOption('title', 'Загрузка рейсов (единиц)')
    .setOption('titleTextStyle', { fontSize: 12, bold: true })
    .setOption('width', 480)
    .setOption('height', 250)
    .setOption('legend', { position: 'none' })
    .setOption('colors', ['#1a237e'])
    .build();
  dashboard.insertChart(chart4);
}

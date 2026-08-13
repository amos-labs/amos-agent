const MAX_TABLE_ROWS = 100;
const MAX_TABLE_COLUMNS = 8;

export function spreadsheetArtifactCanvas({ spreadsheet, artifact, verification, preview, generatedAt }) {
  const timestamp = generatedAt || new Date().toISOString();
  const blocks = [{
    id: "spreadsheet-artifact",
    type: "spreadsheet",
    title: "Verified Excel workbook",
    artifact,
    verification,
    sheet_names: preview.sheetNames,
    checks: preview.checks.map((check) => ({
      label: check.label,
      passed: check.passed,
      required: check.required,
      note: check.note
    }))
  }];
  const table = tableBlock(preview.table);
  if (table) blocks.push(table);
  blocks.push(...preview.charts.slice(0, 4).map(chartBlock));
  return {
    version: "1",
    title: spreadsheet.title,
    subtitle: "Verified workbook · live preview of generated values",
    generated_at: timestamp,
    state: {
      kind: verification.requiredChecksPassed ? "ready" : "partial",
      message: verification.requiredChecksPassed
        ? "The workbook reopened successfully and all required checks passed."
        : "The workbook needs attention before use."
    },
    source: {
      kind: "local",
      label: "AMOS Desktop deterministic spreadsheet engine",
      refreshed_at: timestamp,
      references: [{
        type: "xlsx",
        id: artifact.sha256,
        label: artifact.path,
        observed_at: timestamp
      }]
    },
    blocks
  };
}

function tableBlock(table) {
  const rows = table?.rows?.slice(0, MAX_TABLE_ROWS) || [];
  if (rows.length === 0) return null;
  const width = Math.min(MAX_TABLE_COLUMNS, table.headers.length);
  return {
    id: "spreadsheet-table-preview",
    type: "table",
    title: `${table.sheet} preview`,
    searchable: true,
    columns: table.headers.slice(0, width).map((label, index) => ({
      key: `column_${index + 1}`,
      label,
      format: rows.some((row) => typeof row[index] === "number") ? "number" : "text"
    })),
    rows: rows.map((row) => Object.fromEntries(
      row.slice(0, width).map((value, index) => [`column_${index + 1}`, value])
    ))
  };
}

function chartBlock(chart, index) {
  return {
    id: `spreadsheet-chart-${index + 1}`,
    type: "timeseries",
    title: chart.title,
    x_label: "Period",
    y_label: chart.yUnit,
    series: chart.series.map((series) => ({
      name: series.name,
      points: series.values.map((value, valueIndex) => ({
        x: chart.categories[valueIndex] || String(valueIndex + 1),
        y: value
      }))
    }))
  };
}

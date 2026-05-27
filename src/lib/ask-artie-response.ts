type Confidence = "High" | "Medium" | "Low";

type DataTable = {
  columns: string[];
  rows: string[][];
};

type ResponseWidget = {
  type: "table" | "map" | "barChart";
  [key: string]: unknown;
};

export type AskArtieResponse = {
  whatTheDataSays: {
    summary: string;
    table: DataTable;
  };
  whatIdDoNext: string[];
  whyThisMatters: string;
  readinessDataGaps: {
    confidence: Confidence;
    notes: string[];
  };
  widgets?: ResponseWidget[];
};

const CONFIDENCE_VALUES = new Set<Confidence>(["High", "Medium", "Low"]);

export const ASK_ARTIE_RESPONSE_JSON_SCHEMA = `{
  "whatTheDataSays": {
    "summary": "One short paragraph naming the selected artist and data source when available.",
    "table": {
      "columns": ["Signal", "Value", "Source", "Implication"],
      "rows": [
        ["Observed metric or constraint", "Exact value or unavailable", "Context source", "Decision implication"]
      ]
    }
  },
  "whatIdDoNext": [
    "First concrete action",
    "Second concrete action",
    "Third concrete action"
  ],
  "whyThisMatters": "One short paragraph tying the recommendation to audience focus, conversion, release performance, touring, merch, or fan activation.",
  "readinessDataGaps": {
    "confidence": "High | Medium | Low",
    "notes": [
      "Missing data, unavailable connector, or assumption that affects the recommendation"
    ]
  },
  "widgets": [
    {
      "type": "map | barChart | table",
      "...": "Optional widget payload using the app-supported artie-widget schema"
    }
  ]
}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean);
}

function normalizeTable(value: unknown): DataTable | null {
  if (!isRecord(value) || !Array.isArray(value.columns) || !Array.isArray(value.rows)) {
    return null;
  }

  const columns = value.columns.map(asString).filter(Boolean);
  const rows = value.rows
    .filter(Array.isArray)
    .map((row) => (row as unknown[]).map(asString));

  if (!columns.length || !rows.length) return null;

  return {
    columns,
    rows: rows.map((row) => columns.map((_, index) => row[index] || "Not available")),
  };
}

function normalizeWidgets(value: unknown): ResponseWidget[] {
  if (!Array.isArray(value)) return [];

  return value.filter((widget): widget is ResponseWidget => {
    if (!isRecord(widget)) return false;
    if (widget.type === "table") return Array.isArray(widget.rows);
    if (widget.type === "map") return Array.isArray(widget.points);
    if (widget.type === "barChart") return Array.isArray(widget.data);
    return false;
  });
}

export function parseAskArtieResponse(raw: string): AskArtieResponse {
  const json = extractJson(raw);
  const parsed = JSON.parse(json) as unknown;
  if (!isRecord(parsed)) throw new Error("Response must be a JSON object");

  const whatTheDataSays = parsed.whatTheDataSays;
  if (!isRecord(whatTheDataSays)) throw new Error("Missing whatTheDataSays object");

  const summary = asString(whatTheDataSays.summary);
  const table = normalizeTable(whatTheDataSays.table);
  if (!summary) throw new Error("Missing whatTheDataSays.summary");
  if (!table) throw new Error("whatTheDataSays.table must include columns and at least one row");

  const whatIdDoNext = normalizeStringArray(parsed.whatIdDoNext);
  if (!whatIdDoNext.length) throw new Error("Missing whatIdDoNext actions");

  const whyThisMatters = asString(parsed.whyThisMatters);
  if (!whyThisMatters) throw new Error("Missing whyThisMatters");

  const readinessDataGaps = parsed.readinessDataGaps;
  if (!isRecord(readinessDataGaps)) throw new Error("Missing readinessDataGaps object");

  const confidence = asString(readinessDataGaps.confidence) as Confidence;
  if (!CONFIDENCE_VALUES.has(confidence)) {
    throw new Error("readinessDataGaps.confidence must be High, Medium, or Low");
  }

  const notes = normalizeStringArray(readinessDataGaps.notes);
  if (!notes.length) throw new Error("Missing readinessDataGaps.notes");

  return {
    whatTheDataSays: {
      summary,
      table,
    },
    whatIdDoNext,
    whyThisMatters,
    readinessDataGaps: {
      confidence,
      notes,
    },
    widgets: normalizeWidgets(parsed.widgets),
  };
}

export function renderAskArtieResponse(response: AskArtieResponse) {
  return [
    "## What the data says",
    "",
    response.whatTheDataSays.summary,
    "",
    renderMarkdownTable(response.whatTheDataSays.table),
    "",
    "## What I'd do next",
    "",
    response.whatIdDoNext.map((action) => `- ${action}`).join("\n"),
    "",
    "## Why this matters",
    "",
    response.whyThisMatters,
    "",
    "## Readiness / Data Gaps",
    "",
    `Confidence: ${response.readinessDataGaps.confidence}`,
    "",
    response.readinessDataGaps.notes.map((note) => `- ${note}`).join("\n"),
    "",
    ...(response.widgets?.flatMap((widget) => ["```artie-widget", JSON.stringify(widget), "```", ""]) ?? []),
  ]
    .join("\n")
    .trim();
}

function renderMarkdownTable(table: DataTable) {
  const header = `| ${table.columns.map(escapeMarkdownCell).join(" | ")} |`;
  const divider = `| ${table.columns.map(() => "---").join(" | ")} |`;
  const rows = table.rows.map((row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`);
  return [header, divider, ...rows].join("\n");
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim() || "Not available";
}

function extractJson(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
}

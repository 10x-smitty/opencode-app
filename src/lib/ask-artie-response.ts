type WidgetPlacement = "answer" | "why" | "recommend" | "expect";

export type MapKind = "markets" | "venues" | "routing" | "clusters";

type ResponseWidget = {
  type: "table" | "map" | "barChart";
  placement?: WidgetPlacement;
  [key: string]: unknown;
};

const MAP_KINDS = new Set<MapKind>(["markets", "venues", "routing", "clusters"]);

type Bullet = {
  emoji?: string;
  text: string;
};

export type WhyTable = {
  columns: string[];
  rows: string[][];
};

export type ResponseKind = "map" | "table" | "neither";

export type AskArtieResponse = {
  responseKind: ResponseKind;
  theAnswer: string;
  why: Bullet[];
  whatIRecommend: Bullet[];
  whatToExpect: Bullet[];
  methodology?: string;
  widgets?: ResponseWidget[];
  suggestions?: string[];
  whyTable?: WhyTable;
};

const RESPONSE_KINDS = new Set<ResponseKind>(["map", "table", "neither"]);

const WIDGET_PLACEMENTS = new Set<WidgetPlacement>([
  "answer",
  "why",
  "recommend",
  "expect",
]);

export const ASK_ARTIE_RESPONSE_JSON_SCHEMA = `{
  "responseKind": "map | table | neither — the evidence form this answer requires. CLASSIFY FIRST before generating any other field.",
  "theAnswer": "One short paragraph that states the recommendation directly. Name the artist and the primary city/market when relevant. No bullets — prose only.",
  "why": [
    { "text": "Lead evidence point with the strongest signal or number. No emoji — plain text only." },
    { "text": "Second supporting data point." },
    { "text": "Third supporting point — context, region, or history." }
  ],
  "whatIRecommend": [
    { "text": "Primary concrete action. No emoji — plain text only." },
    { "text": "Second concrete action." },
    { "text": "Third concrete action." }
  ],
  "whatToExpect": [
    { "text": "Expected outcome or performance signal. No emoji — plain text only." },
    { "text": "Risk, caveat, or follow-on decision to watch." }
  ],
  "methodology": "Optional one-sentence note on how the recommendation was measured. Renders as a small footer.",
  "widgets": [
    {
      "type": "map",
      "placement": "why",
      "mapKind": "markets | venues | routing | clusters — pick exactly one. 'markets' for audience/market geography across a region or country (3-8 curated top points). 'venues' for recommended venues/clubs/halls within a single city (3-8 points, map zooms to that city). 'routing' for tour plans where stop order matters (3-8 points, a line connects them in array order). 'clusters' when the question asks for the SHAPE of a distribution across many points (20-60 points; the map auto-groups overlapping points and reveals them on zoom).",
      "points": "Only used for WHERE/location/touring questions. Exactly one map widget, placement must be 'why'. Each point: { name, latitude, longitude, value?, label? }. Point count by mapKind: markets/venues/routing 3-8, clusters 20-60. For mapKind='routing' the array ORDER is the tour order — first item is stop #1. No other widget types are allowed."
    }
  ],
  "whyTable": {
    "columns": ["Column A", "Column B"],
    "rows": [
      ["Cell", "Cell"]
    ]
  },
  "suggestions": [
    "Short follow-up question the user might ask next (under 8 words).",
    "Second follow-up question, distinct from the first.",
    "Third follow-up question, optional."
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

function normalizeBullets(value: unknown): Bullet[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): Bullet | null => {
      if (typeof item === "string") {
        const text = item.trim();
        return text ? { text } : null;
      }
      if (!isRecord(item)) return null;
      const text = asString(item.text ?? item.point ?? item.description ?? item.value);
      if (!text) return null;
      const emoji = asString(item.emoji ?? item.icon);
      return emoji ? { emoji, text } : { text };
    })
    .filter((b): b is Bullet => Boolean(b));
}

function normalizeWidgets(value: unknown): ResponseWidget[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((widget): ResponseWidget | null => {
      if (!isRecord(widget)) return null;

      const placementRaw = asString(widget.placement) as WidgetPlacement;
      const placement = WIDGET_PLACEMENTS.has(placementRaw) ? placementRaw : "why";

      if (widget.type === "table" && Array.isArray(widget.rows)) {
        return { ...widget, type: "table", placement } as ResponseWidget;
      }
      if (widget.type === "map" && Array.isArray(widget.points)) {
        const mapKindRaw = asString(widget.mapKind) as MapKind;
        const mapKind: MapKind = MAP_KINDS.has(mapKindRaw) ? mapKindRaw : "markets";
        return { ...widget, type: "map", placement, mapKind } as ResponseWidget;
      }
      if (widget.type === "barChart" && Array.isArray(widget.data)) {
        return { ...widget, type: "barChart", placement } as ResponseWidget;
      }
      return null;
    })
    .filter((w): w is ResponseWidget => Boolean(w));
}

export function parseAskArtieResponse(raw: string): AskArtieResponse {
  const json = extractJson(raw);
  const parsed = JSON.parse(json) as unknown;
  if (!isRecord(parsed)) throw new Error("Response must be a JSON object");

  const responseKind = asString(parsed.responseKind) as ResponseKind;
  if (!RESPONSE_KINDS.has(responseKind)) {
    throw new Error("responseKind must be 'map', 'table', or 'neither'");
  }

  const theAnswer = asString(parsed.theAnswer);
  if (!theAnswer) throw new Error("Missing theAnswer paragraph");

  const why = normalizeBullets(parsed.why);
  if (!why.length) throw new Error("Missing why bullets");

  const whatIRecommend = normalizeBullets(parsed.whatIRecommend);
  if (!whatIRecommend.length) throw new Error("Missing whatIRecommend bullets");

  const whatToExpect = normalizeBullets(parsed.whatToExpect);
  if (!whatToExpect.length) throw new Error("Missing whatToExpect bullets");

  const methodology = asString(parsed.methodology);
  const suggestions = normalizeStringArray(parsed.suggestions).slice(0, 4);
  const whyTable = normalizeWhyTable(parsed.whyTable);

  return {
    responseKind,
    theAnswer,
    why,
    whatIRecommend,
    whatToExpect,
    methodology: methodology || undefined,
    widgets: normalizeWidgets(parsed.widgets),
    suggestions: suggestions.length ? suggestions : undefined,
    whyTable,
  };
}

function normalizeWhyTable(value: unknown): WhyTable | undefined {
  if (!isRecord(value)) return undefined;
  if (!Array.isArray(value.columns) || !Array.isArray(value.rows)) return undefined;

  const columns = value.columns.map(asString).filter(Boolean);
  if (!columns.length) return undefined;

  const rows = value.rows
    .filter(Array.isArray)
    .map((row) =>
      columns.map((_, index) => asString((row as unknown[])[index]) || "—"),
    );

  if (!rows.length) return undefined;

  return { columns, rows };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item));
}

export function renderAskArtieResponse(response: AskArtieResponse) {
  const widgetsByPlacement = (placement: WidgetPlacement) =>
    (response.widgets ?? []).filter((widget) => (widget.placement ?? "why") === placement);

  const renderBullets = (items: Bullet[]) =>
    items.map((b) => `- ${b.text}`).join("\n");

  const renderWidgets = (placement: WidgetPlacement) =>
    widgetsByPlacement(placement).flatMap((widget) => [
      "",
      "```artie-widget",
      JSON.stringify(widget),
      "```",
    ]);

  const renderWhyTable = () => {
    if (!response.whyTable) return [] as string[];
    const { columns, rows } = response.whyTable;
    const header = `| ${columns.map(escapeMarkdownCell).join(" | ")} |`;
    const divider = `| ${columns.map(() => "---").join(" | ")} |`;
    const body = rows.map((row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`);
    return ["", header, divider, ...body];
  };

  const lines: string[] = [
    "## 📍 The Answer",
    "",
    response.theAnswer,
    ...renderWidgets("answer"),
    "",
    "## 🔍 Why",
    "",
    renderBullets(response.why),
    ...renderWidgets("why"),
    ...renderWhyTable(),
    "",
    "## ✅ What I Recommend",
    "",
    renderBullets(response.whatIRecommend),
    ...renderWidgets("recommend"),
    "",
    "## 🔮 What to Expect",
    "",
    renderBullets(response.whatToExpect),
    ...renderWidgets("expect"),
  ];

  if (response.methodology) {
    lines.push("", "---", "", `_${response.methodology}_`);
  }

  if (response.suggestions?.length) {
    lines.push("", "```artie-suggestions", JSON.stringify(response.suggestions), "```");
  }

  return lines.join("\n").trim();
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim() || "—";
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

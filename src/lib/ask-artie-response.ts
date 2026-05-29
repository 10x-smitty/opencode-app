type WidgetPlacement = "answer" | "why" | "recommend" | "expect";

type ResponseWidget = {
  type: "table" | "map" | "barChart";
  placement?: WidgetPlacement;
  [key: string]: unknown;
};

type Bullet = {
  emoji?: string;
  text: string;
};

export type AskArtieResponse = {
  theAnswer: string;
  why: Bullet[];
  whatIRecommend: Bullet[];
  whatToExpect: Bullet[];
  methodology?: string;
  widgets?: ResponseWidget[];
  suggestions?: string[];
};

const WIDGET_PLACEMENTS = new Set<WidgetPlacement>([
  "answer",
  "why",
  "recommend",
  "expect",
]);

export const ASK_ARTIE_RESPONSE_JSON_SCHEMA = `{
  "theAnswer": "One short paragraph that states the recommendation directly. Name the artist and the primary city/market when relevant. No bullets — prose only.",
  "why": [
    { "emoji": "🎯", "text": "Lead evidence point with the strongest signal or number." },
    { "emoji": "📊", "text": "Second supporting data point." },
    { "emoji": "🌎", "text": "Third supporting point — context, region, or history." }
  ],
  "whatIRecommend": [
    { "emoji": "✅", "text": "Primary concrete action." },
    { "emoji": "🗺️", "text": "Second concrete action." },
    { "emoji": "🎯", "text": "Third concrete action." }
  ],
  "whatToExpect": [
    { "emoji": "📈", "text": "Expected outcome or performance signal." },
    { "emoji": "🎯", "text": "Risk, caveat, or follow-on decision to watch." }
  ],
  "methodology": "Optional one-sentence note on how the recommendation was measured. Renders as a small footer.",
  "widgets": [
    {
      "type": "map | barChart | table",
      "placement": "answer | why | recommend | expect",
      "...": "Widget payload using the app-supported artie-widget schema. The placement field controls which section the widget renders inside."
    }
  ],
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
        return { ...widget, type: "map", placement } as ResponseWidget;
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

  return {
    theAnswer,
    why,
    whatIRecommend,
    whatToExpect,
    methodology: methodology || undefined,
    widgets: normalizeWidgets(parsed.widgets),
    suggestions: suggestions.length ? suggestions : undefined,
  };
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
    items.map((b) => `- ${b.emoji ? `${b.emoji} ` : ""}${b.text}`).join("\n");

  const renderWidgets = (placement: WidgetPlacement) =>
    widgetsByPlacement(placement).flatMap((widget) => [
      "",
      "```artie-widget",
      JSON.stringify(widget),
      "```",
    ]);

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

function extractJson(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
}

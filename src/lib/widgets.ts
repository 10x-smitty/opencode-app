import type { ArtieWidget } from "@/components/ResponseWidgets";

export type MessageSegment =
  | {
      type: "markdown";
      content: string;
    }
  | {
      type: "widget";
      widget: ArtieWidget;
      raw: string;
    };

const WIDGET_BLOCK_RE =
  /```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```|<(?:artie-widget|ask-artie-widget)>\s*([\s\S]*?)\s*<\/(?:artie-widget|ask-artie-widget)>/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeWidget(value: unknown): ArtieWidget | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  if (value.type === "table") {
    return Array.isArray(value.rows) ? (value as ArtieWidget) : null;
  }

  if (value.type === "map") {
    const sourcePoints = Array.isArray(value.points)
      ? value.points
      : Array.isArray(value.locations)
        ? value.locations
        : Array.isArray(value.markers)
          ? value.markers
          : null;

    if (!sourcePoints) return null;

    return {
      ...value,
      type: "map",
      points: sourcePoints.map((point, index) => {
        if (!isRecord(point)) {
          return {
            name: `Location ${index + 1}`,
            latitude: Number.NaN,
            longitude: Number.NaN,
          };
        }

        return {
          name: String(
            point.name ?? point.city ?? point.market ?? point.location ?? `Location ${index + 1}`,
          ),
          latitude: point.latitude ?? point.lat ?? point.y ?? Number.NaN,
          longitude: point.longitude ?? point.lng ?? point.lon ?? point.long ?? point.x ?? Number.NaN,
          value: point.value ?? point.signal ?? point.metric ?? point.score,
          label: point.label ?? point.description ?? point.reason ?? point.note,
        };
      }),
    } as ArtieWidget;
  }

  if (value.type === "barChart") {
    return Array.isArray(value.data) ? (value as ArtieWidget) : null;
  }

  return null;
}

export function splitMessageWidgets(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let cursor = 0;

  for (const match of content.matchAll(WIDGET_BLOCK_RE)) {
    const fullMatch = match[0];
    const language = (match[1] ?? "").toLowerCase();
    const json = match[2] ?? match[3];
    const index = match.index ?? 0;
    const canContainWidget =
      Boolean(match[3]) ||
      language === "artie-widget" ||
      language === "ask-artie-widget" ||
      language === "json" ||
      language === "";

    if (index > cursor) {
      segments.push({
        type: "markdown",
        content: content.slice(cursor, index),
      });
    }

    try {
      if (!canContainWidget) throw new Error("Not a widget fence");
      const parsed = JSON.parse(json) as unknown;
      const widget = normalizeWidget(parsed);
      if (!widget) throw new Error("Unsupported widget schema");

      segments.push({
        type: "widget",
        widget,
        raw: fullMatch,
      });
    } catch {
      segments.push({
        type: "markdown",
        content: fullMatch,
      });
    }

    cursor = index + fullMatch.length;
  }

  if (cursor < content.length) {
    segments.push({
      type: "markdown",
      content: content.slice(cursor),
    });
  }

  return segments.filter((segment) => segment.type === "widget" || segment.content.trim());
}

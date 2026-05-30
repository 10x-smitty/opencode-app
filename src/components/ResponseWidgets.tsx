"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import {
  Map,
  MapClusterLayer,
  MapControls,
  MapMarker,
  MapPopup,
  MapRoute,
  MarkerContent,
  MarkerLabel,
  MarkerPopup,
} from "@/components/ui/map";
import { Info, TrendingUp } from "lucide-react";

type WidgetColumn = {
  key: string;
  label?: string;
};

type WidgetRow = Record<string, string | number | null | undefined>;

type SortState = {
  key: string;
  direction: "asc" | "desc";
};

type TableWidget = {
  type: "table";
  title?: string;
  description?: string;
  columns?: WidgetColumn[];
  rows: WidgetRow[];
};

type MapPoint = {
  name: string;
  latitude: number | string;
  longitude: number | string;
  value?: number | string;
  label?: string;
};

type MapKind = "markets" | "venues" | "routing" | "clusters";

type MapWidget = {
  type: "map";
  title?: string;
  description?: string;
  mapKind?: MapKind;
  points: MapPoint[];
};

const POINT_NOUN: Record<MapKind, string> = {
  markets: "Market",
  venues: "Venue",
  routing: "Stop",
  clusters: "Location",
};

// Per-kind accent: markers, route line, and popup TrendingUp icon.
// Clusters use the mapcn default density palette, so no entry needed.
const MAP_KIND_COLOR: Record<Exclude<MapKind, "clusters">, string> = {
  markets: "#fbbf24", // amber-400
  venues: "#ef4444", // red-500
  routing: "#3b82f6", // blue-500
};

type ClusterPointProperties = {
  name: string;
  index: number;
  value?: string | number;
  label?: string;
  /** Numeric fan count for this market — used as the per-point aggregation source. */
  fans: number;
};

type ChartDatum = {
  label: string;
  value: number;
};

type BarChartWidget = {
  type: "barChart";
  title?: string;
  description?: string;
  xLabel?: string;
  yLabel?: string;
  data: ChartDatum[];
};

export type ArtieWidget = TableWidget | MapWidget | BarChartWidget;

type ValidMapPoint = MapPoint & {
  latitude: number;
  longitude: number;
  numericValue: number;
};

function formatCell(value: unknown) {
  if (typeof value === "number") return value.toLocaleString();
  return String(value ?? "");
}

function numericPointValue(point: MapPoint) {
  if (typeof point.value === "number") return Number.isFinite(point.value) ? point.value : 1;
  if (typeof point.value !== "string") return 1;

  const match = point.value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?\s*k?/i);
  if (!match) return 1;

  const parsed = Number.parseFloat(match[0]);
  if (!Number.isFinite(parsed)) return 1;

  return /k/i.test(match[0]) ? parsed * 1000 : parsed;
}

function toFiniteCoordinate(value: number | string) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMapPoint(point: MapPoint): ValidMapPoint | null {
  const latitude = toFiniteCoordinate(point.latitude);
  const longitude = toFiniteCoordinate(point.longitude);

  if (
    latitude === null ||
    longitude === null ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }

  return {
    ...point,
    latitude,
    longitude,
    numericValue: numericPointValue(point),
  };
}

function compareValues(a: unknown, b: unknown) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function WidgetFrame({
  title,
  description,
  className,
  children,
}: {
  title?: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={["artie-widget", className].filter(Boolean).join(" ")}>
      {title || description ? (
        <header className="artie-widget-header">
          {title ? <h3>{title}</h3> : null}
          {description ? <p>{description}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

function DataTableWidget({ widget }: { widget: TableWidget }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);
  const columns = useMemo(() => {
    if (widget.columns?.length) return widget.columns;
    const keys = new Set<string>();
    widget.rows.forEach((row) => Object.keys(row).forEach((key) => keys.add(key)));
    return Array.from(keys).map((key) => ({ key, label: key }));
  }, [widget.columns, widget.rows]);
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const rows = normalizedQuery
      ? widget.rows.filter((row) =>
          columns.some((column) =>
            String(row[column.key] ?? "").toLowerCase().includes(normalizedQuery),
          ),
        )
      : widget.rows;

    if (!sort) return rows;

    return [...rows].sort((left, right) => {
      const result = compareValues(left[sort.key], right[sort.key]);
      return sort.direction === "asc" ? result : -result;
    });
  }, [columns, query, sort, widget.rows]);

  function toggleSort(key: string) {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }

  return (
    <WidgetFrame title={widget.title} description={widget.description}>
      <div className="artie-table-toolbar">
        <input
          aria-label={`Filter ${widget.title ?? "table"}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter rows..."
        />
        <span>
          {filteredRows.length} of {widget.rows.length}
        </span>
      </div>
      <div className="artie-table-scroll">
        <table className="artie-data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>
                  <button type="button" onClick={() => toggleSort(column.key)}>
                    <span>{column.label ?? column.key}</span>
                    <span aria-hidden="true">
                      {sort?.key === column.key ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => (
                  <td key={column.key}>{formatCell(row[column.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </WidgetFrame>
  );
}

function PointPopupBody({
  pointNoun,
  index,
  name,
  value,
  label,
  accentColor,
}: {
  pointNoun: string;
  index: number;
  name: string;
  value?: string | number;
  label?: string;
  accentColor: string;
}) {
  return (
    <div className="space-y-2 p-3">
      <div>
        <p className="text-muted-foreground pb-0.5 text-[11px] font-medium tracking-wide uppercase">
          {pointNoun} #{index + 1}
        </p>
        <h3 className="text-foreground leading-tight font-semibold">{name}</h3>
      </div>
      {value !== undefined && value !== "" ? (
        <div className="flex items-center gap-1.5 text-sm">
          <TrendingUp className="size-3.5" style={{ color: accentColor }} />
          <span className="font-medium">{formatCell(value)}</span>
        </div>
      ) : null}
      {label ? (
        <div className="text-muted-foreground flex items-start gap-1.5 text-sm">
          <Info className="size-3.5 mt-0.5 shrink-0" />
          <span>{label}</span>
        </div>
      ) : null}
    </div>
  );
}

function DataMapWidget({ widget }: { widget: MapWidget }) {
  const mapKind: MapKind =
    widget.mapKind && widget.mapKind in POINT_NOUN ? widget.mapKind : "markets";
  const pointNoun = POINT_NOUN[mapKind];
  const accentColor =
    mapKind === "clusters" ? MAP_KIND_COLOR.markets : MAP_KIND_COLOR[mapKind];

  const validPoints = useMemo<ValidMapPoint[]>(
    () =>
      widget.points
        .map(normalizeMapPoint)
        .filter((point): point is ValidMapPoint => Boolean(point)),
    [widget.points],
  );

  const routeCoordinates = useMemo<[number, number][]>(() => {
    if (mapKind !== "routing" || validPoints.length < 2) return [];
    return validPoints.map((point) => [point.longitude, point.latitude]);
  }, [mapKind, validPoints]);

  const clusterFeatures = useMemo<
    GeoJSON.FeatureCollection<GeoJSON.Point, ClusterPointProperties> | null
  >(() => {
    if (mapKind !== "clusters") return null;
    return {
      type: "FeatureCollection",
      features: validPoints.map((point, index) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
        properties: {
          name: point.name,
          index,
          value: typeof point.value === "string" || typeof point.value === "number"
            ? point.value
            : undefined,
          label: point.label,
          fans: Math.max(0, Math.round(point.numericValue)) || 0,
        },
      })),
    };
  }, [mapKind, validPoints]);

  const [selectedClusterPoint, setSelectedClusterPoint] = useState<{
    coordinates: [number, number];
    properties: ClusterPointProperties;
  } | null>(null);

  const mapInit = useMemo(() => {
    if (!validPoints.length) {
      return { center: [-98.35, 39.5] as [number, number], zoom: 3 };
    }

    if (validPoints.length === 1) {
      const only = validPoints[0];
      const soloZoom = mapKind === "venues" ? 12 : 6;
      return { center: [only.longitude, only.latitude] as [number, number], zoom: soloZoom };
    }

    const latExtent = d3.extent(validPoints, (point) => point.latitude);
    const lonExtent = d3.extent(validPoints, (point) => point.longitude);
    const minLat = latExtent[0] ?? 0;
    const maxLat = latExtent[1] ?? 0;
    const minLon = lonExtent[0] ?? 0;
    const maxLon = lonExtent[1] ?? 0;

    // Venues sit in one city; allow tighter zoom so streets are legible.
    // Clusters keep a lower ceiling so initial view stays clustered.
    let maxZoom = 8;
    if (mapKind === "venues") maxZoom = 13;
    if (mapKind === "clusters") maxZoom = 6;

    return {
      bounds: [
        [minLon, minLat],
        [maxLon, maxLat],
      ] as [[number, number], [number, number]],
      fitBoundsOptions: { padding: 56, maxZoom },
    };
  }, [mapKind, validPoints]);

  return (
    <WidgetFrame title={widget.title} description={widget.description} className="artie-map-widget">
      {validPoints.length ? (
        <div className="artie-map">
          <Map theme="dark" cooperativeGestures className="h-full w-full" {...mapInit}>
            <MapControls />

            {mapKind === "clusters" && clusterFeatures ? (
              <>
                <MapClusterLayer<ClusterPointProperties>
                  data={clusterFeatures}
                  clusterRadius={0}
                  clusterThresholds={[50_000, 500_000]}
                  pointSizeProperty="fans"
                  pointRadii={[18, 28, 40]}
                  pointThresholds={[50_000, 500_000]}
                  pointColors={["#22c55e", "#eab308", "#ef4444"]}
                  pointLabel={[
                    "case",
                    [">=", ["get", "fans"], 1_000_000],
                    [
                      "concat",
                      [
                        "to-string",
                        ["/", ["floor", ["/", ["get", "fans"], 100_000]], 10],
                      ],
                      "M",
                    ],
                    [">=", ["get", "fans"], 1_000],
                    [
                      "concat",
                      ["to-string", ["floor", ["/", ["get", "fans"], 1_000]]],
                      "K",
                    ],
                    ["to-string", ["get", "fans"]],
                  ]}
                  onPointClick={(feature, coordinates) => {
                    const properties = feature.properties;
                    if (!properties) return;
                    setSelectedClusterPoint({
                      coordinates: coordinates as [number, number],
                      properties,
                    });
                  }}
                />
                {selectedClusterPoint ? (
                  <MapPopup
                    longitude={selectedClusterPoint.coordinates[0]}
                    latitude={selectedClusterPoint.coordinates[1]}
                    closeButton
                    onClose={() => setSelectedClusterPoint(null)}
                    className="w-64 p-0"
                  >
                    <PointPopupBody
                      pointNoun={pointNoun}
                      index={selectedClusterPoint.properties.index}
                      name={selectedClusterPoint.properties.name}
                      value={selectedClusterPoint.properties.value}
                      label={selectedClusterPoint.properties.label}
                      accentColor={accentColor}
                    />
                  </MapPopup>
                ) : null}
              </>
            ) : (
              <>
                {routeCoordinates.length >= 2 ? (
                  <MapRoute
                    coordinates={routeCoordinates}
                    color={accentColor}
                    width={3}
                    opacity={0.9}
                    dashArray={[2, 2]}
                    interactive={false}
                  />
                ) : null}
                {validPoints.map((point, index) => (
                  <MapMarker
                    key={`${point.name}-marker-${index}`}
                    longitude={point.longitude}
                    latitude={point.latitude}
                  >
                    <MarkerContent>
                      <div
                        className="border-white relative flex size-5 cursor-pointer items-center justify-center rounded-full border-2 text-[10px] font-semibold text-white shadow-lg transition-transform hover:scale-110"
                        style={{ backgroundColor: accentColor }}
                      >
                        {mapKind === "routing" ? index + 1 : null}
                      </div>
                      <MarkerLabel position="bottom">{point.name}</MarkerLabel>
                    </MarkerContent>
                    <MarkerPopup className="w-64 p-0">
                      <PointPopupBody
                        pointNoun={pointNoun}
                        index={index}
                        name={point.name}
                        value={point.value}
                        label={point.label}
                        accentColor={accentColor}
                      />
                    </MarkerPopup>
                  </MapMarker>
                ))}
              </>
            )}
          </Map>
        </div>
      ) : (
        <div className="artie-map-empty">
          No valid coordinates were provided for this map.
        </div>
      )}
    </WidgetFrame>
  );
}

function BarChartWidget({ widget }: { widget: BarChartWidget }) {
  const width = 760;
  const height = Math.max(240, widget.data.length * 38 + 72);
  const margin = { top: 16, right: 28, bottom: 34, left: 150 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const maxValue = d3.max(widget.data, (item) => item.value) ?? 0;
  const x = d3.scaleLinear().domain([0, maxValue]).range([0, innerWidth]).nice();
  const y = d3
    .scaleBand()
    .domain(widget.data.map((item) => item.label))
    .range([0, innerHeight])
    .padding(0.22);
  const ticks = x.ticks(4);

  return (
    <WidgetFrame title={widget.title} description={widget.description}>
      <div className="artie-chart-scroll">
        <svg
          className="artie-bar-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={widget.title ?? "Bar chart"}
        >
          <g transform={`translate(${margin.left},${margin.top})`}>
            {ticks.map((tick) => (
              <g key={tick} transform={`translate(${x(tick)},0)`}>
                <line y2={innerHeight} className="artie-chart-grid" />
                <text y={innerHeight + 22} textAnchor="middle" className="artie-chart-tick">
                  {tick.toLocaleString()}
                </text>
              </g>
            ))}
            {widget.data.map((item) => {
              const barY = y(item.label) ?? 0;
              return (
                <g key={item.label} transform={`translate(0,${barY})`}>
                  <text x={-12} y={(y.bandwidth() / 2) + 4} textAnchor="end" className="artie-chart-label">
                    {item.label}
                  </text>
                  <rect width={x(item.value)} height={y.bandwidth()} rx={5} className="artie-chart-bar" />
                  <text x={x(item.value) + 8} y={(y.bandwidth() / 2) + 4} className="artie-chart-value">
                    {item.value.toLocaleString()}
                  </text>
                </g>
              );
            })}
            {widget.xLabel ? (
              <text x={innerWidth / 2} y={innerHeight + 33} textAnchor="middle" className="artie-chart-axis-label">
                {widget.xLabel}
              </text>
            ) : null}
          </g>
        </svg>
      </div>
    </WidgetFrame>
  );
}

export function ResponseWidget({ widget }: { widget: ArtieWidget }) {
  if (widget.type === "table") return <DataTableWidget widget={widget} />;
  if (widget.type === "map") return <DataMapWidget widget={widget} />;
  if (widget.type === "barChart") return <BarChartWidget widget={widget} />;
  return null;
}

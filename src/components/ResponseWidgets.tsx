"use client";

import type { FeatureCollection, Point } from "geojson";
import type { StyleSpecification } from "maplibre-gl";
import { useMemo, useState } from "react";
import * as d3 from "d3";
import Map, { Layer, NavigationControl, Popup, Source } from "react-map-gl/maplibre";
import type { LayerProps, MapLayerMouseEvent } from "react-map-gl/maplibre";

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

type MapWidget = {
  type: "map";
  title?: string;
  description?: string;
  points: MapPoint[];
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

type WeightedMapPoint = MapPoint & {
  latitude: number;
  longitude: number;
  numericValue: number;
  heatmapWeight: number;
};

type ProjectedMapPoint = WeightedMapPoint & {
  xPercent: number;
  yPercent: number;
};

const MAP_STYLE = {
  version: 8,
  sources: {
    "carto-dark": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#111413",
      },
    },
    {
      id: "carto-dark",
      type: "raster",
      source: "carto-dark",
      minzoom: 0,
      maxzoom: 18,
    },
  ],
} satisfies StyleSpecification;
const HEATMAP_SOURCE_ID = "artie-heatmap-points";
const HEATMAP_POINT_LAYER_ID = "artie-heatmap-click-targets";

const heatmapLayer: LayerProps = {
  id: "artie-heatmap-density",
  type: "heatmap",
  source: HEATMAP_SOURCE_ID,
  maxzoom: 9,
  paint: {
    "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 0, 0.15, 1, 2.25],
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1.05, 3, 1.9, 7, 2.85],
    "heatmap-color": [
      "interpolate",
      ["linear"],
      ["heatmap-density"],
      0,
      "rgba(85, 198, 223, 0)",
      0.06,
      "rgba(85, 198, 223, 0.48)",
      0.16,
      "rgba(145, 221, 255, 0.82)",
      0.28,
      "rgba(255, 255, 238, 0.92)",
      0.42,
      "rgba(255, 193, 92, 0.98)",
      1,
      "rgba(255, 118, 96, 1)",
    ],
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 20, 3, 34, 6, 58],
    "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 2, 0.96, 9, 0.62],
  },
};

const heatmapClickLayer: LayerProps = {
  id: HEATMAP_POINT_LAYER_ID,
  type: "circle",
  source: HEATMAP_SOURCE_ID,
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["get", "weight"], 0, 2, 0.55, 4, 1, 9],
    "circle-color": [
      "interpolate",
      ["linear"],
      ["get", "weight"],
      0,
      "#78d8ff",
      0.5,
      "#f9ffff",
      0.72,
      "#ffd06a",
      1,
      "#ffab4a",
    ],
    "circle-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.74, 5, 0.88],
    "circle-stroke-color": "#f7ffff",
    "circle-stroke-opacity": 0.7,
    "circle-stroke-width": 1,
    "circle-blur": 0.16,
  },
};

function formatCell(value: unknown) {
  if (typeof value === "number") return value.toLocaleString();
  return String(value ?? "");
}

function numericPointValue(point: MapPoint) {
  if (typeof point.value === "number") return point.value;

  const source = String(point.value ?? point.label ?? "");
  const match = source.replace(/,/g, "").match(/-?\d+(?:\.\d+)?\s*k?/i);
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

function normalizeMapPoint(point: MapPoint): WeightedMapPoint | null {
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
    heatmapWeight: 0.8,
  };
}

function mercatorY(latitude: number) {
  const clamped = Math.max(-85, Math.min(85, latitude));
  const radians = (clamped * Math.PI) / 180;
  return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
}

function projectMapPoints(points: WeightedMapPoint[]): ProjectedMapPoint[] {
  if (!points.length) return [];

  const rawPoints = points.map((point) => ({
    point,
    x: (point.longitude + 180) / 360,
    y: mercatorY(point.latitude),
  }));
  const xExtent = d3.extent(rawPoints, (item) => item.x);
  const yExtent = d3.extent(rawPoints, (item) => item.y);
  const minX = xExtent[0] ?? 0;
  const maxX = xExtent[1] ?? minX;
  const minY = yExtent[0] ?? 0;
  const maxY = yExtent[1] ?? minY;
  const xSpread = maxX - minX;
  const ySpread = maxY - minY;

  return rawPoints.map(({ point, x, y }) => ({
    ...point,
    xPercent: xSpread === 0 ? 50 : 8 + ((x - minX) / xSpread) * 84,
    yPercent: ySpread === 0 ? 50 : 8 + ((y - minY) / ySpread) * 84,
  }));
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

function DataMapWidget({ widget }: { widget: MapWidget }) {
  const [selectedPointName, setSelectedPointName] = useState<string | null>(null);
  const validPoints = useMemo(
    () =>
      widget.points
        .map(normalizeMapPoint)
        .filter((point): point is WeightedMapPoint => Boolean(point)),
    [widget.points],
  );
  const valuedPoints = useMemo<WeightedMapPoint[]>(() => {
    const maxValue = d3.max(validPoints, (point) => point.numericValue) ?? 1;
    const minValue = d3.min(validPoints, (point) => point.numericValue) ?? 0;
    const weightScale =
      minValue === maxValue
        ? () => 0.8
        : d3.scaleSqrt().domain([minValue, maxValue]).range([0.18, 1]);

    return validPoints.map((point) => ({
      ...point,
      heatmapWeight: weightScale(point.numericValue),
    }));
  }, [validPoints]);

  const geoJson = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: valuedPoints.map((point) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [point.longitude, point.latitude],
        },
        properties: {
          name: point.name,
          value: point.value ?? "",
          label: point.label ?? "",
          metric: point.numericValue,
          weight: point.heatmapWeight,
        },
      })),
    }),
    [valuedPoints],
  );

  const initialViewState = useMemo(() => {
    if (!validPoints.length) {
      return { latitude: 39.5, longitude: -98.35, zoom: 3 };
    }

    const lat = d3.mean(validPoints, (point) => point.latitude) ?? 39.5;
    const lon = d3.mean(validPoints, (point) => point.longitude) ?? -98.35;
    const latExtent = d3.extent(validPoints, (point) => point.latitude);
    const lonExtent = d3.extent(validPoints, (point) => point.longitude);
    const latSpread = (latExtent[1] ?? lat) - (latExtent[0] ?? lat);
    const lonSpread = (lonExtent[1] ?? lon) - (lonExtent[0] ?? lon);
    const spread = Math.max(Math.abs(latSpread), Math.abs(lonSpread));
    const zoom =
      validPoints.length === 1 ? 7 : spread > 65 ? 2.3 : spread > 42 ? 2.8 : spread > 24 ? 3.4 : 4.4;

    return { latitude: lat, longitude: lon, zoom };
  }, [validPoints]);

  const selectedPoint =
    valuedPoints.find((point) => point.name === selectedPointName) ?? null;
  const projectedPoints = useMemo(() => projectMapPoints(valuedPoints), [valuedPoints]);

  function handleMapClick(event: MapLayerMouseEvent) {
    const feature = event.features?.[0];
    const name = feature?.properties?.name;
    if (typeof name === "string") {
      setSelectedPointName(name);
    }
  }

  return (
    <WidgetFrame title={widget.title} description={widget.description} className="artie-map-widget">
      <div className="artie-map-layout">
        {valuedPoints.length ? (
          <>
            <div className="artie-map">
              <div className="artie-map-overlay" aria-hidden="true">
                <svg className="artie-map-overlay-base" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path d="M10 72 C24 54 34 62 47 42 C58 25 72 34 90 16" />
                  <path d="M8 20 H92 M8 40 H92 M8 60 H92 M8 80 H92" />
                  <path d="M20 8 V92 M40 8 V92 M60 8 V92 M80 8 V92" />
                  {projectedPoints.length > 1 ? (
                    <polyline
                      points={projectedPoints
                        .map((point) => `${point.xPercent},${point.yPercent}`)
                        .join(" ")}
                    />
                  ) : null}
                </svg>
              </div>
              <Map
                initialViewState={initialViewState}
                mapStyle={MAP_STYLE}
                style={{ width: "100%", height: "100%" }}
                attributionControl={false}
                cooperativeGestures
                interactiveLayerIds={[HEATMAP_POINT_LAYER_ID]}
                onClick={handleMapClick}
              >
                <NavigationControl position="top-right" showCompass={false} />
                <Source id={HEATMAP_SOURCE_ID} type="geojson" data={geoJson}>
                  <Layer {...heatmapLayer} />
                  <Layer {...heatmapClickLayer} />
                </Source>
                {selectedPoint ? (
                  <Popup
                    latitude={selectedPoint.latitude}
                    longitude={selectedPoint.longitude}
                    anchor="top"
                    closeButton
                    closeOnClick={false}
                    onClose={() => setSelectedPointName(null)}
                    offset={28}
                  >
                    <div className="artie-map-popup">
                      <strong>{selectedPoint.name}</strong>
                      {selectedPoint.value !== undefined ? <span>{formatCell(selectedPoint.value)}</span> : null}
                      {selectedPoint.label ? <p>{selectedPoint.label}</p> : null}
                    </div>
                  </Popup>
                ) : null}
              </Map>
              <div className="artie-map-pin-layer">
                {projectedPoints.map((point, index) => (
                  <button
                    key={`${point.name}-overlay-${index}`}
                    type="button"
                    className="artie-map-marker artie-map-marker-overlay"
                    style={{
                      left: `${point.xPercent}%`,
                      top: `${point.yPercent}%`,
                    }}
                    aria-label={`Show ${point.name}`}
                    onClick={() => setSelectedPointName(point.name)}
                  >
                    <span>{index + 1}</span>
                  </button>
                ))}
              </div>
            </div>
            <ol className="artie-map-list" aria-label={`${widget.title ?? "Map"} locations`}>
              {valuedPoints.map((point, index) => (
                <li key={`${point.name}-list-${index}`}>
                  <button type="button" onClick={() => setSelectedPointName(point.name)}>
                    <span>{index + 1}</span>
                    <strong>{point.name}</strong>
                    {point.value !== undefined ? <em>{formatCell(point.value)}</em> : null}
                    {point.label ? <small>{point.label}</small> : null}
                  </button>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="artie-map-empty">
            No valid coordinates were provided for this map.
          </div>
        )}
      </div>
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

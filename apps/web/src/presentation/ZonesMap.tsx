import L from "leaflet";
import { type JSX, useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Zone } from "../api/zones.ts";
import { buildMarkerIcon } from "./leafletIcon.ts";

interface ZonesMapProps {
  zones: Zone[];
  /** Zona seleccionada (resalta su marcador / abre su popup). */
  selectedZoneId: string | null;
  /** Color de marcador por zona (hex), segun su urgencia mas alta. */
  markerColorByZoneId: Record<string, string>;
  /** Color por defecto cuando una zona no tiene necesidades cargadas. */
  defaultMarkerColor: string;
  onSelectZone: (zoneId: string) => void;
}

// Centro y zoom por defecto: Venezuela. Leaflet no necesita API key (OSM).
const VENEZUELA_CENTER: [number, number] = [8.0, -66.0];
const DEFAULT_ZOOM = 6;
const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Zona con coordenadas garantizadas (no null). */
type LocatedZone = Zone & { lat: number; lng: number };

function hasCoords(zone: Zone): zone is LocatedZone {
  return typeof zone.lat === "number" && typeof zone.lng === "number";
}

// Componente de presentacion del mapa Leaflet (OpenStreetMap, sin API key).
//
// Renderiza el mapa de forma IMPERATIVA dentro de un useEffect porque Leaflet
// manipula el DOM directamente. En tests (jsdom) Leaflet no pinta; esos tests
// mockean "leaflet" o prueban el contenedor, no este render real (ver tests).
export function ZonesMap({
  zones,
  selectedZoneId,
  markerColorByZoneId,
  defaultMarkerColor,
  onSelectZone,
}: ZonesMapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(
    new globalThis.Map<string, L.Marker>(),
  );
  // Mantener el callback en un ref para no recrear el efecto en cada render.
  const onSelectRef = useRef(onSelectZone);
  onSelectRef.current = onSelectZone;

  // Crea el mapa una sola vez al montar y lo destruye al desmontar.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const map = L.map(node).setView(VENEZUELA_CENTER, DEFAULT_ZOOM);
    L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, []);

  // Sincroniza los marcadores con las zonas y sus colores de urgencia.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const markers = markersRef.current;
    for (const marker of markers.values()) {
      marker.remove();
    }
    markers.clear();

    const located = zones.filter(hasCoords);
    for (const zone of located) {
      const color = markerColorByZoneId[zone.id] ?? defaultMarkerColor;
      const marker = L.marker([zone.lat, zone.lng], {
        icon: buildMarkerIcon(color),
        title: zone.nombre,
        alt: zone.nombre,
      });
      marker.bindPopup(zone.nombre);
      marker.on("click", () => {
        onSelectRef.current(zone.id);
      });
      marker.addTo(map);
      markers.set(zone.id, marker);
    }

    // Encuadra el mapa a las zonas localizadas si las hay.
    if (located.length > 0) {
      const bounds = L.latLngBounds(
        located.map((zone) => [zone.lat, zone.lng] as [number, number]),
      );
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 9 });
    }
  }, [zones, markerColorByZoneId, defaultMarkerColor]);

  // Abre el popup de la zona seleccionada.
  useEffect(() => {
    if (!selectedZoneId) {
      return;
    }
    const marker = markersRef.current.get(selectedZoneId);
    marker?.openPopup();
  }, [selectedZoneId]);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Mapa de zonas afectadas"
      className="h-[420px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
    />
  );
}

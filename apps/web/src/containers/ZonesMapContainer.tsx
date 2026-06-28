import { type JSX, useEffect, useRef, useState } from "react";
import { fetchNeeds, fetchZones, type Need, type Zone } from "../api/zones.ts";
import { StatusMessage } from "../presentation/StatusMessage.tsx";
import { ZonePanel, type NeedsState } from "../presentation/ZonePanel.tsx";
import { ZonesMap } from "../presentation/ZonesMap.tsx";
import {
  URGENCIA_MARKER_COLOR,
  URGENCIA_ORDER,
} from "../presentation/zonesLabels.ts";

// Estado de la carga de zonas como union discriminada.
type ZonesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; zones: Zone[] }
  | { status: "error"; message: string };

const ZONES_ERROR =
  "No pudimos cargar el mapa de zonas. Revisa tu conexion e intentalo de nuevo en unos momentos.";
const NEEDS_ERROR =
  "No pudimos cargar las necesidades de esta zona. Intentalo de nuevo en unos momentos.";

// Color por defecto del marcador cuando aun no conocemos la urgencia de la zona.
const DEFAULT_MARKER_COLOR = "#4f46e5"; // indigo-600

/** Color del marcador segun la necesidad mas urgente de la zona. */
function highestUrgencyColor(needs: Need[]): string | null {
  let best: Need | null = null;
  for (const need of needs) {
    if (best === null || URGENCIA_ORDER[need.urgencia] > URGENCIA_ORDER[best.urgencia]) {
      best = need;
    }
  }
  return best ? URGENCIA_MARKER_COLOR[best.urgencia] : null;
}

// CONTENEDOR del mapa: unico componente con estado y fetch. Carga las zonas al
// montar, gestiona la zona seleccionada y carga sus necesidades bajo demanda.
export function ZonesMapContainer(): JSX.Element {
  const [zonesState, setZonesState] = useState<ZonesState>({ status: "idle" });
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [needsState, setNeedsState] = useState<NeedsState>({ status: "idle" });
  // Color de marcador ya conocido por zona (se llena al cargar sus necesidades).
  const [markerColorByZoneId, setMarkerColorByZoneId] = useState<
    Record<string, string>
  >({});

  const needsAbortRef = useRef<AbortController | null>(null);

  // Carga las zonas una vez al montar.
  useEffect(() => {
    const controller = new AbortController();
    setZonesState({ status: "loading" });

    fetchZones({ signal: controller.signal })
      .then((zones) => {
        setZonesState({ status: "success", zones });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setZonesState({ status: "error", message: ZONES_ERROR });
      });

    return () => {
      controller.abort();
    };
  }, []);

  function handleSelectZone(zoneId: string): void {
    setSelectedZoneId(zoneId);

    needsAbortRef.current?.abort();
    const controller = new AbortController();
    needsAbortRef.current = controller;

    setNeedsState({ status: "loading" });

    fetchNeeds(zoneId, { signal: controller.signal })
      .then((needs) => {
        setNeedsState({ status: "success", needs });
        const color = highestUrgencyColor(needs);
        if (color) {
          setMarkerColorByZoneId((prev) => ({ ...prev, [zoneId]: color }));
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setNeedsState({ status: "error", message: NEEDS_ERROR });
      });
  }

  if (zonesState.status === "idle" || zonesState.status === "loading") {
    return <StatusMessage tone="info" title="Cargando el mapa de zonas..." />;
  }

  if (zonesState.status === "error") {
    return <StatusMessage tone="error" title={zonesState.message} />;
  }

  const zones = zonesState.zones;
  const selectedZone =
    zones.find((zone) => zone.id === selectedZoneId) ?? null;
  const sinUbicacion = zones.filter(
    (zone) => zone.lat === null || zone.lng === null,
  );

  return (
    <div className="flex flex-col gap-6">
      {zones.length === 0 ? (
        <StatusMessage
          tone="info"
          title="Todavia no hay zonas registradas."
          detail="En cuanto los voluntarios reporten zonas, apareceran aqui."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ZonesMap
              zones={zones}
              selectedZoneId={selectedZoneId}
              markerColorByZoneId={markerColorByZoneId}
              defaultMarkerColor={DEFAULT_MARKER_COLOR}
              onSelectZone={handleSelectZone}
            />
            {sinUbicacion.length > 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                {sinUbicacion.length === 1
                  ? "1 zona aun sin ubicacion en el mapa."
                  : `${sinUbicacion.length} zonas aun sin ubicacion en el mapa.`}
              </p>
            ) : null}
          </div>

          <aside className="lg:col-span-1">
            <ZonePanel zone={selectedZone} needsState={needsState} />
          </aside>
        </div>
      )}
    </div>
  );
}

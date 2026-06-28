import type { JSX } from "react";
import type { Need, Zone } from "../api/zones.ts";
import { NeedsList } from "./NeedsList.tsx";
import { StatusMessage } from "./StatusMessage.tsx";

// Estado de carga de las necesidades de la zona seleccionada.
export type NeedsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; needs: Need[] }
  | { status: "error"; message: string };

interface ZonePanelProps {
  /** Zona seleccionada en el mapa; null si aun no se ha elegido ninguna. */
  zone: Zone | null;
  needsState: NeedsState;
}

// Panel lateral del mapa (componente de presentacion PURO): muestra la zona
// seleccionada y el estado de sus necesidades. No conoce red ni estado global.
export function ZonePanel({ zone, needsState }: ZonePanelProps): JSX.Element {
  if (!zone) {
    return (
      <StatusMessage
        tone="info"
        title="Selecciona una zona en el mapa."
        detail="Te mostraremos sus necesidades y su nivel de urgencia."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-slate-900">{zone.nombre}</h3>
        {zone.estado ? (
          <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-300">
            Estado: {zone.estado}
          </span>
        ) : null}
      </header>

      {needsState.status === "loading" ? (
        <StatusMessage tone="info" title="Cargando necesidades..." />
      ) : null}

      {needsState.status === "error" ? (
        <StatusMessage tone="error" title={needsState.message} />
      ) : null}

      {needsState.status === "success" && needsState.needs.length === 0 ? (
        <StatusMessage
          tone="info"
          title="Esta zona no tiene necesidades registradas todavia."
        />
      ) : null}

      {needsState.status === "success" && needsState.needs.length > 0 ? (
        <NeedsList needs={needsState.needs} />
      ) : null}
    </div>
  );
}

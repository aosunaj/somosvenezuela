import type { JSX } from "react";
import type { Need } from "../api/zones.ts";
import { URGENCIA_BADGE_CLASS, URGENCIA_LABEL } from "./zonesLabels.ts";

interface NeedsListProps {
  needs: Need[];
}

// Lista de necesidades de una zona (componente de presentacion PURO).
// Cada necesidad muestra su tipo, urgencia (con color) y descripcion.
export function NeedsList({ needs }: NeedsListProps): JSX.Element {
  const total = needs.length;
  return (
    <section aria-label="Necesidades de la zona">
      <p className="mb-3 text-sm text-slate-600">
        {total === 1
          ? "1 necesidad registrada"
          : `${total} necesidades registradas`}
      </p>
      <ul className="flex flex-col gap-3">
        {needs.map((need) => (
          <li
            key={need.id}
            className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <h4 className="font-medium text-slate-900">{need.tipo}</h4>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${URGENCIA_BADGE_CLASS[need.urgencia]}`}
                aria-label={`Urgencia ${URGENCIA_LABEL[need.urgencia]}`}
              >
                {URGENCIA_LABEL[need.urgencia]}
              </span>
            </div>
            {need.descripcion ? (
              <p className="text-sm text-slate-700">{need.descripcion}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

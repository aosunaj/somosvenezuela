import type { JSX } from "react";
import type { SearchResult } from "../api/search.ts";
import {
  ESTADO_BADGE_CLASS,
  ESTADO_LABEL,
  FUENTE_LABEL,
  VERIFICACION_BADGE_CLASS,
  VERIFICACION_LABEL,
  formatEdad,
  scoreToPercent,
} from "./labels.ts";

interface PersonCardProps {
  person: SearchResult;
}

// Tarjeta de un resultado de busqueda (componente de presentacion PURO).
//
// PRIVACIDAD: renderiza SOLO campos de la vista publica (PublicPerson) + score.
// Nunca lee ni muestra contact_id, telefono ni dato de contacto: ese campo no
// existe en el tipo SearchResult.
export function PersonCard({ person }: PersonCardProps): JSX.Element {
  const nombreCompleto = [person.nombre, person.apellidos]
    .filter((parte): parte is string => Boolean(parte))
    .join(" ");
  const porcentaje = scoreToPercent(person.score);

  return (
    <li>
      <article
        className="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        aria-label={`Resultado: ${nombreCompleto}`}
      >
        <header className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">
            {nombreCompleto}
          </h3>
          <span
            className="shrink-0 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-medium text-indigo-900 ring-1 ring-indigo-300"
            aria-label={`Coincidencia del ${porcentaje} por ciento`}
          >
            {porcentaje}% de coincidencia
          </span>
        </header>

        <dl className="grid grid-cols-1 gap-1 text-sm text-slate-700">
          <div className="flex gap-1">
            <dt className="font-medium text-slate-500">Edad:</dt>
            <dd>{formatEdad(person.edad)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium text-slate-500">Zona:</dt>
            <dd>{person.zona ?? "No indicada"}</dd>
          </div>
        </dl>

        {person.descripcion ? (
          <p className="text-sm text-slate-700">{person.descripcion}</p>
        ) : null}

        <footer className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${ESTADO_BADGE_CLASS[person.estado]}`}
          >
            {ESTADO_LABEL[person.estado]}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${VERIFICACION_BADGE_CLASS[person.verificacion]}`}
          >
            {VERIFICACION_LABEL[person.verificacion]}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-300">
            Fuente: {FUENTE_LABEL[person.fuente]}
          </span>
        </footer>
      </article>
    </li>
  );
}

import type { JSX } from "react";
import type { PetSearchResult } from "../api/searchPets.ts";
import {
  ESTADO_BADGE_CLASS,
  ESTADO_LABEL,
  FUENTE_LABEL,
  VERIFICACION_BADGE_CLASS,
  VERIFICACION_LABEL,
  scoreToPercent,
} from "./labels.ts";

interface PetCardProps {
  pet: PetSearchResult;
}

// Tarjeta de un resultado de busqueda de mascota (componente de presentacion PURO).
//
// PRIVACIDAD: renderiza SOLO campos de la vista publica (PublicPet) + score.
// Nunca lee ni muestra contact_id ni dato de contacto: ese campo no existe en el
// tipo PetSearchResult.
export function PetCard({ pet }: PetCardProps): JSX.Element {
  const titulo = pet.nombre ?? "Mascota sin nombre";
  const porcentaje = scoreToPercent(pet.score);

  return (
    <li>
      <article
        className="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        aria-label={`Resultado: ${titulo}`}
      >
        <header className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">{titulo}</h3>
          <span
            className="shrink-0 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-medium text-indigo-900 ring-1 ring-indigo-300"
            aria-label={`Coincidencia del ${porcentaje} por ciento`}
          >
            {porcentaje}% de coincidencia
          </span>
        </header>

        <dl className="grid grid-cols-1 gap-1 text-sm text-slate-700">
          <div className="flex gap-1">
            <dt className="font-medium text-slate-500">Tipo:</dt>
            <dd>{pet.tipo ?? "No indicado"}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium text-slate-500">Raza:</dt>
            <dd>{pet.raza ?? "No indicada"}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium text-slate-500">Zona:</dt>
            <dd>{pet.zona ?? "No indicada"}</dd>
          </div>
        </dl>

        <footer className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${ESTADO_BADGE_CLASS[pet.estado]}`}
          >
            {ESTADO_LABEL[pet.estado]}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${VERIFICACION_BADGE_CLASS[pet.verificacion]}`}
          >
            {VERIFICACION_LABEL[pet.verificacion]}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-300">
            Fuente: {FUENTE_LABEL[pet.fuente]}
          </span>
        </footer>
      </article>
    </li>
  );
}

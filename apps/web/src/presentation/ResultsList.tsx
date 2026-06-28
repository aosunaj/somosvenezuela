import type { JSX } from "react";
import type { SearchResult } from "../api/search.ts";
import { PersonCard } from "./PersonCard.tsx";

interface ResultsListProps {
  results: SearchResult[];
}

// Lista de resultados de busqueda (componente de presentacion PURO).
export function ResultsList({ results }: ResultsListProps): JSX.Element {
  const total = results.length;
  return (
    <section aria-label="Resultados de la busqueda">
      <p className="mb-3 text-sm text-slate-600">
        {total === 1
          ? "1 coincidencia encontrada"
          : `${total} coincidencias encontradas`}
      </p>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((person) => (
          <PersonCard key={person.id} person={person} />
        ))}
      </ul>
    </section>
  );
}

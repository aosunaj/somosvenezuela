import type { JSX } from "react";
import type { PetSearchResult } from "../api/searchPets.ts";
import { PetCard } from "./PetCard.tsx";

interface PetsListProps {
  results: PetSearchResult[];
}

// Lista de resultados de busqueda de mascotas (componente de presentacion PURO).
export function PetsList({ results }: PetsListProps): JSX.Element {
  const total = results.length;
  return (
    <section aria-label="Resultados de la busqueda de mascotas">
      <p className="mb-3 text-sm text-slate-600">
        {total === 1
          ? "1 coincidencia encontrada"
          : `${total} coincidencias encontradas`}
      </p>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((pet) => (
          <PetCard key={pet.id} pet={pet} />
        ))}
      </ul>
    </section>
  );
}

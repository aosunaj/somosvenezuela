import { type JSX, useRef, useState } from "react";
import { searchPets, type PetSearchResult } from "../api/searchPets.ts";
import { PetSearchForm } from "../presentation/PetSearchForm.tsx";
import { PetsList } from "../presentation/PetsList.tsx";
import { StatusMessage } from "../presentation/StatusMessage.tsx";

// Estado de la busqueda como union discriminada: la UI siempre cubre todos los casos.
type PetsSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; results: PetSearchResult[] }
  | { status: "error"; message: string };

const ERROR_MESSAGE =
  "No pudimos completar la busqueda. Revisa tu conexion e intentalo de nuevo en unos momentos.";

// CONTENEDOR: unico componente que conoce el fetch y el estado. Orquesta los
// componentes de presentacion (PetSearchForm, PetsList, StatusMessage).
export function PetsSearchContainer(): JSX.Element {
  const [q, setQ] = useState("");
  const [zona, setZona] = useState("");
  const [state, setState] = useState<PetsSearchState>({ status: "idle" });

  // Cancela la peticion anterior si el usuario lanza otra busqueda.
  const abortRef = useRef<AbortController | null>(null);

  async function handleSubmit(): Promise<void> {
    const termino = q.trim();
    if (termino.length === 0) {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: "loading" });

    try {
      const zonaTrim = zona.trim();
      const results = await searchPets(
        zonaTrim.length > 0 ? { q: termino, zona: zonaTrim } : { q: termino },
        { signal: controller.signal },
      );
      setState({ status: "success", results });
    } catch (error) {
      // Una cancelacion intencional no es un error que mostrar al usuario.
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setState({ status: "error", message: ERROR_MESSAGE });
    }
  }

  const loading = state.status === "loading";

  return (
    <div className="flex flex-col gap-6">
      <PetSearchForm
        q={q}
        zona={zona}
        loading={loading}
        onChangeQ={setQ}
        onChangeZona={setZona}
        onSubmit={() => {
          void handleSubmit();
        }}
      />

      {state.status === "idle" ? (
        <StatusMessage
          tone="info"
          title="Escribe un nombre, un tipo o una raza para empezar a buscar."
          detail="Puedes anadir una zona para acotar los resultados."
        />
      ) : null}

      {state.status === "loading" ? (
        <StatusMessage tone="info" title="Buscando coincidencias..." />
      ) : null}

      {state.status === "error" ? (
        <StatusMessage tone="error" title={state.message} />
      ) : null}

      {state.status === "success" && state.results.length === 0 ? (
        <StatusMessage
          tone="info"
          title="No encontramos coincidencias todavia."
          detail="Prueba con otro nombre, un tipo distinto o sin filtrar por zona. Seguimos sumando reportes cada dia."
        />
      ) : null}

      {state.status === "success" && state.results.length > 0 ? (
        <PetsList results={state.results} />
      ) : null}
    </div>
  );
}

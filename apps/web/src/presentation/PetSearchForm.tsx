import type { JSX } from "react";

interface PetSearchFormProps {
  /** Valor actual del termino de busqueda. */
  q: string;
  /** Valor actual del filtro de zona. */
  zona: string;
  /** Indica si hay una busqueda en curso (deshabilita el envio). */
  loading: boolean;
  onChangeQ: (value: string) => void;
  onChangeZona: (value: string) => void;
  onSubmit: () => void;
}

// Formulario de busqueda de mascotas (componente de presentacion PURO).
// No conoce el fetch ni el estado: solo emite eventos hacia el contenedor.
// Usa ids propios (pet-search-*) para no colisionar con el formulario de personas.
export function PetSearchForm({
  q,
  zona,
  loading,
  onChangeQ,
  onChangeZona,
  onSubmit,
}: PetSearchFormProps): JSX.Element {
  const disabled = loading || q.trim().length === 0;

  return (
    <form
      className="flex flex-col gap-4 sm:flex-row sm:items-end"
      aria-label="Buscar mascotas perdidas"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex-1">
        <label
          htmlFor="pet-search-q"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Nombre, tipo o raza
        </label>
        <input
          id="pet-search-q"
          name="q"
          type="search"
          autoComplete="off"
          required
          value={q}
          onChange={(event) => onChangeQ(event.target.value)}
          placeholder="Ej.: Luna, perro, mestizo..."
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
        />
      </div>

      <div className="sm:w-56">
        <label
          htmlFor="pet-search-zona"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Zona <span className="font-normal text-slate-400">(opcional)</span>
        </label>
        <input
          id="pet-search-zona"
          name="zona"
          type="text"
          autoComplete="off"
          value={zona}
          onChange={(event) => onChangeZona(event.target.value)}
          placeholder="Ej.: Caracas, Valencia..."
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
        />
      </div>

      <button
        type="submit"
        disabled={disabled}
        className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white transition hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-300 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {loading ? "Buscando..." : "Buscar"}
      </button>
    </form>
  );
}

import type { JSX } from "react";
import { SearchContainer } from "./containers/SearchContainer.tsx";

// Shell de la aplicacion: cabecera con la identidad del proyecto, el contenedor
// de busqueda y un pie con la promesa de privacidad. Tono calido y digno.
export function App(): JSX.Element {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <p className="text-sm font-semibold tracking-wide text-indigo-700">
            SomosVenezuela
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">
            Buscar a personas desaparecidas
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Una red de solidaridad para reunir a las familias tras el terremoto.
            Escribe un nombre o una descripcion y te mostramos las coincidencias.
          </p>
          <p className="mt-3 text-sm font-medium text-indigo-700">
            Nadie se queda atras.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <SearchContainer />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-slate-500">
          <p>
            Por la seguridad de todas las personas, nunca mostramos datos de
            contacto. Si reconoces a alguien, las entidades de ayuda gestionan el
            reencuentro de forma segura.
          </p>
        </div>
      </footer>
    </div>
  );
}

import type { JSX } from "react";
// CAMBIO (Fase 5/6): la web ahora ofrece tres vistas (personas, mascotas, mapa).
// MainView mantiene la navegacion por pestanas y monta el contenedor de cada
// seccion; antes aqui se montaba SearchContainer directamente.
import { MainView } from "./containers/MainView.tsx";

// Shell de la aplicacion: cabecera con la identidad del proyecto, las vistas
// principales (busqueda de personas/mascotas y mapa) y un pie con la promesa de
// privacidad. Tono calido y digno.
export function App(): JSX.Element {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <p className="text-sm font-semibold tracking-wide text-indigo-700">
            SomosVenezuela
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">
            Buscamos a quienes faltan y reunimos a las familias
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Una red de solidaridad para reunir a las familias tras el terremoto.
            Busca personas o mascotas y consulta el mapa de zonas y necesidades.
          </p>
          <p className="mt-3 text-sm font-medium text-indigo-700">
            Nadie se queda atras.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <MainView />
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

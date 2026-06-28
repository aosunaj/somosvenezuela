import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchContainer } from "../containers/SearchContainer.tsx";
import type { SearchResult } from "../api/search.ts";

// Datos SINTETICOS (sin PII real) — ver guardrail #1.
const personaSintetica: SearchResult = {
  id: "11111111-1111-4111-8111-111111111111",
  nombre: "Ana",
  apellidos: "Perez Lopez",
  edad: 34,
  zona: "Caracas",
  descripcion: "Llevaba una chaqueta verde el dia del sismo.",
  foto_url: null,
  estado: "desaparecida",
  fuente: "propia",
  verificacion: "sin_verificar",
  created_at: "2026-06-20T10:00:00.000Z",
  updated_at: "2026-06-20T10:00:00.000Z",
  score: 0.87,
};

/** Stubea fetch para que resuelva con un { results } dado. */
function mockFetchOk(results: unknown): void {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ results }),
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
}

/** Escribe q (y zona opcional) y dispara la busqueda. */
function buscar(q: string, zona?: string): void {
  fireEvent.change(screen.getByLabelText(/nombre o descripcion/i), {
    target: { value: q },
  });
  if (zona !== undefined) {
    fireEvent.change(screen.getByLabelText(/zona/i), {
      target: { value: zona },
    });
  }
  fireEvent.click(screen.getByRole("button", { name: /buscar/i }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SearchContainer", () => {
  it("muestra el estado inicial antes de buscar", () => {
    render(<SearchContainer />);
    expect(
      screen.getByText(/escribe un nombre o una descripcion/i),
    ).toBeInTheDocument();
  });

  it("llama a GET /search con q y zona y renderiza los resultados", async () => {
    mockFetchOk([personaSintetica]);

    render(<SearchContainer />);
    buscar("Ana", "Caracas");

    // Renderiza el resultado.
    expect(await screen.findByText("Ana Perez Lopez")).toBeInTheDocument();
    expect(screen.getByText(/87% de coincidencia/i)).toBeInTheDocument();
    expect(screen.getByText(/Desaparecida/i)).toBeInTheDocument();
    expect(screen.getByText(/Sin verificar/i)).toBeInTheDocument();
    expect(screen.getByText(/Reporte propio/i)).toBeInTheDocument();

    // Llamo al endpoint correcto con los parametros correctos.
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("http://localhost:3000/search");
    expect(calledUrl).toContain("q=Ana");
    expect(calledUrl).toContain("zona=Caracas");
  });

  it("muestra el estado sin resultados cuando la lista viene vacia", async () => {
    mockFetchOk([]);

    render(<SearchContainer />);
    buscar("Zzz");

    expect(
      await screen.findByText(/no encontramos coincidencias/i),
    ).toBeInTheDocument();
  });

  it("muestra un mensaje de error amable cuando la peticion falla", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    render(<SearchContainer />);
    buscar("Ana");

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(/no pudimos completar la busqueda/i);
  });

  it("muestra un mensaje de error amable cuando el backend responde con error HTTP", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(<SearchContainer />);
    buscar("Ana");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("CONTRATO DE PRIVACIDAD: nunca renderiza contact_id ni telefono aunque lleguen por error", async () => {
    // Inyecto a proposito campos de contacto que la UI NO debe mostrar nunca.
    const conContacto = {
      ...personaSintetica,
      contact_id: "99999999-9999-4999-8999-999999999999",
      telefono: "+58-412-5551234",
      contacto: "+58-412-5551234",
    };
    mockFetchOk([conContacto]);

    const { container } = render(<SearchContainer />);
    buscar("Ana");

    // La tarjeta se renderiza...
    expect(await screen.findByText("Ana Perez Lopez")).toBeInTheDocument();

    // ...pero el contacto NO aparece en ninguna parte del DOM.
    const texto = container.textContent ?? "";
    expect(texto).not.toContain("99999999-9999-4999-8999-999999999999");
    expect(texto).not.toContain("+58-412-5551234");
    expect(texto).not.toMatch(/tel[eé]fono/i);
    expect(texto).not.toMatch(/contacto/i);
  });
});

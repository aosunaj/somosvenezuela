import { describe, expect, it } from "vitest";
import { BUTTON } from "core";
import { handleUpdate, type UpdateDeps } from "../src/handle-update.js";
import { InMemorySessionStore } from "../src/session-store.js";
import {
  FakeBackend,
  FakeTransport,
  publicPersonFixture,
  SYNTH_CONTACT_ID,
  SYNTH_WA_ID,
  textUpdate,
} from "./fakes.js";

// Pruebas del adaptador de WhatsApp con dobles en memoria (sin red ni token).
// Verifican que reutiliza la MISMA maquina de `core`: orquestacion
// maquina<->efectos<->backend, persistencia de estado por usuario (wa_id), contrato de
// privacidad y manejo de errores del backend. Espejo de los tests del bot de Telegram.

const WA = SYNTH_WA_ID;

/** Arma deps frescas con backend configurable. */
function makeDeps(backend: FakeBackend): {
  deps: UpdateDeps;
  transport: FakeTransport;
  sessions: InMemorySessionStore;
} {
  const transport = new FakeTransport();
  const sessions = new InMemorySessionStore();
  return { deps: { transport, backend, sessions }, transport, sessions };
}

/** Envia una secuencia de textos como webhooks al mismo usuario. */
async function send(deps: UpdateDeps, waId: string, ...texts: string[]): Promise<void> {
  for (const text of texts) {
    await handleUpdate(textUpdate(waId, text), deps);
  }
}

describe("registro end-to-end", () => {
  it("recorre el flujo, pide cada dato y al confirmar llama a createPerson con los datos correctos", async () => {
    const backend = new FakeBackend();
    const { deps, transport } = makeDeps(backend);

    // Recorrido completo: menu -> registrar -> nombre -> resto omitido -> confirmar.
    await send(
      deps,
      WA,
      BUTTON.registrar, // inicia el flujo de registro
      "Maria Sintetica", // nombre
      BUTTON.omitir, // apellidos
      "34", // edad valida
      BUTTON.omitir, // zona
      BUTTON.omitir, // descripcion
      BUTTON.confirmar, // confirma -> dispara create_person
    );

    // El bot pidio cada dato en orden (verificamos por fragmentos de los prompts).
    const conversation = transport.allText();
    expect(conversation).toContain("nombre");
    expect(conversation).toContain("edad");
    expect(conversation).toContain("zona");
    expect(conversation).toContain("Revisa los datos antes de guardar");

    // Llamo a createPerson exactamente una vez, con los datos correctos y SIN contacto.
    expect(backend.createCalls).toHaveLength(1);
    const data = backend.createCalls[0]?.data as Record<string, unknown>;
    expect(data["nombre"]).toBe("Maria Sintetica");
    expect(data["edad"]).toBe(34);
    expect(data["fuente"]).toBe("propia");
    expect("contact_id" in data).toBe(false);

    // El ultimo mensaje confirma el registro.
    expect(transport.allText()).toContain("Registrado");
  });
});

describe("busqueda", () => {
  it("llama a searchPersons con la query y envia los resultados publicos", async () => {
    const backend = new FakeBackend({
      searchResults: [
        publicPersonFixture({ nombre: "Jose Sintetico", zona: "Zona Sur", score: 0.9 }),
      ],
    });
    const { deps, transport } = makeDeps(backend);

    await send(deps, WA, BUTTON.buscar, "Jose");

    // El backend recibio la query (sin contacto en el flujo).
    expect(backend.searchCalls).toHaveLength(1);
    expect(backend.searchCalls[0]?.query).toBe("Jose");

    // Los resultados se mostraron con campos publicos.
    const conversation = transport.allText();
    expect(conversation).toContain("Jose Sintetico");
    expect(conversation).toContain("Zona Sur");
    expect(conversation).toContain("similitud: 90%");
  });

  it("muestra el mensaje de sin resultados cuando el backend no devuelve nada", async () => {
    const backend = new FakeBackend({ searchResults: [] });
    const { deps, transport } = makeDeps(backend);

    await send(deps, WA, BUTTON.buscar, "Nadie");

    expect(backend.searchCalls).toHaveLength(1);
    expect(transport.allText()).toContain("No encontramos coincidencias");
  });
});

describe("persistencia de estado por usuario", () => {
  it("mantiene el flujo entre webhooks del mismo wa_id", async () => {
    const backend = new FakeBackend();
    const { deps, sessions } = makeDeps(backend);

    await send(deps, WA, BUTTON.registrar);
    // Tras iniciar registro, el estado quedo en el paso 'nombre'.
    expect(sessions.get(WA)).toEqual({ flow: "register", step: "nombre", draft: {} });

    await send(deps, WA, "Ana Sintetica");
    // El siguiente mensaje avanzo al paso 'apellidos' conservando el nombre.
    expect(sessions.get(WA)).toEqual({
      flow: "register",
      step: "apellidos",
      draft: { nombre: "Ana Sintetica" },
    });
  });

  it("no mezcla el estado de usuarios distintos", async () => {
    const backend = new FakeBackend();
    const { deps, sessions } = makeDeps(backend);

    const waA = "10000000001";
    const waB = "10000000002";

    // waA inicia registro; waB inicia busqueda.
    await send(deps, waA, BUTTON.registrar);
    await send(deps, waB, BUTTON.buscar);

    const stateA = sessions.get(waA);
    const stateB = sessions.get(waB);
    expect(stateA?.flow).toBe("register");
    expect(stateB?.flow).toBe("search");
  });
});

describe("privacidad: nunca sale dato de contacto", () => {
  // Telefono sintetico SIN formato venezolano real, para no disparar el escaner de
  // guardrails (que prohibe telefonos +58... versionados). Igual prueba que el
  // adaptador no filtra el campo `telefono` aunque el backend lo cuele.
  const SYNTH_PHONE = "000-000-0000";

  it("no incluye contact_id ni telefono aunque el backend devuelva resultados contaminados", async () => {
    // Backend malicioso/defectuoso: cuela contact_id y telefono en el resultado.
    const backend = new FakeBackend({
      searchResults: [
        publicPersonFixture({
          nombre: "Persona Filtrada",
          contact_id: SYNTH_CONTACT_ID,
          telefono: SYNTH_PHONE,
        }),
      ],
    });
    const { deps, transport } = makeDeps(backend);

    await send(deps, WA, BUTTON.buscar, "Persona");

    // Ningun mensaje enviado contiene el contacto contaminante.
    const conversation = transport.allText();
    expect(conversation).not.toContain(SYNTH_CONTACT_ID);
    expect(conversation).not.toContain("contact_id");
    expect(conversation).not.toContain("telefono");
    expect(conversation).not.toContain(SYNTH_PHONE);
    // Pero el dato publico SI se mostro (la busqueda funciono).
    expect(conversation).toContain("Persona Filtrada");
  });
});

describe("manejo de errores del backend", () => {
  it("responde un mensaje amable y no crashea si createPerson lanza", async () => {
    const backend = new FakeBackend({ failCreate: true });
    const { deps, transport } = makeDeps(backend);

    // No debe lanzar pese a que el backend falla al crear.
    await expect(
      send(
        deps,
        WA,
        BUTTON.registrar,
        "Pedro Sintetico",
        BUTTON.omitir,
        BUTTON.omitir,
        BUTTON.omitir,
        BUTTON.omitir,
        BUTTON.confirmar,
      ),
    ).resolves.toBeUndefined();

    expect(backend.createCalls).toHaveLength(1);
    // La maquina vuelve a ofrecer confirmar con un mensaje amable (sin detalles internos).
    const conversation = transport.allText();
    expect(conversation).toContain("No pudimos guardar el registro");
    expect(conversation).not.toContain("sintetico"); // no filtra el mensaje del Error
  });

  it("responde un mensaje amable y no crashea si searchPersons lanza", async () => {
    const backend = new FakeBackend({ failSearch: true });
    const { deps, transport, sessions } = makeDeps(backend);

    await expect(send(deps, WA, BUTTON.buscar, "Algo")).resolves.toBeUndefined();

    expect(backend.searchCalls).toHaveLength(1);
    expect(transport.allText()).toContain("No pudimos completar la busqueda");
    // Tras el fallo, la conversacion vuelve a idle (no queda atascada en 'searching').
    expect(sessions.get(WA)).toEqual({ flow: "idle" });
  });
});

describe("borrado (slice siguiente)", () => {
  it("responde que el borrado estara disponible pronto y vuelve a idle, sin llamar al backend", async () => {
    const backend = new FakeBackend();
    const { deps, transport, sessions } = makeDeps(backend);

    // El id sintetico es un uuid valido para que la maquina llegue a confirmar.
    await send(deps, WA, BUTTON.borrar, "11111111-1111-4111-8111-111111111111", BUTTON.confirmar);

    expect(transport.allText()).toContain("El borrado estara disponible muy pronto");
    // No se ejecuto ningun efecto contra el backend.
    expect(backend.createCalls).toHaveLength(0);
    expect(backend.searchCalls).toHaveLength(0);
    // Vuelve a idle.
    expect(sessions.get(WA)).toEqual({ flow: "idle" });
  });
});

describe("comandos y eventos raros", () => {
  it("normaliza /start y muestra el menu", async () => {
    const backend = new FakeBackend();
    const { deps, transport } = makeDeps(backend);

    await send(deps, WA, "/start");
    expect(transport.allText()).toContain("SomosVenezuela");
  });

  it("ignora sin crashear un evento que no es mensaje de texto", async () => {
    const backend = new FakeBackend();
    const { deps, transport } = makeDeps(backend);

    // Webhook de evento de estado (statuses, sin messages): se ignora.
    await handleUpdate(
      {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "ENTRY_ID",
            changes: [
              { field: "messages", value: { statuses: [{ status: "delivered" }] } },
            ],
          },
        ],
      },
      deps,
    );
    // Mensaje sin `text` (p. ej. una imagen): se ignora.
    await handleUpdate(
      {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "ENTRY_ID",
            changes: [
              {
                field: "messages",
                value: { messages: [{ from: WA, id: "wamid.IMG", type: "image" }] },
              },
            ],
          },
        ],
      },
      deps,
    );
    // Payload con forma totalmente invalida.
    await handleUpdate({ basura: true }, deps);

    expect(transport.sent).toHaveLength(0);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { requestJson } from "../request.js";

test("presenta el mensaje de validación de la API y conserva el estado HTTP", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Correo o contraseña incorrectos." }, { status: 401 }));
  await assert.rejects(requestJson("/api/login"), (error) =>
    error.status === 401 && error.message === "Correo o contraseña incorrectos.");
});

test("traduce un fallo de conexión a un mensaje legible", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(requestJson("/api/me"), /Revisa tu conexión/);
});

test("maneja HTML de un proxy sin mostrar errores de JSON", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Bad Gateway</html>", { status: 502 }));
  await assert.rejects(requestJson("/api/me"), /El servidor no está disponible/);
});

test("rechaza una respuesta exitosa con contenido inválido", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Not Found"));
  await assert.rejects(requestJson("/api/me"), /respuesta inválida/);
});

test("informa el límite de intentos aunque la respuesta no sea JSON", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Too Many Requests", { status: 429 }));
  await assert.rejects(requestJson("/api/login"), /15 minutos/);
});

test("cancela una solicitud que no responde para evitar loading infinito", async (t) => {
  t.mock.method(globalThis, "fetch", (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  await assert.rejects(requestJson("/api/me", "GET", undefined, 10), /tardó demasiado/);
});

test("recupera el funcionamiento después de una solicitud fallida", async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (!attempts++) throw new TypeError("offline");
    return Response.json({ datasets: [] });
  });
  await assert.rejects(requestJson("/api/datasets"));
  assert.deepEqual(await requestJson("/api/datasets"), { datasets: [] });
});

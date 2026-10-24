import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("despliegue: archivos públicos, HTTPS tras proxy y persistencia SQLite", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "estadia-test-"));
  const origin = "https://estadia.example";
  let child;
  let base;
  let cookie;

  async function start() {
    child = spawn(process.execPath, ["server.js"], {
      cwd: new URL("../", import.meta.url),
      env: {
        ...process.env,
        PORT: "0",
        DB_PATH: join(directory, "estadia.sqlite"),
        APP_ORIGIN: "",
        RENDER: "true",
        RENDER_EXTERNAL_URL: origin,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error(`Servidor sin iniciar: ${output}`)), 10000);
      child.stderr.on("data", (chunk) => { output += chunk; });
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(Error(`Servidor terminó (${code}): ${output}`));
      });
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/Estadia: http:\/\/localhost:(\d+)/);
        if (match) {
          base = `http://127.0.0.1:${match[1]}`;
          clearTimeout(timeout);
          resolve();
        }
      });
    });
  }

  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const [code] = await exited;
    assert.equal(code, 0, "el servidor debe cerrar correctamente SQLite");
  }

  async function request(path, method = "GET", body, requestOrigin = origin) {
    return fetch(base + path, {
      method,
      headers: {
        Origin: requestOrigin,
        "X-Estadia-Request": "1",
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  try {
    await start();
    assert.equal((await request("/healthz")).status, 200);
    for (const path of ["/", "/dashboard", "/styles.css", "/app.js", "/request.js", "/stats.js", "/assets/umg-logo.webp"])
      assert.equal((await request(path)).status, 200, path);
    for (const path of ["/server.js", "/api.js", "/schema.js", "/.env", "/.git/config", "/data/estadia.sqlite"])
      assert.equal((await request(path)).status, 404, path);
    assert.equal((await request("/api/me")).status, 401);

    const account = { name: "Prueba", email: "prueba@example.com", password: "PasswordPrueba123!" };
    assert.equal((await request("/api/register", "POST", account, "https://otro.example")).status, 403);
    const registration = await request("/api/register", "POST", account);
    assert.equal(registration.status, 200);
    const setCookie = registration.headers.get("set-cookie");
    assert.match(setCookie, /; Secure/);
    assert.match(setCookie, /HttpOnly/);
    cookie = setCookie.split(";")[0];
    async function expectError(response, status, message) {
      assert.equal(response.status, status);
      assert.match(response.headers.get("content-type"), /application\/json/);
      assert.match((await response.json()).error, message);
    }
    await expectError(await request("/api/register", "POST", account), 409, /No se pudo crear la cuenta/);
    await expectError(await request("/api/login", "POST", { ...account, password: "ClaveIncorrecta123" }), 401, /Correo o contraseña incorrectos/);
    await expectError(await request("/api/datasets", "POST", { name: "X", values: "1, 2" }), 400, /nombre/);
    await expectError(await request("/api/datasets", "POST", { name: "Datos", values: "1, texto, 3" }), 400, /número|numérico|inválido/i);
    await expectError(await request("/api/datasets", "POST", { name: "Datos", values: Array(101).fill(1).join(",") }), 400, /100/);
    await expectError(await request("/api/datasets/00000000-0000-0000-0000-000000000000", "DELETE"), 404, /no encontrado/);
    const malformed = await fetch(base + "/api/datasets", {
      method: "POST",
      headers: { Origin: origin, "X-Estadia-Request": "1", "Content-Type": "application/json", Cookie: cookie },
      body: "{invalid",
    });
    await expectError(malformed, 400, /JSON inválido/);
    assert.equal((await request("/api/datasets", "POST", { name: "Datos", values: "1, 2, 3" })).status, 201);
    await stop();
    await start();
    const saved = await request("/api/datasets");
    assert.equal(saved.status, 200);
    const { datasets } = await saved.json();
    assert.equal(datasets.length, 1);
    assert.deepEqual(datasets[0].values, [1, 2, 3]);
    assert.equal((await request("/api/logout", "POST", {})).status, 200);
    assert.equal((await request("/api/me")).status, 401);
    const login = await request("/api/login", "POST", account);
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal((await request(`/api/datasets/${datasets[0].id}`, "DELETE")).status, 200);
    assert.deepEqual((await (await request("/api/datasets")).json()).datasets, []);
    let limited;
    for (let attempt = 0; attempt < 11; attempt++) {
      limited = await request("/api/login", "POST", { ...account, password: "ClaveIncorrecta123" });
      if (limited.status === 429) break;
      assert.equal(limited.status, 401);
    }
    await expectError(limited, 429, /15 minutos/);
  } finally {
    try { await stop(); } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

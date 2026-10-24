/**
 * SERVIDOR HTTP: conecta los archivos de la interfaz con la API y SQLite.
 * Ejecutar: npm start (Node.js 22.17 o superior de la rama 22).
 * Variables opcionales: PORT, APP_ORIGIN y DB_PATH. Render proporciona RENDER_EXTERNAL_URL.
 */
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { api, securityHeaders } from "./api.js";
import { schema } from "./schema.js";
import { dirname } from "node:path";
// Resuelve las rutas respecto a este archivo, sin depender del directorio de la terminal.
const root = fileURLToPath(new URL(".", import.meta.url));
// DB_PATH permite ubicar SQLite en un disco persistente del alojamiento.
// Si no se configura, utiliza data/estadia.sqlite junto al proyecto.
const dbPath = process.env.DB_PATH || root + "data/estadia.sqlite";
mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
const sqlite = new DatabaseSync(dbPath);
// Activa relaciones entre tablas y el modo WAL para gestionar el registro de escrituras.
sqlite.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
// Crea el esquema solo la primera vez; no borra los usuarios ni conjuntos existentes.
if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE name='users'").get())
  sqlite.exec(schema);
// Adaptador de consultas: bind asigna parámetros, first devuelve una fila,
// all devuelve varias y run ejecuta cambios e informa cuántas filas afectó.
export const db = {
  prepare(sql) {
    let params = [];
    return {
      bind(...p) {
        params = p;
        return this;
      },
      async first() {
        return sqlite.prepare(sql).get(...params) || null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...params) };
      },
      async run() {
        const r = sqlite.prepare(sql).run(...params);
        return { meta: { changes: Number(r.changes) } };
      },
    };
  },
};
// Lista explícita de archivos públicos: api.js, schema.js, server.js y la BD no se sirven.
const assets = {
  "/assets/umg-logo.webp": ["assets/umg-logo.webp", "image/webp"],
  "/": ["index.html", "text/html"],
  "/index.html": ["index.html", "text/html"],
  "/dashboard": ["dashboard.html", "text/html"],
  "/dashboard.html": ["dashboard.html", "text/html"],
  "/styles.css": ["styles.css", "text/css"],
  "/app.js": ["app.js", "text/javascript"],
  "/stats.js": ["stats.js", "text/javascript"],
};
// Cada solicitud pasa por este controlador: API, archivo permitido o respuesta 404.
const server = http.createServer(async (req, res) => {
  try {
    // El origen configurado permite verificar CSRF incluso cuando Render termina la conexión HTTPS.
    const origin =
      process.env.APP_ORIGIN ||
      process.env.RENDER_EXTERNAL_URL ||
      `http://localhost:${process.env.PORT || 3000}`;
    const url = new URL(req.url, origin);
    let response;
    if (url.pathname === "/healthz" && ["GET", "HEAD"].includes(req.method)) {
      sqlite.prepare("SELECT 1").get();
      response = new Response(req.method === "HEAD" ? null : JSON.stringify({ ok: true }), {
        headers: { ...securityHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
    } else if (url.pathname.startsWith("/api/")) {
      // Acumula el cuerpo con un límite de 120 KB antes de enviarlo a la API.
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 120000) {
          // Convierte la respuesta de la API o archivo al formato de salida HTTP de Node.
          res.writeHead(413, securityHeaders);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      // Convierte la solicitud de Node al formato Request y entrega el adaptador de BD y la IP.
      response = await api(
        new Request(url, {
          method: req.method,
          headers: req.headers,
          ...(["GET", "HEAD"].includes(req.method)
            ? {}
            : { body: Buffer.concat(chunks) }),
        }),
        db,
        req.socket.remoteAddress,
      );
    } else if (assets[url.pathname] && req.method === "GET") {
      const [file, type] = assets[url.pathname];
      response = new Response(readFileSync(root + file), {
        headers: {
          ...securityHeaders,
          "Content-Type":
            type + (type.startsWith("image/") ? "" : "; charset=utf-8"),
        },
      });
    } else
      response = new Response("No encontrado", {
        status: 404,
        headers: securityHeaders,
      });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error("Error al atender solicitud:", error);
    res.writeHead(500, securityHeaders);
    res.end("Error interno");
  }
});
// En Render escucha en todas las interfaces (0.0.0.0) y usa PORT.
// En la computadora local solo escucha en 127.0.0.1.
server.listen(
  process.env.PORT || 3000,
  process.env.RENDER ? "0.0.0.0" : "127.0.0.1",
  () => console.log(`Estadia: http://localhost:${server.address().port}`),
);

// Render envía SIGTERM antes de detener el proceso; termina las solicitudes y cierra SQLite.
function shutdown() {
  const timer = setTimeout(() => process.exit(1), 10000);
  timer.unref();
  server.close(() => {
    sqlite.close();
    clearTimeout(timer);
    process.exit(0);
  });
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

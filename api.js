/**
 * BACKEND: recibe las solicitudes /api y consulta la base de datos.
 * Flujo: validar entrada → autenticar sesión → autorizar usuario → consultar SQL.
 * Este archivo se ejecuta en Node.js; el navegador no debe recibir su código.
 */
import { parseNumbers, validateDatasetName } from "./stats.js";
// TextEncoder convierte texto en bytes para las funciones criptográficas.
const encoder = new TextEncoder();
const hex = (b) =>
  [...new Uint8Array(b)].map((v) => v.toString(16).padStart(2, "0")).join("");
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
// SHA-256 permite guardar una huella del token de sesión, en lugar del token reutilizable.
async function digest(s) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
}
// PBKDF2 deriva un hash de contraseña usando una sal aleatoria por cuenta.
// No se puede recuperar la contraseña original a partir de este valor.
async function passwordHash(password, salt) {
  const k = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return hex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: encoder.encode(salt),
        iterations: 100000,
        hash: "SHA-512",
      },
      k,
      512,
    ),
  );
}
// Compara los hashes recorriendo todos los caracteres, sin terminar en la primera diferencia.
// Esto evita una salida anticipada; JavaScript no garantiza tiempo constante.
const equal = (a, b) => {
  let d = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
// Cabeceras que restringen recursos, marcos y permisos del navegador.
// CSP solo permite scripts y estilos del mismo origen; HSTS actúa bajo HTTPS.
export const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cache-Control": "no-store",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};
// request: solicitud HTTP; db: adaptador SQLite; ip: dirección usada para limitar intentos.
export async function api(request, db, ip = "local") {
  const url = new URL(request.url),
    path = url.pathname,
    now = Date.now();
  // Construye respuestas JSON con estado HTTP y cabeceras comunes.
  const reply = (data, status = 200, extra = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        ...securityHeaders,
        "Content-Type": "application/json; charset=utf-8",
        ...extra,
      },
    });
  // Lanza errores controlados que se convierten en mensajes legibles al final.
  const fail = (message, status = 400) => {
    throw Object.assign(Error(message), { status });
  };
  // HttpOnly impide leer la cookie desde JS; SameSite limita su envío entre sitios.
  // Secure se añade al usar HTTPS. Max-Age se expresa en segundos.
  const cookie = (token, seconds) =>
    `estadia_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${url.protocol === "https:" ? "; Secure" : ""}`;
  try {
    if (!["GET", "POST", "DELETE"].includes(request.method))
      return reply({ error: "Método no permitido." }, 405);
    let body = {};
    // Las operaciones que modifican datos exigen el mismo origen y una cabecera propia.
    // Estas comprobaciones forman parte de la protección contra CSRF.
    if (request.method !== "GET") {
      if (
        request.headers.get("origin") !== url.origin ||
        request.headers.get("x-estadia-request") !== "1"
      )
        fail("Origen de solicitud inválido.", 403);
      if (request.method === "POST") {
        if (
          !request.headers.get("content-type")?.startsWith("application/json")
        )
          fail("Se requiere JSON.", 415);
        if (Number(request.headers.get("content-length") || 0) > 120000)
          fail("Solicitud demasiado grande.", 413);
        // Comprueba el tamaño real al leer el cuerpo: Content-Length puede faltar o ser incorrecto.
        // El máximo es 120,000 bytes. Solo después se interpreta el JSON.
        const reader = request.body?.getReader();
        let size = 0,
          chunks = [];
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 120000) {
              await reader.cancel();
              fail("Solicitud demasiado grande.", 413);
            }
            chunks.push(value);
          }
        }
        const buffer = new Uint8Array(size);
        let offset = 0;
        for (const c of chunks) {
          buffer.set(c, offset);
          offset += c.length;
        }
        try {
          body = JSON.parse(new TextDecoder().decode(buffer));
        } catch {
          fail("JSON inválido.");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          fail("Datos inválidos.");
      }
    }
    if (
      (path === "/api/register" || path === "/api/login") &&
      request.method === "POST"
    ) {
      // Registro y login comparten validaciones. El correo se normaliza; la contraseña se conserva.
      const email =
        typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = body.password;
      if (
        email.length > 254 ||
        !/^\S+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof password !== "string" ||
        password.length < 12 ||
        password.length > 128
      )
        fail("Verifica el correo y la contraseña (12 a 128 caracteres).");
      // Cuenta intentos por IP y correo en ventanas de 15 minutos.
      // El UPSERT actualiza el contador en una sola sentencia; el límite es 10 intentos.
      // El servidor entrega la IP del socket: detrás de un proxy puede compartirse entre visitantes.
      for (const key of [
        await digest("ip:" + ip),
        await digest("email:" + email),
      ]) {
        const a = await db
          .prepare(
            "INSERT INTO attempts (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END RETURNING count",
          )
          .bind(key, now + 900000, now, now)
          .first();
        if (a.count > 10)
          fail("Demasiados intentos. Intenta nuevamente en 15 minutos.", 429);
      }
      // Los signos ? se rellenan con bind(): los valores no se concatenan al SQL.
      // Así, un correo con texto SQL sigue siendo un dato, no una instrucción.
      let user = await db
        .prepare("SELECT * FROM users WHERE email=?")
        .bind(email)
        .first();
      // Registro: valida el nombre y guarda UUID, sal y hash; nunca la contraseña en texto plano.
      if (path === "/api/register") {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (name.length < 2 || name.length > 60 || /[<>\x00-\x1f]/.test(name))
          fail(
            "El nombre debe tener de 2 a 60 caracteres y no incluir etiquetas.",
          );
        if (user)
          fail(
            "No se pudo crear la cuenta. Revisa tus datos o inicia sesión.",
            409,
          );
        const salt = random();
        user = { id: crypto.randomUUID(), name, email };
        try {
          await db
            .prepare(
              "INSERT INTO users (id,name,email,salt,password_hash) VALUES (?,?,?,?,?)",
            )
            .bind(
              user.id,
              name,
              email,
              salt,
              await passwordHash(password, salt),
            )
            .run();
        } catch {
          fail("No se pudo crear la cuenta.", 409);
        }
      } else {
        // Login: calcula el hash ingresado y lo compara. También hace el cálculo si el usuario no existe,
        // para reducir diferencias de tiempo entre correos existentes y ausentes.
        const computed = await passwordHash(
          password,
          user?.salt || "0".repeat(64),
        );
        if (!user || !equal(computed, user.password_hash))
          fail("Correo o contraseña incorrectos.", 401);
      }
      // Después de autenticar, revoca la sesión anterior de esta cookie y genera una nueva.
      const old = (request.headers.get("cookie") || "").match(
        /(?:^|;\s*)estadia_session=([a-f0-9]{64})(?:;|$)/,
      )?.[1];
      if (old)
        await db
          .prepare("DELETE FROM sessions WHERE token_hash=?")
          .bind(await digest(old))
          .run();
      // La sesión dura 8 horas: 28,800,000 milisegundos en BD y 28,800 segundos en la cookie.
      const token = random();
      await db
        .prepare(
          "INSERT INTO sessions (token_hash,user_id,expires) VALUES (?,?,?)",
        )
        .bind(await digest(token), user.id, now + 28800000)
        .run();
      await db.prepare("DELETE FROM sessions WHERE expires<?").bind(now).run();
      await db.prepare("DELETE FROM attempts WHERE expires<?").bind(now).run();
      return reply({ user: { name: user.name, email: user.email } }, 200, {
        "Set-Cookie": cookie(token, 28800),
      });
    }
    // Todas las rutas siguientes requieren una sesión existente y sin vencer.
    const token = (request.headers.get("cookie") || "").match(
      /(?:^|;\s*)estadia_session=([a-f0-9]{64})(?:;|$)/,
    )?.[1];
    const hash = token ? await digest(token) : "";
    const user = await db
      .prepare(
        "SELECT users.id,users.name,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>?",
      )
      .bind(hash, now)
      .first();
    if (!user) fail("Inicia sesión para continuar.", 401);
    // Devuelve solo los datos públicos de la cuenta autenticada.
    if (path === "/api/me" && request.method === "GET")
      return reply({ user: { name: user.name, email: user.email } });
    // Cerrar sesión elimina el registro del servidor y vence la cookie del navegador.
    if (path === "/api/logout" && request.method === "POST") {
      await db
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .bind(hash)
        .run();
      return reply({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
    }
    // Lista únicamente conjuntos del usuario actual, del más reciente al más antiguo.
    if (path === "/api/datasets" && request.method === "GET") {
      const { results } = await db
        .prepare(
          "SELECT id,name,numbers,created FROM datasets WHERE user_id=? ORDER BY created DESC LIMIT 100",
        )
        .bind(user.id)
        .all();
      return reply({
        datasets: results.map((r) => ({
          ...r,
          values: JSON.parse(r.numbers),
          numbers: undefined,
        })),
      });
    }
    // Valida otra vez en el servidor, limita a 100 conjuntos y guarda los números como JSON.
    // La validación del navegador por sí sola no protege la API.
    if (path === "/api/datasets" && request.method === "POST") {
      let name, values;
      try {
        name = validateDatasetName(body.name);
        values = parseNumbers(body.values);
      } catch (e) {
        fail(e.message);
      }
      const count = await db
        .prepare("SELECT count(*) AS n FROM datasets WHERE user_id=?")
        .bind(user.id)
        .first();
      if (count.n >= 100)
        fail("Límite de 100 conjuntos. Elimina uno para continuar.");
      const id = crypto.randomUUID();
      await db
        .prepare(
          "INSERT INTO datasets (id,user_id,name,numbers,created) VALUES (?,?,?,?,?)",
        )
        .bind(id, user.id, name, JSON.stringify(values), now)
        .run();
      return reply({ id }, 201);
    }
    if (
      /^\/api\/datasets\/[a-f0-9-]{36}$/.test(path) &&
      request.method === "DELETE"
    ) {
      // El borrado exige coincidir tanto en id como en user_id: conocer el id ajeno no autoriza eliminarlo.
      const result = await db
        .prepare("DELETE FROM datasets WHERE id=? AND user_id=?")
        .bind(path.split("/").pop(), user.id)
        .run();
      if (!result.meta.changes) fail("Conjunto no encontrado.", 404);
      return reply({ ok: true });
    }
    return reply({ error: "Ruta no encontrada." }, 404);
  } catch (e) {
    return reply(
      { error: e.status ? e.message : "Error interno. Intenta de nuevo." },
      e.status || 500,
    );
  }
}

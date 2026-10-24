// Transporte compartido: siempre devuelve mensajes legibles, incluso si el proxy envía HTML.
export async function requestJson(path, method = "GET", data, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(path, {
      method,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-Estadia-Request": "1" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    let json;
    try {
      json = await response.json();
    } catch (error) {
      if (controller.signal.aborted || error instanceof TypeError) throw error;
      // Un proxy o un error HTTP puede devolver texto en lugar de JSON.
    }
    if (!response.ok) {
      const fallback = response.status === 429
        ? "Demasiados intentos. Intenta nuevamente en 15 minutos."
        : response.status === 401
          ? "Tu sesión ha terminado. Inicia sesión nuevamente."
          : response.status >= 500
            ? "El servidor no está disponible. Intenta nuevamente en unos momentos."
            : "No se pudo completar la solicitud. Revisa los datos e intenta nuevamente.";
      throw Object.assign(Error(
        typeof json?.error === "string" && json.error.trim() ? json.error : fallback,
      ), { status: response.status });
    }
    if (!json || typeof json !== "object" || Array.isArray(json))
      throw Error("El servidor devolvió una respuesta inválida. Recarga la página e intenta nuevamente.");
    return json;
  } catch (error) {
    if (controller.signal.aborted)
      throw Error("El servidor tardó demasiado en responder. Intenta nuevamente en unos momentos.");
    if (error instanceof TypeError)
      throw Error("No se pudo conectar con el servidor. Revisa tu conexión e intenta nuevamente.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

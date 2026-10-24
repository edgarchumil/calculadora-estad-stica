/**
 * INTERFAZ: controla acceso, formularios, dashboard y gráficos SVG.
 * Este módulo se carga en ambas páginas; comprueba qué elementos existen antes de actuar.
 * La API valida y autoriza cada operación: ocultar controles en pantalla no sustituye esa protección.
 */
import { parseNumbers, statistics, validateDatasetName } from "/stats.js";
// Atajo para buscar un elemento por su atributo id.
const $ = (id) => document.getElementById(id);
// Envía JSON a la API. La cookie de sesión viaja automáticamente en el mismo origen.
// La cabecera personalizada acompaña las comprobaciones CSRF del servidor.
async function request(path, method = "GET", data) {
  const r = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Estadia-Request": "1" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const json = await r.json();
  if (!r.ok) {
    if (r.status === 401 && location.pathname.startsWith("/dashboard"))
      location.replace("/");
    throw Error(json.error || "Ocurrió un error.");
  }
  return json;
}
// Formatea solo la presentación; los cálculos conservan su precisión original.
const format = (n) =>
  n === null
    ? "No disponible"
    : new Intl.NumberFormat("es-GT", { maximumFractionDigits: 4 }).format(n);
// Crea elementos con textContent, evitando interpretar los datos del usuario como HTML.
const node = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
// PANTALLA DE ACCESO: este bloque solo se ejecuta donde existe el formulario.
if ($("auth-form")) {
  let register = false;
  // Cambia entre login y registro: muestra el nombre, ajusta required, título y botones.
  function mode(value) {
    register = value;
    $("name-field").hidden = !value;
    $("name").required = value;
    $("password").autocomplete = value ? "new-password" : "current-password";
    $("auth-title").textContent = value ? "Crear una cuenta" : "Iniciar sesión";
    const subtitle = $("auth-subtitle");
    if (subtitle) {
      subtitle.textContent = value
        ? "Crea tu cuenta para guardar y explorar tus datos."
        : "Inicia sesión para continuar con tus análisis.";
    }
    $("auth-submit").textContent = value
      ? "Crear mi cuenta →"
      : "Entrar a mi espacio →";
    $("login-tab").classList.toggle("active", !value);
    $("register-tab").classList.toggle("active", value);
    $("auth-error").textContent = "";
  }
  $("login-tab").onclick = () => mode(false);
  $("register-tab").onclick = () => mode(true);
  // Alterna la visibilidad de la contraseña sin modificar su valor.
  $("show-password").onclick = () => {
    const visible = $("password").type === "password";
    $("password").type = visible ? "text" : "password";
    $("show-password").textContent = visible ? "Ocultar" : "Ver";
    $("show-password").setAttribute(
      "aria-label",
      visible ? "Ocultar contraseña" : "Mostrar contraseña",
    );
  };
  // Evita recargar el formulario, envía credenciales y abre el dashboard si el servidor las acepta.
  // El botón se desactiva temporalmente para evitar envíos duplicados.
  $("auth-form").onsubmit = async (e) => {
    e.preventDefault();
    $("auth-error").textContent = "";
    $("auth-submit").disabled = true;
    try {
      await request(register ? "/api/register" : "/api/login", "POST", {
        name: $("name").value,
        email: $("email").value,
        password: $("password").value,
      });
      location.assign("/dashboard");
    } catch (err) {
      $("auth-error").textContent = err.message;
    } finally {
      $("auth-submit").disabled = false;
    }
  };
  request("/api/me")
    .then(() => location.replace("/dashboard"))
    .catch(() => {});
}
// DASHBOARD: mantiene los conjuntos guardados, el conjunto seleccionado y el tipo de gráfico.
if ($("dashboard")) {
  let datasets = [],
    current = null,
    values = [],
    chartType = "line";
  let toastTimer;
  let activeView = "overview";
  let historySelection = null;
  // Muestra una notificación temporal y reinicia su temporizador cuando llega otra.
  function toast(message) {
    $("toast").textContent = message;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
  }
  // Los gráficos SVG necesitan un espacio de nombres distinto al de los elementos HTML.
  const svgNode = (tag, attrs = {}, text) => {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  // Dibuja una serie o un histograma a partir de las estadísticas actuales.
  // W/H son el tamaño lógico; L/R/T/B son márgenes; w/h son el área de trazado.
  function chart(s) {
    const W = 700,
      H = 230,
      L = 56,
      R = 18,
      T = 18,
      B = 36,
      w = W - L - R,
      h = H - T - B;
    const svg = svgNode("svg", {
      viewBox: `0 0 ${W} ${H}`,
      "aria-hidden": "true",
    });
    let lo = Math.min(s.min, s.intercept, s.intercept + s.slope * (s.n - 1)),
      hi = Math.max(s.max, s.intercept, s.intercept + s.slope * (s.n - 1));
    // Agrupa el histograma en intervalos iguales; si todos los valores coinciden, usa un solo grupo.
    const binCount =
        s.min === s.max ? 1 : Math.min(20, Math.ceil(Math.sqrt(s.n))),
      bins = Array(binCount).fill(0),
      step = (s.max - s.min) / binCount || 1;
    for (const v of values)
      bins[Math.min(binCount - 1, Math.floor((v - s.min) / step))]++;
    if (chartType === "histogram") {
      lo = 0;
      hi = Math.max(...bins) * 1.15;
    } else {
      const pad = (hi - lo) * 0.15 || 1;
      lo -= pad;
      hi += pad;
    }
    // Escalas que convierten índices y valores numéricos en coordenadas dentro del SVG.
    const x = (i) => L + (s.n === 1 ? w / 2 : (i / (s.n - 1)) * w),
      y = (v) => T + h - ((v - lo) / (hi - lo)) * h;
    for (let i = 0; i <= 4; i++) {
      const yy = T + (i * h) / 4;
      svg.append(
        svgNode("line", {
          x1: L,
          y1: yy,
          x2: W - R,
          y2: yy,
          stroke: "#e3e9ef",
          "stroke-dasharray": "3 4",
        }),
        svgNode(
          "text",
          {
            x: L - 9,
            y: yy + 4,
            "text-anchor": "end",
            fill: "#647b8b",
            "font-size": 10,
          },
          format(hi - (i * (hi - lo)) / 4),
        ),
      );
    }
    // Reduce a 500 puntos solo el dibujo de series grandes; los cálculos siguen usando todos los datos.
    if (chartType === "line") {
      const indices =
        values.length <= 500
          ? values.map((_, i) => i)
          : Array.from({ length: 500 }, (_, i) =>
              Math.round((i * (values.length - 1)) / 499),
            );
      const points = indices.map((i) => `${x(i)},${y(values[i])}`).join(" ");
      svg.append(
        svgNode("polygon", {
          points: `${x(0)},${T + h} ${points} ${x(s.n - 1)},${T + h}`,
          fill: "#e3eff7",
        }),
      );
      svg.append(
        svgNode("polyline", {
          points,
          fill: "none",
          stroke: "#1d719f",
          "stroke-width": 2.2,
          "stroke-linejoin": "round",
        }),
      );
      svg.append(
        svgNode("line", {
          x1: x(0),
          y1: y(s.intercept),
          x2: x(s.n - 1),
          y2: y(s.intercept + s.slope * (s.n - 1)),
          stroke: "#c62e32",
          "stroke-width": 1.8,
          "stroke-dasharray": "5 5",
        }),
      );
      if (s.n <= 80)
        values.forEach((v, i) => {
          const c = svgNode("circle", {
            cx: x(i),
            cy: y(v),
            r: 3,
            fill: "white",
            stroke: "#1d719f",
            "stroke-width": 1.7,
          });
          c.append(svgNode("title", {}, `Observación ${i + 1}: ${v}`));
          svg.append(c);
        });
      for (const i of [...new Set([0, Math.floor((s.n - 1) / 2), s.n - 1])])
        svg.append(
          svgNode(
            "text",
            {
              x: x(i),
              y: H - 12,
              "text-anchor": "middle",
              fill: "#647b8b",
              "font-size": 10,
            },
            `Dato ${i + 1}`,
          ),
        );
    } else {
      bins.forEach((count, i) => {
        const bar = svgNode("rect", {
          x: L + (i * w) / binCount + 3,
          y: y(count),
          width: Math.max(1, w / binCount - 6),
          height: T + h - y(count),
          rx: 4,
          fill: i % 2 ? "#c62e32" : "#1d719f",
        });
        bar.append(
          svgNode(
            "title",
            {},
            `${format(s.min + i * step)} a ${format(s.min + (i + 1) * step)}: ${count} datos`,
          ),
        );
        svg.append(bar);
      });
      svg.append(
        svgNode(
          "text",
          { x: L, y: H - 12, fill: "#647b8b", "font-size": 10 },
          format(s.min),
        ),
        svgNode(
          "text",
          {
            x: W - R,
            y: H - 12,
            "text-anchor": "end",
            fill: "#647b8b",
            "font-size": 10,
          },
          format(s.max),
        ),
      );
    }
    $("chart").replaceChildren(svg);
    $("chart").setAttribute(
      "aria-label",
      `${chartType === "line" ? "Serie en orden de ingreso" : "Histograma de frecuencias"}: ${s.n} datos, mínimo ${format(s.min)}, máximo ${format(s.max)}.`,
    );
    $("chart-title").textContent =
      chartType === "line"
        ? "Comportamiento de los datos"
        : "Frecuencia de los datos";
    $("chart-count").textContent =
      s.n > 500 && chartType === "line"
        ? "Vista: 500 puntos · Cálculo: todos los datos"
        : `${s.n} observaciones`;
  }
  // Recalcula y actualiza tarjetas, distribución, tabla y gráfico para el conjunto seleccionado.
  function render() {
    // Ceros de presentación mientras no se elija un análisis; no representan una muestra real.
    const hasData = Boolean(current && values.length);
    const s = hasData
      ? statistics(values)
      : {
          n: 0,
          mean: 0,
          median: 0,
          modes: [],
          q1: 0,
          q3: 0,
          iqr: 0,
          min: 0,
          max: 0,
          std: 0,
          variance: 0,
          sampleVariance: 0,
          range: 0,
          outliers: [],
        };
    $("delete-dataset").hidden = !current;
    $("metrics").replaceChildren();
    const modes = !hasData
      ? "0"
      : s.modes.length
        ? s.modes.slice(0, 4).map(format).join(", ") +
          (s.modes.length > 4 ? "…" : "")
        : "Sin moda";
    for (const [title, value, note, icon] of [
      ["Media", format(s.mean), "El promedio de tus valores", "x̄"],
      ["Mediana", format(s.median), "El punto central de tus datos", "◈"],
      [
        "Moda",
        modes,
        !hasData
          ? "Selecciona un análisis del historial"
          : s.modes.length
            ? `${s.modes.length} valor(es) más frecuente(s)`
            : "Ningún valor se repite",
        "≋",
      ],
      ["Observaciones", format(s.n), "Datos listos para explorar", "⊞"],
    ]) {
      const box = node("article", undefined, "metric"),
        top = node("div", undefined, "metric-top");
      top.append(node("span", title), node("span", icon, "metric-icon"));
      box.append(
        top,
        node("strong", value, "metric-value"),
        node("small", note),
      );
      $("metrics").append(box);
    }
    $("detail-stats").replaceChildren();
    for (const [title, value] of [
      ["Primer cuartil · Q1", s.q1],
      ["Tercer cuartil · Q3", s.q3],
      ["Rango intercuartílico", s.iqr],
      ["Mínimo / Máximo", `${format(s.min)} / ${format(s.max)}`],
      ["Desviación estándar", s.std],
      ["Varianza poblacional", s.variance],
      ["Varianza muestral", s.sampleVariance],
      ["Rango", s.range],
      ["Valores atípicos", s.outliers.length],
    ]) {
      const row = node("div", undefined, "stat-row");
      row.append(
        node("span", title),
        node("strong", typeof value === "string" ? value : format(value)),
      );
      $("detail-stats").append(row);
    }
    const table = node("table"),
      head = node("thead"),
      tr = node("tr");
    tr.append(node("th", "Posición"), node("th", "Valor"));
    head.append(tr);
    const tbody = node("tbody");
    // Ordena una copia numéricamente para conservar el orden usado en la tendencia.
    const sortedValues = [...values].sort((a, b) => a - b);
    sortedValues.forEach((v, i) => {
      const r = node("tr");
      r.append(
        node("td", String(i + 1).padStart(2, "0")),
        node("td", format(v)),
      );
      tbody.append(r);
    });
    table.append(head, tbody);
    $("data-table").replaceChildren(table);
    $("table-count").textContent = `${s.n} datos · orden ascendente`;
    if (hasData) {
      chart(s);
    } else {
      $("chart").replaceChildren(
        node(
          "p",
          "Selecciona un análisis del historial para visualizar sus datos.",
          "muted",
        ),
      );
      $("chart").setAttribute("aria-label", "Sin análisis seleccionado");
      $("chart-title").textContent = "Comportamiento de los datos";
      $("chart-count").textContent = "0 observaciones";
    }
  }
  // No se selecciona ningún registro automáticamente; la elección vive solo en esta página.
  function showView(view) {
    activeView = ["overview", "data-entry", "history"].includes(view)
      ? view
      : "overview";
    const titles = {
      overview: "Dashboard",
      "data-entry": "Ingreso de datos",
      history: "Visualizaciones",
    };
    $("view-title").textContent = titles[activeView];
    $("new-analysis").hidden = activeView === "data-entry";
    $("overview-view").hidden = activeView !== "overview";
    $("entry-view").hidden = activeView !== "data-entry";
    $("history-view").hidden = activeView !== "history";
    document.querySelectorAll("[data-view]").forEach((link) => {
      const selected = link.dataset.view === activeView;
      link.classList.toggle("active", selected);
      if (selected) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    current = datasets.find((d) => d.id === historySelection) || null;
    values = current?.values || [];
    const target = $("overview-analysis");
    target.append($("analysis-content"));
    $("analysis-content").hidden = activeView !== "overview";
    render();
  }

  // Elegir un nombre carga ese análisis en el dashboard hasta recargar o cerrar sesión.
  function renderHistory() {
    $("history-count").textContent = `${datasets.length} conjuntos`;
    $("history-list").replaceChildren();
    if (!datasets.length) {
      $("history-list").append(
        node(
          "p",
          "Aún no hay conjuntos guardados. Ingresa tus primeros datos para comenzar.",
          "muted",
        ),
      );
      return;
    }
    for (const dataset of datasets) {
      const item = node("div", undefined, "history-item");
      const info = node("div");
      const open = node("button", dataset.name, "history-name");
      open.type = "button";
      // El nombre y el botón de la derecha comparten la misma selección.
      const openAnalysis = () => {
        historySelection = dataset.id;
        location.hash = "overview";
        showView("overview");
      };
      open.onclick = openAnalysis;
      info.append(
        open,
        node("p", `${dataset.values.length} datos`, "history-meta"),
      );
      const viewAnalysis = node("button", "Ver análisis →", "history-hint");
      viewAnalysis.type = "button";
      viewAnalysis.setAttribute(
        "aria-label",
        `Ver análisis de ${dataset.name}`,
      );
      viewAnalysis.onclick = openAnalysis;
      item.append(info, viewAnalysis);
      $("history-list").append(item);
    }
  }

  async function refresh() {
    datasets = (await request("/api/datasets")).datasets;
    if (!datasets.some((d) => d.id === historySelection))
      historySelection = null;
    renderHistory();
    showView(activeView);
  }
  window.addEventListener("hashchange", () => showView(location.hash.slice(1)));

  // El contador orienta al usuario; parseNumbers impone el límite también en la API.
  function updateValueCount() {
    const text = $("values").value.trim();
    const count = text ? text.split(/[\s,;]+/).length : 0;
    $("values-count").textContent = `${count} de 50 datos`;
    $("values-count").classList.toggle("error", count > 50);
    let error = "";
    if ($("values").value) {
      try {
        parseNumbers($("values").value);
      } catch (e) {
        error = e.message;
      }
    }
    $("values").setCustomValidity(error);
    $("values").setAttribute("aria-invalid", String(Boolean(error)));
  }
  // La misma función valida el nombre en pantalla y en la API, sin depender solo de minlength.
  $("dataset-name").addEventListener("input", () => {
    let error = "";
    if ($("dataset-name").value) {
      try {
        validateDatasetName($("dataset-name").value);
      } catch (e) {
        error = e.message;
      }
    }
    $("dataset-name").setCustomValidity(error);
    $("dataset-name").setAttribute("aria-invalid", String(Boolean(error)));
  });
  $("values").addEventListener("input", updateValueCount);
  $("line-chart").onclick = () => {
    chartType = "line";
    $("line-chart").classList.add("active");
    $("histogram").classList.remove("active");
    render();
  };
  $("histogram").onclick = () => {
    chartType = "histogram";
    $("histogram").classList.add("active");
    $("line-chart").classList.remove("active");
    render();
  };
  // Abre el formulario de ingreso y coloca el foco en el nombre del conjunto.
  $("new-analysis").onclick = () => {
    location.hash = "data-entry";
    showView("data-entry");
    $("dataset-name").focus();
  };
  // Valida el texto, solicita guardarlo y vuelve a cargar el conjunto recién creado.
  $("data-form").onsubmit = async (e) => {
    e.preventDefault();
    $("data-message").textContent = "";
    $("calculate").disabled = true;
    try {
      const name = validateDatasetName($("dataset-name").value);
      parseNumbers($("values").value);
      await request("/api/datasets", "POST", {
        name,
        values: $("values").value,
      });
      await refresh();
      location.hash = "history";
      showView("history");
      $("data-message").textContent =
        "Conjunto guardado. Selecciónalo en el historial para ver el dashboard.";
      toast(
        "Conjunto guardado. Selecciona su nombre en el historial para visualizarlo.",
      );
    } catch (err) {
      $("data-message").textContent = err.message;
    } finally {
      $("calculate").disabled = false;
    }
  };
  // Pide confirmación antes de borrar permanentemente el conjunto seleccionado.
  $("delete-dataset").onclick = async () => {
    if (
      !current ||
      !confirm(`¿Eliminar “${current.name}”? Esta acción es permanente.`)
    )
      return;
    try {
      await request(`/api/datasets/${current.id}`, "DELETE");
      await refresh();
      toast("Conjunto eliminado.");
    } catch (e) {
      toast(e.message);
    }
  };
  // Cierra el desplegable al pulsar fuera o al usar Escape, sin cerrar la sesión.
  document.addEventListener("click", (event) => {
    if (!$("user-menu").contains(event.target)) $("user-menu").open = false;
  });
  $("user-menu").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      $("user-menu").open = false;
      $("user-menu-toggle").focus();
    }
  });
  // Cierra la sesión directamente; bloquea envíos repetidos mientras responde la API.
  let logoutPending = false;
  $("logout").onclick = async () => {
    if (logoutPending) return;
    logoutPending = true;
    $("user-menu").open = false;
    $("logout").disabled = true;
    $("logout").textContent = "Cerrando sesión…";
    try {
      await request("/api/logout", "POST", {});
      location.replace("/");
    } catch (e) {
      toast(e.message);
    } finally {
      logoutPending = false;
      $("logout").disabled = false;
      $("logout").textContent = "↪ Cerrar sesión";
    }
  };
  // Primero verifica la sesión y carga los datos; solo entonces muestra el dashboard.
  try {
    const { user } = await request("/api/me");
    $("user-name").textContent = user.name;
    $("sidebar-user-name").textContent = user.name;
    activeView = location.hash.slice(1) || "overview";
    await refresh();
    $("loading").hidden = true;
    $("dashboard").hidden = false;
  } catch (e) {
    $("loading").textContent = e.message;
  }
}

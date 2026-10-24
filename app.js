/**
 * INTERFAZ: controla acceso, formularios, dashboard y gráficos SVG.
 * Este módulo se carga en ambas páginas; comprueba qué elementos existen antes de actuar.
 * La API valida y autoriza cada operación: ocultar controles en pantalla no sustituye esa protección.
 */
import {
  parseNumbers,
  statistics,
  validateDatasetName,
  frequencyDistribution,
  groupedSummary,
  boxPlotSummary,
  decile,
} from "/stats.js";
import { requestJson } from "/request.js";
// Atajo para buscar un elemento por su atributo id.
const $ = (id) => document.getElementById(id);
// Envía JSON a la API. La cookie de sesión viaja automáticamente en el mismo origen.
// La cabecera personalizada acompaña las comprobaciones CSRF del servidor.
async function request(path, method = "GET", data) {
  try {
    return await requestJson(path, method, data);
  } catch (error) {
    if (error.status === 401 && location.pathname.startsWith("/dashboard"))
      location.replace("/?session=expired");
    throw error;
  }
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
  $("auth-form").addEventListener("invalid", (event) => {
    $("auth-error").textContent = event.target.validationMessage;
  }, true);
  if (new URLSearchParams(location.search).get("session") === "expired")
    $("auth-error").textContent = "Tu sesión ha terminado. Inicia sesión nuevamente.";
  let register = false;
  let authenticating = false;
  let loadingStarted = 0;
  function setAuthLoading(active) {
    authenticating = active;
    $("auth-loading").hidden = !active;
    $("auth-form").setAttribute("aria-busy", String(active));
    document.querySelector(".auth-layout").inert = active;
    $("auth-submit").disabled = active;
    if (active) {
      loadingStarted = performance.now();
      $("auth-loading-title").textContent = register
        ? "Creando tu cuenta…"
        : "Iniciando sesión…";
      $("auth-loading").focus();
    } else {
      $("auth-submit").focus();
    }
  }
  // Mantiene la animación al menos 3 segundos, contando el tiempo de autenticación.
  async function openDashboard(replace = false) {
    if (!authenticating) setAuthLoading(true);
    const remaining = Math.max(0, 3000 - (performance.now() - loadingStarted));
    await new Promise((resolve) => setTimeout(resolve, remaining));
    if (replace) location.replace("/dashboard");
    else location.assign("/dashboard");
  }
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
    $("auth-submit").textContent = value ? "Crear cuenta" : "Iniciar sesión";
    $("register-tab").hidden = value;
    $("login-tab").hidden = !value;
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
    if (authenticating) return;
    $("auth-error").textContent = "";
    setAuthLoading(true);
    try {
      await request(register ? "/api/register" : "/api/login", "POST", {
        name: $("name").value,
        email: $("email").value,
        password: $("password").value,
      });
      await openDashboard();
    } catch (err) {
      setAuthLoading(false);
      $("auth-error").textContent = err.message;
    }
  };
  request("/api/me")
    .then(() => {
      if (!authenticating) return openDashboard(true);
    })
    .catch((error) => {
      if (error.status !== 401 && !authenticating)
        $("auth-error").textContent = error.message;
    });
}
// DASHBOARD: mantiene los conjuntos guardados, el conjunto seleccionado y el tipo de gráfico.
if ($("dashboard")) {
  let datasets = [],
    current = null,
    values = [],
    chartType = "line";
  // Opciones del selector compartido. Cada gráfica utiliza los mismos datos seleccionados.
  const chartOptions = {
    line: ["line-chart", "Comportamiento de los datos"],
    histogram: ["histogram", "Histograma de frecuencias"],
    "histogram-polygon": [
      "select-histogram-polygon",
      "Histograma y polígono de frecuencia",
    ],
    "frequency-smooth": [
      "select-frequency-smooth",
      "Polígono de frecuencia y suavizado",
    ],
    "relative-frequency": [
      "select-relative-frequency",
      "Distribución de frecuencia relativa",
    ],
    boxplot: ["select-boxplot", "Caja y bigotes"],
  };
  function updateChartSelection() {
    for (const [key, [buttonId]] of Object.entries(chartOptions)) {
      const selected = key === chartType;
      $(buttonId).classList.toggle("active", selected);
      $(buttonId).setAttribute("aria-pressed", String(selected));
      if (!["line", "histogram"].includes(key))
        $("panel-" + key).hidden = !selected;
    }
    $("chart").hidden = !["line", "histogram"].includes(chartType);
    $("chart-title").textContent = chartOptions[chartType][1];
    $("chart-legend").hidden = chartType !== "line";
    $("chart-count").textContent =
      `${current ? values.length : 0} observaciones`;
  }
  let toastTimer;
  let activeView = "overview";
  let historySelection = null;
  // Muestra una notificación temporal y reinicia su temporizador cuando llega otra.
  function toast(message, isError = false) {
    $("toast").setAttribute("role", isError ? "alert" : "status");
    $("toast").textContent = message;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    if (isError) {
      const close = node("button", "Cerrar", "toast-close");
      close.type = "button";
      close.onclick = () => { $("toast").hidden = true; };
      $("toast").append(close);
    } else {
      toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
    }
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
    // Usa exactamente los intervalos de Sturges de la tabla agrupada.
    const grouped = frequencyDistribution(values);
    const bins = grouped.map((bin) => bin.count),
      binCount = grouped.length;
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
          stroke: "var(--chart-grid)",
          "stroke-dasharray": "3 4",
        }),
        svgNode(
          "text",
          {
            x: L - 9,
            y: yy + 4,
            "text-anchor": "end",
            fill: "var(--chart-label)",
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
          fill: "var(--chart-area)",
        }),
      );
      svg.append(
        svgNode("polyline", {
          points,
          fill: "none",
          stroke: "var(--chart-series)",
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
          stroke: "var(--chart-accent)",
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
            fill: "var(--paper)",
            stroke: "var(--chart-series)",
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
              fill: "var(--chart-label)",
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
          fill: i % 2 ? "var(--chart-accent)" : "var(--chart-series)",
        });
        bar.append(
          svgNode(
            "title",
            {},
            `${format(grouped[i].lower)} a ${format(grouped[i].upper)}: ${count} datos`,
          ),
        );
        svg.append(bar);
      });
      svg.append(
        svgNode(
          "text",
          { x: L, y: H - 12, fill: "var(--chart-label)", "font-size": 10 },
          format(s.min),
        ),
        svgNode(
          "text",
          {
            x: W - R,
            y: H - 12,
            "text-anchor": "end",
            fill: "var(--chart-label)",
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
  // Genera las cuatro gráficas con los mismos intervalos y cuartiles del análisis.
  // SVG se crea con nodos y texto, sin inyectar HTML procedente del formulario.
  function renderAdditionalCharts() {
    const ids = [
      "histogram-polygon",
      "frequency-smooth",
      "relative-frequency",
      "boxplot",
    ];
    if (!current || !values.length) {
      for (const id of ids) {
        $(id).replaceChildren(
          node("p", "Selecciona un análisis del historial.", "muted"),
        );
        $(id).setAttribute("aria-label", "Sin análisis seleccionado");
      }
      return;
    }
    const bins = frequencyDistribution(values);
    const W = 680,
      H = 270,
      L = 64,
      R = 22,
      T = 25,
      B = 58,
      w = W - L - R,
      h = H - T - B;
    const blue = "var(--chart-series)",
      red = "var(--chart-accent)";
    const label = (svg, x, y, text, anchor = "middle") =>
      svg.append(
        svgNode(
          "text",
          {
            x,
            y,
            "text-anchor": anchor,
            fill: "var(--chart-label)",
            "font-size": 11,
          },
          text,
        ),
      );
    const line = (svg, x1, y1, x2, y2, color = blue, extra = {}) =>
      svg.append(
        svgNode("line", {
          x1,
          y1,
          x2,
          y2,
          stroke: color,
          "stroke-width": 2,
          ...extra,
        }),
      );
    const makeSvg = () =>
      svgNode("svg", { viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" });
    const mount = (id, svg, description) => {
      $(id).replaceChildren(svg);
      $(id).setAttribute("aria-label", description);
    };
    const x = (i) => L + ((i + 0.5) * w) / bins.length;
    for (const id of ids.slice(0, 3)) {
      const relative = id === "relative-frequency",
        smooth = id === "frequency-smooth",
        svg = makeSvg();
      const peak = Math.max(
        ...bins.map((b) => (relative ? b.relative * 100 : b.count)),
      );
      const ceiling = Math.max(1, peak * 1.2),
        y = (v) => T + h - (v / ceiling) * h;
      for (let i = 0; i <= 4; i++) {
        const v = (ceiling * i) / 4,
          yy = y(v);
        line(svg, L, yy, W - R, yy, "var(--chart-grid)", {
          "stroke-width": 1,
          "stroke-dasharray": "3 4",
        });
        label(svg, L - 9, yy + 4, format(v) + (relative ? " %" : ""), "end");
      }
      bins.forEach((b, i) => {
        if (!smooth) {
          const v = relative ? b.relative * 100 : b.count;
          const bar = svgNode("rect", {
            x: L + (i * w) / bins.length + 2,
            y: y(v),
            width: Math.max(1, w / bins.length - 4),
            height: y(0) - y(v),
            rx: 3,
            fill: relative ? blue : "var(--chart-bar)",
          });
          bar.append(
            svgNode(
              "title",
              {},
              `${format(b.lower)} a ${format(b.upper)}: ${b.count} datos (${format(b.relative * 100)} %)`,
            ),
          );
          svg.append(bar);
        }
        // Limita las etiquetas visibles, sin quitar intervalos del cálculo.
        if (
          bins.length <= 8 ||
          i % Math.ceil(bins.length / 7) === 0 ||
          i === bins.length - 1
        ) {
          label(svg, x(i), H - B + 19, format(b.midpoint));
        }
      });
      if (!relative) {
        const points = bins.map((b, i) => [x(i), y(b.count)]);
        svg.append(
          svgNode("polyline", {
            points: [[L, y(0)], ...points, [W - R, y(0)]]
              .map((p) => p.join(","))
              .join(" "),
            fill: "none",
            stroke: smooth ? blue : red,
            "stroke-width": 2,
          }),
        );
        points.forEach(([px, py], i) => {
          const c = svgNode("circle", {
            cx: px,
            cy: py,
            r: 3.5,
            fill: smooth ? blue : red,
          });
          c.append(
            svgNode(
              "title",
              {},
              `Marca ${format(bins[i].midpoint)}: ${bins[i].count} datos`,
            ),
          );
          svg.append(c);
        });
        if (smooth) {
          // Media móvil centrada, con dos vecinos en los extremos.
          // Las curvas Bézier conectan valores sin sobrepasar el rango de cada segmento.
          const averaged = bins.map((_, i) => {
            const neighbors = bins.slice(
              Math.max(0, i - 1),
              Math.min(bins.length, i + 2),
            );
            return (
              neighbors.reduce((sum, b) => sum + b.count, 0) / neighbors.length
            );
          });
          const points = averaged.map((v, i) => [x(i), y(v)]);
          let path = `M ${points[0][0]} ${points[0][1]}`;
          for (let i = 1; i < points.length; i++) {
            const [ax, ay] = points[i - 1],
              [bx, by] = points[i],
              middle = (ax + bx) / 2;
            path += ` C ${middle} ${ay}, ${middle} ${by}, ${bx} ${by}`;
          }
          svg.append(
            svgNode("path", {
              d: path,
              fill: "none",
              stroke: red,
              "stroke-width": 2.5,
            }),
          );
          if (points.length === 1)
            svg.append(
              svgNode("circle", {
                cx: points[0][0],
                cy: points[0][1],
                r: 5,
                fill: "none",
                stroke: red,
                "stroke-width": 2,
              }),
            );
        }
      }
      label(
        svg,
        L,
        T - 10,
        relative ? "Frecuencia (%)" : "Frecuencia",
        "start",
      );
      label(svg, L + w / 2, H - 8, "Marcas de clase (puntos medios)");
      mount(
        id,
        svg,
        `${relative ? "Distribución de frecuencia relativa" : smooth ? "Polígono y media móvil de tres intervalos" : "Histograma y polígono de frecuencia"}: ${values.length} datos, ${bins.length} intervalos. ${bins.map((b) => `${format(b.lower)} a ${format(b.upper)}: ${b.count} datos, ${format(b.relative * 100)} por ciento`).join("; ")}`,
      );
    }
    // Caja horizontal con bigotes a observaciones reales y puntos atípicos separados.
    const b = boxPlotSummary(values),
      svg = makeSvg();
    const min = Math.min(...values),
      max = Math.max(...values),
      padding = (max - min) * 0.12 || Math.max(Math.abs(min) * 0.05, 1);
    const lo = min - padding,
      hi = max + padding,
      xValue = (v) => L + ((v - lo) / (hi - lo)) * w,
      cy = 110;
    for (let i = 0; i <= 4; i++) {
      const value = lo + ((hi - lo) * i) / 4,
        xx = xValue(value);
      line(svg, xx, T, xx, H - B, "var(--chart-grid)", { "stroke-width": 1 });
      label(svg, xx, H - B + 20, format(value));
    }
    line(svg, xValue(b.lowerWhisker), cy, xValue(b.upperWhisker), cy);
    for (const value of [b.lowerWhisker, b.upperWhisker])
      line(svg, xValue(value), cy - 22, xValue(value), cy + 22);
    svg.append(
      svgNode("rect", {
        x: xValue(b.q1),
        y: cy - 35,
        width: Math.max(0, xValue(b.q3) - xValue(b.q1)),
        height: 70,
        fill: "var(--chart-area)",
        stroke: blue,
        "stroke-width": 2,
      }),
    );
    line(svg, xValue(b.median), cy - 35, xValue(b.median), cy + 35, red, {
      "stroke-width": 3,
    });
    b.outliers.forEach((value, i) => {
      const point = svgNode("circle", {
        cx: xValue(value),
        cy: cy + ((i % 3) - 1) * 8,
        r: 4,
        fill: red,
      });
      point.append(svgNode("title", {}, `Atípico: ${format(value)}`));
      svg.append(point);
    });
    label(svg, L + w / 2, H - 8, "Valores numéricos");
    label(
      svg,
      L,
      T - 10,
      `Q1: ${format(b.q1)} · Mediana: ${format(b.median)} · Q3: ${format(b.q3)}`,
      "start",
    );
    mount(
      "boxplot",
      svg,
      `Caja y bigotes: Q1 ${format(b.q1)}, mediana ${format(b.median)}, Q3 ${format(b.q3)}, bigote inferior ${format(b.lowerWhisker)}, bigote superior ${format(b.upperWhisker)}, ${b.outliers.length} atípicos.`,
    );
  }

  // Q1, Q2 y Q3 son cortes internos; Q4 es el límite superior del conjunto.
  function updateQuartile() {
    const number = Number($("quartile-select").value);
    const hasData = Boolean(current && values.length);
    const valid = Number.isInteger(number) && number >= 1 && number <= 4;
    $("quartile-select").disabled = !hasData;
    let result = 0;
    if (hasData && valid) {
      const stats = statistics(values);
      result = [stats.q1, stats.median, stats.q3, stats.max][number - 1];
    }
    $("quartile-value").textContent = format(result);
    $("quartile-description").textContent = !hasData
      ? "Selecciona un análisis del historial."
      : valid
        ? `Q${number}: percentil ${number * 25}${number === 2 ? "; corresponde a la mediana" : number === 4 ? "; corresponde al valor máximo" : "; calculado con interpolación lineal"}.`
        : "Elige el cuartil que deseas consultar, del Q1 al Q4.";
  }

  // El usuario elige un decil; al cambiar el análisis se actualiza con sus valores.
  function updateDecile() {
    const number = Number($("decile-select").value);
    const hasData = Boolean(current && values.length);
    $("decile-select").disabled = !hasData;
    $("decile-value").textContent =
      hasData && number >= 1 && number <= 10
        ? format(decile(values, number))
        : "0";
    $("decile-description").textContent = !hasData
      ? "Selecciona un análisis del historial."
      : number >= 1 && number <= 10
        ? `D${number}: percentil ${number * 10}. Calculado con interpolación lineal${number === 10 ? "; corresponde al valor máximo" : ""}.`
        : "Elige el decil que deseas consultar, del D1 al D10.";
  }

  // Generalidades y frecuencias calculadas con los valores originales, sin redondearlos antes.
  function renderGroupedData() {
    const g = groupedSummary(current ? values : []);
    $("general-stats").replaceChildren();
    for (const [label, value] of [
      ["Total de datos · n", g.n],
      ["Valor mínimo · Xmin", g.min],
      ["Valor máximo · Xmax", g.max],
      ["Rango · R", g.range],
      ["Rango medio", g.midrange],
      ["Intervalos · K", g.k],
      ["Amplitud · A", g.amplitude],
    ]) {
      const item = node("div", undefined, "general-stat");
      item.append(node("span", label), node("strong", format(value)));
      $("general-stats").append(item);
    }
    $("sturges-note").textContent = !g.n
      ? "Selecciona un análisis del historial para calcular las generalidades."
      : g.range === 0
        ? `Sturges propone K = ${g.sturgesK}. Como todos los valores coinciden, se utiliza una sola clase puntual (K = 1, A = 0).`
        : `K = ⌈1 + log₂(${g.n})⌉ = ${g.k}. R = Xmax − Xmin. Rango medio = (Xmin + Xmax) / 2. A = R / K = ${format(g.amplitude)}.`;
    const bins = frequencyDistribution(current ? values : []);
    const table = node("table"),
      head = node("thead"),
      header = node("tr"),
      body = node("tbody");
    table.setAttribute("aria-labelledby", "frequency-title");
    for (const [label, title] of [
      ["Clase", "Número de clase"],
      ["Intervalo", "Límites inferior y superior"],
      ["xi", "Marca de clase"],
      ["fi", "Frecuencia absoluta"],
      ["Fi", "Frecuencia absoluta acumulada"],
      ["hi", "Frecuencia relativa"],
      ["Hi", "Frecuencia relativa acumulada"],
      ["%", "Porcentaje de la clase"],
    ]) {
      const th = node("th", label);
      th.scope = "col";
      th.title = title;
      header.append(th);
    }
    head.append(header);
    bins.forEach((bin, i) => {
      const row = node("tr");
      const interval = `[${format(bin.lower)}, ${format(bin.upper)}${i === bins.length - 1 ? "]" : ")"}`;
      for (const value of [
        i + 1,
        interval,
        format(bin.midpoint),
        bin.count,
        bin.cumulative,
        format(bin.relative),
        format(bin.cumulativeRelative),
        format(bin.relative * 100) + " %",
      ])
        row.append(node("td", String(value)));
      body.append(row);
    });
    if (!bins.length) {
      const row = node("tr"),
        cell = node(
          "td",
          "Selecciona un análisis para ver su tabla de frecuencia.",
        );
      cell.colSpan = 8;
      row.append(cell);
      body.append(row);
    }
    const foot = node("tfoot"),
      total = node("tr");
    for (const value of [
      "Total",
      "—",
      "—",
      g.n,
      g.n,
      g.n ? "1" : "0",
      g.n ? "1" : "0",
      g.n ? "100 %" : "0 %",
    ])
      total.append(node("td", String(value)));
    foot.append(total);
    table.append(head, body, foot);
    $("grouped-table").replaceChildren(table);
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
    renderGroupedData();
    updateQuartile();
    updateDecile();
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
    renderAdditionalCharts();
    if (hasData && ["line", "histogram"].includes(chartType)) {
      chart(s);
    } else if (!hasData) {
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
    updateChartSelection();
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
    $("values-count").textContent = `${count} de 100 datos`;
    $("values-count").classList.toggle("error", count > 100);
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
  $("quartile-select").addEventListener("change", updateQuartile);
  $("decile-select").addEventListener("change", updateDecile);
  // Todos los botones cambian el tipo de gráfica sin cambiar el conjunto del historial.
  for (const [key, [buttonId]] of Object.entries(chartOptions)) {
    $(buttonId).onclick = () => {
      chartType = key;
      render();
    };
  }
  // Abre el formulario de ingreso y coloca el foco en el nombre del conjunto.
  $("new-analysis").onclick = () => {
    location.hash = "data-entry";
    showView("data-entry");
    $("dataset-name").focus();
  };
  // Valida el texto, solicita guardarlo y vuelve a cargar el conjunto recién creado.
  $("data-form").addEventListener("invalid", (event) => {
    $("data-message").classList.add("error");
    $("data-message").textContent = event.target.validationMessage;
  }, true);
  $("data-form").onsubmit = async (e) => {
    e.preventDefault();
    $("data-message").textContent = "";
    $("data-message").classList.remove("error");
    $("calculate").disabled = true;
    try {
      const name = validateDatasetName($("dataset-name").value);
      parseNumbers($("values").value);
      await request("/api/datasets", "POST", {
        name,
        values: $("values").value,
      });
      try {
        await refresh();
      } catch (error) {
        $("data-message").classList.add("error");
        $("data-message").textContent =
          "El conjunto se guardó, pero no se pudo actualizar la vista. Recarga la página; no necesitas guardarlo otra vez. " + error.message;
        return;
      }
      location.hash = "history";
      showView("history");
      $("data-message").textContent =
        "Conjunto guardado. Selecciónalo en el historial para ver el dashboard.";
      toast(
        "Conjunto guardado. Selecciona su nombre en el historial para visualizarlo.",
      );
    } catch (err) {
      $("data-message").classList.add("error");
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
      try {
        await refresh();
      } catch (error) {
        toast("El conjunto se eliminó, pero no se pudo actualizar la vista. Recarga la página. " + error.message, true);
        return;
      }
      toast("Conjunto eliminado.");
    } catch (e) {
      toast(e.message, true);
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
      toast(e.message, true);
    } finally {
      logoutPending = false;
      $("logout").disabled = false;
      $("logout").textContent = "↪ Cerrar sesión";
    }
  };
  // Primero verifica la sesión y carga los datos; solo entonces muestra el dashboard.
  $("dashboard-retry").onclick = () => location.reload();
  try {
    const { user } = await request("/api/me");
    $("user-name").textContent = user.name;
    $("sidebar-user-name").textContent = user.name;
    activeView = location.hash.slice(1) || "overview";
    await refresh();
    $("loading").hidden = true;
    $("dashboard").hidden = false;
  } catch (e) {
    $("dashboard-loading-chart").hidden = true;
    $("dashboard-loading-title").textContent = e.message;
    $("dashboard-loading-caption").textContent =
      "Recarga la página para volver a intentarlo.";
    $("loading").setAttribute("role", "alert");
    $("dashboard-retry").hidden = false;
  }
}

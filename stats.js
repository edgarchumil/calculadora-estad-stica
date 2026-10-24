/**
 * ESTADÍSTICA: funciones compartidas por navegador y servidor, sin acceso al DOM.
 * parseNumbers convierte el texto; statistics calcula resultados sin alterar el arreglo original.
 */
// Reglas compartidas para el nombre: Unicode permite letras acentuadas sin aceptar etiquetas.
// Normaliza a NFC y quita espacios exteriores. No modifica ni interpreta instrucciones SQL.
export function validateDatasetName(value) {
  if (typeof value !== "string" || value.length > 80) {
    throw Error("El nombre del conjunto debe tener entre 2 y 80 caracteres.");
  }
  const name = value.normalize("NFC").trim();
  if (name.length < 2 || name.length > 80) {
    throw Error("El nombre del conjunto debe tener entre 2 y 80 caracteres.");
  }
  if (
    !/^[\p{L}\p{M}\p{N} .,_()'’%&+:/-]+$/u.test(value) ||
    !/[\p{L}\p{N}]/u.test(name)
  ) {
    throw Error(
      "Usa letras, números, espacios o signos habituales (. , _ - ( ) ' % & + : /). No se permiten etiquetas ni caracteres invisibles.",
    );
  }
  return name;
}

// Acepta comas, punto y coma, espacios o saltos de línea como separadores.
// El decimal se escribe con punto; también admite negativos y notación científica.
export function parseNumbers(text) {
  if (typeof text !== "string" || text.length > 4000)
    throw Error("Ingresa como máximo 100 números.");
  // La expresión regular valida el token completo: evita aceptar parcialmente texto como "12abc".
  const tokens = text.trim().split(/[\s,;]+/);
  if (tokens.length > 100)
    throw Error("Solo puedes ingresar un máximo de 100 datos por conjunto.");
  if (
    !text.trim() ||
    tokens.some((t) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(t))
  )
    throw Error(
      "Usa números separados por comas, espacios o saltos de línea. Para decimales utiliza punto.",
    );
  // Además del formato, rechaza Infinity, NaN y magnitudes mayores que 10¹².
  const values = tokens.map(Number);
  if (values.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e12))
    throw Error("Los valores deben ser finitos y estar entre −10¹² y 10¹².");
  return values;
}
// values debe ser un arreglo no vacío de números ya validados.
// Los resultados usan números de punto flotante, por lo que puede haber redondeo.
export function statistics(values) {
  // Ordena una copia numéricamente: sort() sin comparador ordenaría como texto.
  const sorted = [...values].sort((a, b) => a - b),
    n = values.length;
  if (!n) throw Error("Se requiere al menos un dato.");
  // Cuantiles tipo 7: posición (n − 1) × p e interpolación entre los dos vecinos.
  // Para la mediana p=0.5; para Q1 p=0.25 y Q3 p=0.75.
  const quantile = (p) => quantileSorted(sorted, p);
  // Media = suma / n. Varianza poblacional = promedio de las distancias al cuadrado respecto a la media.
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  // Un Map cuenta cuántas veces aparece cada valor. Devuelve todas las modas empatadas;
  // si ningún valor se repite, modes queda vacío.
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  const maxFrequency = Math.max(...counts.values());
  const modes =
    maxFrequency === 1
      ? []
      : [...counts]
          .filter(([, f]) => f === maxFrequency)
          .map(([v]) => v)
          .sort((a, b) => a - b);
  // Regresión lineal: el eje X es el índice en el orden de ingreso, no una fecha.
  // La pendiente mide el cambio por observación; con un solo dato se usa cero.
  const center = (n - 1) / 2,
    den = values.reduce((a, _, i) => a + (i - center) ** 2, 0);
  const slope = den
    ? values.reduce((a, v, i) => a + (i - center) * (v - mean), 0) / den
    : 0;
  // RIC (iqr) = Q3 − Q1: amplitud del 50% central de los datos.
  const q1 = quantile(0.25),
    q3 = quantile(0.75),
    iqr = q3 - q1;
  // std es la raíz de la varianza; la varianza muestral usa n−1 y es null con un dato.
  // Los atípicos se detectan fuera de Q1−1.5×RIC y Q3+1.5×RIC, sin eliminarlos.
  return {
    n,
    mean,
    median: quantile(0.5),
    modes,
    q1,
    q3,
    iqr,
    min: sorted[0],
    max: sorted[n - 1],
    range: sorted[n - 1] - sorted[0],
    variance,
    std: Math.sqrt(variance),
    sampleVariance: n > 1 ? (variance * n) / (n - 1) : null,
    slope,
    intercept: mean - slope * center,
    outliers: values.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr),
    sorted,
  };
}

// Sturges: K = ceil(1 + log2(n)), equivalente a redondear hacia arriba 1 + 3.321928×log10(n).
// Sin variación se usa un único intervalo puntual: R=0, A=0, sin inventar límites.
export function groupedSummary(values) {
  const n = values.length;
  if (!n)
    return {
      n: 0,
      min: 0,
      max: 0,
      range: 0,
      midrange: 0,
      sturgesK: 0,
      k: 0,
      amplitude: 0,
    };
  const min = Math.min(...values),
    max = Math.max(...values),
    range = max - min;
  const sturgesK = Math.ceil(1 + Math.log2(n));
  const k = range === 0 ? 1 : sturgesK;
  return {
    n,
    min,
    max,
    range,
    midrange: (min + max) / 2,
    sturgesK,
    k,
    amplitude: range / k,
  };
}

// Intervalos [Li, Ls); el último incluye Xmax. Las mismas clases alimentan tabla y gráficas.
export function frequencyDistribution(values) {
  const g = groupedSummary(values);
  if (!g.n) return [];
  const bins = Array.from({ length: g.k }, (_, i) => ({
    lower: g.min + i * g.amplitude,
    upper: i === g.k - 1 ? g.max : g.min + (i + 1) * g.amplitude,
    midpoint: g.min + (i + 0.5) * g.amplitude,
    count: 0,
    relative: 0,
    cumulative: 0,
    cumulativeRelative: 0,
  }));
  for (const value of values) {
    // Comparar con los límites reales evita diferencias de redondeo entre la tabla y el conteo.
    const index = bins.findIndex(
      (bin, i) => value < bin.upper || i === bins.length - 1,
    );
    bins[index].count++;
  }
  let total = 0;
  for (const bin of bins) {
    total += bin.count;
    bin.relative = bin.count / g.n;
    bin.cumulative = total;
    bin.cumulativeRelative = total / g.n;
  }
  return bins;
}

// Bigotes de Tukey: llegan a observaciones reales dentro de las cercas de 1.5×RIC.
export function boxPlotSummary(values) {
  const s = statistics(values);
  const inside = s.sorted.filter(
    (v) => v >= s.q1 - 1.5 * s.iqr && v <= s.q3 + 1.5 * s.iqr,
  );
  return {
    q1: s.q1,
    median: s.median,
    q3: s.q3,
    lowerWhisker: inside[0],
    upperWhisker: inside[inside.length - 1],
    outliers: s.outliers,
  };
}

// Interpolación tipo 7, compartida por cuartiles y deciles: posición (n−1)×p.
function quantileSorted(sorted, probability) {
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  return (
    sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower)
  );
}

// D1…D9 son puntos de corte internos; D10 representa el percentil 100 (máximo).
export function decile(values, number) {
  if (!Number.isInteger(number) || number < 1 || number > 10) {
    throw Error("Selecciona un decil del 1 al 10.");
  }
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.some((v) => typeof v !== "number" || !Number.isFinite(v))
  ) {
    throw Error("Selecciona un análisis con datos numéricos válidos.");
  }
  return quantileSorted(
    [...values].sort((a, b) => a - b),
    number / 10,
  );
}

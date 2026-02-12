const API_BASE = "https://api.frankfurter.app";
const defaultPair = { from: "CZK", to: "EUR" };

const elements = {
  from: document.getElementById("from"),
  to: document.getElementById("to"),
  swap: document.getElementById("swap"),
  tabs: Array.from(document.querySelectorAll(".tab[data-range]")),
  toggleExtremes: document.getElementById("toggleExtremes"),
  toggleMetrics: document.getElementById("toggleMetrics"),
  toggleDetails: document.getElementById("toggleDetails"),
  toggleMa7: document.getElementById("toggleMa7"),
  toggleMa30: document.getElementById("toggleMa30"),
  toggleMa90: document.getElementById("toggleMa90"),
  metricsCard: document.getElementById("metricsCard"),
  detailsCard: document.getElementById("detailsCard"),
  chart: document.getElementById("chart"),
  tooltip: document.getElementById("tooltip"),
  current: document.getElementById("current"),
  range: document.getElementById("range"),
  change: document.getElementById("change"),
  trend: document.getElementById("trend"),
  trendFill: document.getElementById("trendFill"),
  pair: document.getElementById("pair"),
  period: document.getElementById("period"),
  updated: document.getElementById("updated"),
  metricAvg: document.getElementById("metricAvg"),
  metricMedian: document.getElementById("metricMedian"),
  metricMa7: document.getElementById("metricMa7"),
  metricMa30: document.getElementById("metricMa30"),
  metricMa90: document.getElementById("metricMa90"),
  metricVol: document.getElementById("metricVol"),
  metricDrawdown: document.getElementById("metricDrawdown"),
  metricBest: document.getElementById("metricBest"),
  metricWorst: document.getElementById("metricWorst"),
  metricStreaks: document.getElementById("metricStreaks"),
  metricSlope: document.getElementById("metricSlope"),
  metricZ: document.getElementById("metricZ"),
  metricPct: document.getElementById("metricPct"),
  metricMTD: document.getElementById("metricMTD"),
  metricYTD: document.getElementById("metricYTD"),
  toast: document.getElementById("toast"),
};

const ranges = {
  "2w": { type: "days", value: 14, label: "2 Wochen" },
  "1m": { type: "months", value: 1, label: "1 Monat" },
  "3m": { type: "months", value: 3, label: "3 Monate" },
  "6m": { type: "months", value: 6, label: "6 Monate" },
  "1y": { type: "months", value: 12, label: "1 Jahr" },
  "3y": { type: "months", value: 36, label: "3 Jahre" },
};

let activeRange = "3m";
let currentData = [];
let currentSeries = { visible: [], full: [], startIndex: 0 };
let hoverIndex = null;
let chartState = null;
let showExtremes = true;
let showMetrics = true;
let showDetails = true;
let showMa7 = true;
let showMa30 = true;
let showMa90 = true;

const MA_LOOKBACK_DAYS = 104;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 2800);
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatNumber(value, decimals = 4) {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatPercent(value) {
  return new Intl.NumberFormat("de-DE", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function setActiveTab(rangeKey) {
  activeRange = rangeKey;
  elements.tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.range === rangeKey);
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getRangeDates(rangeKey) {
  const config = ranges[rangeKey] || ranges["3m"];
  const end = new Date();
  let start;

  if (config.type === "days") {
    start = new Date(end);
    start.setDate(end.getDate() - (config.value - 1));
  } else {
    const endDay = end.getDate();
    let targetMonth = end.getMonth() - config.value;
    let targetYear = end.getFullYear();
    while (targetMonth < 0) {
      targetMonth += 12;
      targetYear -= 1;
    }
    const safeDay = Math.min(endDay, daysInMonth(targetYear, targetMonth));
    start = new Date(targetYear, targetMonth, safeDay);
  }

  return {
    start: formatLocalDate(start),
    end: formatLocalDate(end),
  };
}

function shiftDate(dateString, deltaDays) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return formatLocalDate(date);
}

async function fetchCurrencies() {
  const response = await fetch(`${API_BASE}/currencies`);
  if (!response.ok) throw new Error("Währungen konnten nicht geladen werden.");
  return response.json();
}

async function fetchRates(from, to, start, end) {
  const url = `${API_BASE}/${start}..${end}?from=${from}&to=${to}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Kursdaten konnten nicht geladen werden.");
  const data = await response.json();
  const entries = Object.entries(data.rates)
    .map(([date, rateObj]) => ({ date, value: rateObj[to] }))
    .sort((a, b) => (a.date > b.date ? 1 : -1));
  return entries;
}

function buildDailySeries(entries, start, end) {
  if (entries.length === 0) return [];

  const rateMap = new Map(entries.map((entry) => [entry.date, entry.value]));
  const days = [];
  const cursor = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);

  while (cursor <= endDate) {
    days.push(formatLocalDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  let nextKnown = null;
  const nextMap = new Map();
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const day = days[i];
    if (rateMap.has(day)) {
      nextKnown = rateMap.get(day);
    }
    nextMap.set(day, nextKnown);
  }

  const filled = [];
  let lastValue = null;
  days.forEach((day) => {
    if (rateMap.has(day)) {
      lastValue = rateMap.get(day);
      filled.push({ date: day, value: lastValue, filled: false });
      return;
    }

    const fallback = lastValue ?? nextMap.get(day);
    if (fallback !== null && fallback !== undefined) {
      filled.push({ date: day, value: fallback, filled: true });
    }
  });

  return filled;
}

function updateStats(from, to, data) {
  if (data.length === 0) {
    elements.current.textContent = "–";
    elements.range.textContent = "–";
    elements.change.textContent = "–";
    elements.trend.innerHTML = '<span class="trend-arrow">–</span><span class="trend-text">Keine Daten</span>';
    elements.trendFill.style.width = "0%";
    return;
  }

  const first = data[0].value;
  const last = data[data.length - 1].value;
  const min = Math.min(...data.map((d) => d.value));
  const max = Math.max(...data.map((d) => d.value));
  const change = last - first;
  const changePct = first !== 0 ? change / first : 0;

  elements.current.textContent = `1 ${from} = ${formatNumber(last)} ${to}`;
  elements.range.textContent = `${formatNumber(min)} – ${formatNumber(max)} ${to}`;
  elements.change.textContent = `${formatNumber(change, 4)} (${formatPercent(changePct)})`;

  let arrow = "■";
  let text = "Seitwärts";
  let color = getComputedStyle(document.documentElement).getPropertyValue("--neutral");

  if (change > 0) {
    arrow = "▲";
    text = "Aufwärts";
    color = getComputedStyle(document.documentElement).getPropertyValue("--positive");
  } else if (change < 0) {
    arrow = "▼";
    text = "Abwärts";
    color = getComputedStyle(document.documentElement).getPropertyValue("--negative");
  }

  elements.trend.innerHTML = `<span class="trend-arrow">${arrow}</span><span class="trend-text">${text} · ${formatPercent(changePct)}</span>`;
  elements.trend.style.color = color.trim();

  const intensity = clamp(Math.abs(changePct) * 400 + 10, 10, 100);
  elements.trendFill.style.width = `${intensity}%`;
  elements.trendFill.style.background = `linear-gradient(90deg, ${color}33, ${color}dd)`;

  elements.pair.textContent = `${from} → ${to}`;
}

function updateMeta(data, rangeKey) {
  if (data.length === 0) {
    elements.period.textContent = "–";
    elements.updated.textContent = "–";
    return;
  }
  const firstDate = data[0].date;
  const lastDate = data[data.length - 1].date;
  const rangeLabelMap = {
    "2w": ranges["2w"].label,
    "1m": ranges["1m"].label,
    "3m": ranges["3m"].label,
    "6m": ranges["6m"].label,
    "1y": ranges["1y"].label,
    "3y": ranges["3y"].label,
  };
  elements.period.textContent = `${rangeLabelMap[rangeKey] || "Zeitraum"} (${firstDate} – ${lastDate})`;
  elements.updated.textContent = lastDate;
}

function updateMetrics(data) {
  if (!data || data.length === 0) {
    elements.metricAvg.textContent = "–";
    elements.metricMedian.textContent = "–";
    elements.metricMa7.textContent = "–";
    elements.metricMa30.textContent = "–";
    elements.metricMa90.textContent = "–";
    elements.metricVol.textContent = "–";
    elements.metricDrawdown.textContent = "–";
    elements.metricBest.textContent = "–";
    elements.metricWorst.textContent = "–";
    elements.metricStreaks.textContent = "–";
    elements.metricSlope.textContent = "–";
    elements.metricZ.textContent = "–";
    elements.metricPct.textContent = "–";
    elements.metricMTD.textContent = "–";
    elements.metricYTD.textContent = "–";
    return;
  }

  const actualData = data.filter((d) => !d.filled);
  const series = actualData.length >= 2 ? actualData : data;
  const values = series.map((d) => d.value);
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

  const averageSlice = (windowSize) => {
    if (values.length < windowSize) return null;
    const slice = values.slice(values.length - windowSize);
    return slice.reduce((sum, v) => sum + v, 0) / windowSize;
  };

  const ma7 = averageSlice(7);
  const ma30 = averageSlice(30);
  const ma90 = averageSlice(90);

  const returns = [];
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1].value;
    const curr = series[i].value;
    if (prev !== 0) {
      returns.push((curr - prev) / prev);
    }
  }

  let volatility = 0;
  let best = null;
  let worst = null;
  if (returns.length > 0) {
    const meanRet = returns.reduce((sum, v) => sum + v, 0) / returns.length;
    const variance =
      returns.reduce((sum, v) => sum + Math.pow(v - meanRet, 2), 0) /
      returns.length;
    volatility = Math.sqrt(variance);
    best = Math.max(...returns);
    worst = Math.min(...returns);
  }

  let peak = values[0];
  let maxDrawdown = 0;
  values.forEach((value) => {
    if (value > peak) peak = value;
    const drawdown = peak !== 0 ? (value - peak) / peak : 0;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  });

  let maxUp = 0;
  let maxDown = 0;
  let currentUp = 0;
  let currentDown = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[i - 1]) {
      currentUp += 1;
      currentDown = 0;
    } else if (values[i] < values[i - 1]) {
      currentDown += 1;
      currentUp = 0;
    } else {
      currentUp = 0;
      currentDown = 0;
    }
    if (currentUp > maxUp) maxUp = currentUp;
    if (currentDown > maxDown) maxDown = currentDown;
  }

  let slope = null;
  if (values.length >= 2) {
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;
    const n = values.length;
    for (let i = 0; i < n; i += 1) {
      const x = i;
      const y = values[i];
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    const denominator = n * sumX2 - sumX * sumX;
    if (denominator !== 0) {
      slope = (n * sumXY - sumX * sumY) / denominator;
    }
  }

  const std = values.length
    ? Math.sqrt(
        values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
      )
    : 0;
  const last = values[values.length - 1];
  const zScore = std ? (last - mean) / std : null;

  const countLeq = sorted.filter((v) => v <= last).length;
  const percentile =
    sorted.length > 1 ? (countLeq - 1) / (sorted.length - 1) : null;

  const latestDate = series[series.length - 1]?.date;
  let mtd = null;
  let ytd = null;
  if (latestDate) {
    const latest = parseDateString(latestDate);
    const monthStart = new Date(latest.getFullYear(), latest.getMonth(), 1);
    const yearStart = new Date(latest.getFullYear(), 0, 1);
    const monthStartStr = formatLocalDate(monthStart);
    const yearStartStr = formatLocalDate(yearStart);

    const earliest = series[0]?.date;
    const monthStartItem =
      earliest && earliest <= monthStartStr
        ? series.find((item) => item.date >= monthStartStr)
        : null;
    const yearStartItem =
      earliest && earliest <= yearStartStr
        ? series.find((item) => item.date >= yearStartStr)
        : null;
    if (monthStartItem) {
      mtd = monthStartItem.value !== 0 ? (last - monthStartItem.value) / monthStartItem.value : null;
    }
    if (yearStartItem) {
      ytd = yearStartItem.value !== 0 ? (last - yearStartItem.value) / yearStartItem.value : null;
    }
  }

  elements.metricAvg.textContent = formatNumber(mean);
  elements.metricMedian.textContent = formatNumber(median);
  elements.metricMa7.textContent = ma7 !== null ? formatNumber(ma7) : "–";
  elements.metricMa30.textContent = ma30 !== null ? formatNumber(ma30) : "–";
  elements.metricMa90.textContent = ma90 !== null ? formatNumber(ma90) : "–";
  elements.metricVol.textContent = returns.length ? formatPercent(volatility) : "–";
  elements.metricDrawdown.textContent = formatPercent(maxDrawdown);
  elements.metricBest.textContent = best !== null ? formatPercent(best) : "–";
  elements.metricWorst.textContent = worst !== null ? formatPercent(worst) : "–";
  elements.metricStreaks.textContent = `${maxUp} / ${maxDown}`;
  elements.metricSlope.textContent =
    slope !== null && values[0] ? formatPercent(slope / values[0]) : "–";
  elements.metricZ.textContent = zScore !== null ? zScore.toFixed(2) : "–";
  elements.metricPct.textContent = percentile !== null ? formatPercent(percentile) : "–";
  elements.metricMTD.textContent = mtd !== null ? formatPercent(mtd) : "–";
  elements.metricYTD.textContent = ytd !== null ? formatPercent(ytd) : "–";
}

function parseDateString(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatAxisDate(dateString, includeYear) {
  const date = parseDateString(dateString);
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "short",
    ...(includeYear ? { year: "2-digit" } : {}),
  });
}

function buildTickIndices(data) {
  const count = data.length;
  if (count <= 1) return [0];

  const maxTicks = 7;
  const step = Math.ceil(count / maxTicks);
  const indices = new Set();
  for (let i = 0; i < count; i += step) {
    indices.add(i);
  }
  indices.add(count - 1);

  return Array.from(indices).sort((a, b) => a - b);
}

function drawChart(data) {
  const canvas = elements.chart;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, rect.width, rect.height);

  if (data.length === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "16px Sora";
    ctx.fillText("Keine Daten verfügbar", 20, 40);
    return;
  }

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = (max - min) * 0.08 || 0.01;
  const minY = min - padding;
  const maxY = max + padding;

  const left = 48;
  const top = 24;
  const right = rect.width - 20;
  const bottom = rect.height - 40;
  const width = right - left;
  const height = bottom - top;

  chartState = { rect, left, right, top, bottom, minY, maxY, data };

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i += 1) {
    const y = top + (height / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();

  const tickIndices = buildTickIndices(data);
  const includeYear = data.length >= 180;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "11px Sora";
  tickIndices.forEach((index) => {
    const ratioX = data.length === 1 ? 0.5 : index / (data.length - 1);
    const x = left + ratioX * width;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, bottom + 6);
    ctx.stroke();

    const label = formatAxisDate(data[index].date, includeYear);
    const textWidth = ctx.measureText(label).width;
    ctx.fillText(label, x - textWidth / 2, bottom + 22);
  });

  const first = data[0].value;
  const last = data[data.length - 1].value;
  const trendUp = last >= first;
  const lineColor = trendUp
    ? getComputedStyle(document.documentElement).getPropertyValue("--positive").trim()
    : getComputedStyle(document.documentElement).getPropertyValue("--negative").trim();

  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);
  const maxIndex = values.indexOf(maxValue);
  const minIndex = values.indexOf(minValue);

  const drawAxisMarker = (index, label, color) => {
    if (index < 0) return;
    const ratioX = data.length === 1 ? 0.5 : index / (data.length - 1);
    const x = left + ratioX * width;
    const text = `${label}: ${formatAxisDate(data[index].date, includeYear)}`;
    ctx.strokeStyle = `${color}cc`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, bottom + 10);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = "11px Sora";
    const textWidth = ctx.measureText(text).width;
    ctx.fillText(text, x - textWidth / 2, bottom + 38);
  };

  const highColor = getComputedStyle(document.documentElement).getPropertyValue("--positive").trim() || "#16a34a";
  const lowColor = getComputedStyle(document.documentElement).getPropertyValue("--negative").trim() || "#dc2626";
  if (showExtremes) {
    drawAxisMarker(maxIndex, "Hoch", highColor);
    if (minIndex !== maxIndex) {
      drawAxisMarker(minIndex, "Tief", lowColor);
    }
  }

  const fullSeries = currentSeries.full.length ? currentSeries.full : data;
  const fullValues = fullSeries.map((point) => point.value);
  const startIndex = currentSeries.startIndex ?? 0;

  const drawMovingAverage = (windowSize, color) => {
    if (fullValues.length < windowSize) return;
    let sum = 0;
    let started = false;
    ctx.beginPath();
    for (let i = 0; i < fullValues.length; i += 1) {
      sum += fullValues[i];
      if (i >= windowSize) {
        sum -= fullValues[i - windowSize];
      }
      if (i < windowSize - 1) continue;
      if (i < startIndex) continue;
      const visIndex = i - startIndex;
      if (visIndex >= data.length) break;
      const avg = sum / windowSize;
      const ratioX = data.length === 1 ? 0.5 : visIndex / (data.length - 1);
      const x = left + ratioX * width;
      const ratioY = (avg - minY) / (maxY - minY);
      const y = bottom - ratioY * height;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (!started) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.shadowColor = "transparent";
    ctx.stroke();
  };

  if (showMa7) {
    const ma7Color = getComputedStyle(document.documentElement).getPropertyValue("--ma7").trim();
    drawMovingAverage(7, ma7Color || "#7aa7ff");
  }
  if (showMa30) {
    const ma30Color = getComputedStyle(document.documentElement).getPropertyValue("--ma30").trim();
    drawMovingAverage(30, ma30Color || "#fbbf24");
  }
  if (showMa90) {
    const ma90Color = getComputedStyle(document.documentElement).getPropertyValue("--ma90").trim();
    drawMovingAverage(90, ma90Color || "#22d3ee");
  }

  const legendItems = [
    { label: "GD 7", color: getComputedStyle(document.documentElement).getPropertyValue("--ma7").trim() || "#7aa7ff", visible: showMa7 },
    { label: "GD 30", color: getComputedStyle(document.documentElement).getPropertyValue("--ma30").trim() || "#fbbf24", visible: showMa30 },
    { label: "GD 90", color: getComputedStyle(document.documentElement).getPropertyValue("--ma90").trim() || "#22d3ee", visible: showMa90 },
  ].filter((item) => item.visible);

  if (legendItems.length > 0) {
    ctx.font = "11px Sora";
    const lineWidth = 16;
    const gap = 6;
    const legendX = left + 6;
    let legendY = Math.max(8, top - 12);

    legendItems.forEach((item) => {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(legendX, legendY + 5);
      ctx.lineTo(legendX + lineWidth, legendY + 5);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText(item.label, legendX + lineWidth + gap, legendY + 9);
      legendY += 16;
    });
  }

  ctx.beginPath();
  data.forEach((point, index) => {
    const ratioX = data.length === 1 ? 0.5 : index / (data.length - 1);
    const x = left + ratioX * width;
    const ratioY = (point.value - minY) / (maxY - minY);
    const y = bottom - ratioY * height;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = `${lineColor}55`;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, `${lineColor}55`);
  gradient.addColorStop(1, "rgba(10,16,36,0)");

  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  const drawExtreme = (index, label, value, color) => {
    if (index < 0) return;
    const ratioX = data.length === 1 ? 0.5 : index / (data.length - 1);
    const x = left + ratioX * width;
    const ratioY = (value - minY) / (maxY - minY);
    const y = bottom - ratioY * height;
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = `${color}aa`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    const valueLabel = `1 ${elements.from.value} = ${formatNumber(value)} ${elements.to.value}`;
    ctx.font = "12px Sora";
    const paddingX = 8;
    const paddingY = 6;
    const lineHeight = 14;
    const textWidth = ctx.measureText(valueLabel).width;
    const boxWidth = textWidth + paddingX * 2;
    const boxHeight = lineHeight + paddingY * 2;
    const boxX = Math.min(Math.max(x + 8, left), right - boxWidth);
    const boxY = Math.min(Math.max(y - boxHeight / 2, top), bottom - boxHeight);

    ctx.fillStyle = "rgba(10, 18, 42, 0.9)";
    ctx.strokeStyle = `${color}cc`;
    ctx.lineWidth = 1;
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
    ctx.fillStyle = color;
    ctx.fillText(valueLabel, boxX + paddingX, boxY + paddingY + lineHeight - 2);
    ctx.restore();
  };

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  if (showExtremes) {
    drawExtreme(maxIndex, "", maxValue, highColor || accent);
    drawExtreme(minIndex, "", minValue, lowColor || accent);
  }

  const lastPoint = data[data.length - 1];
  const lastX = left + width;
  const lastRatioY = (lastPoint.value - minY) / (maxY - minY);
  const lastY = bottom - lastRatioY * height;

  ctx.beginPath();
  ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.fill();

  if (hoverIndex !== null && data[hoverIndex]) {
    const point = data[hoverIndex];
    const ratioX = data.length === 1 ? 0.5 : hoverIndex / (data.length - 1);
    const x = left + ratioX * width;
    const ratioY = (point.value - minY) / (maxY - minY);
    const y = bottom - ratioY * height;

    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

async function refresh() {
  try {
    hoverIndex = null;
    elements.tooltip.classList.remove("show");
    const from = elements.from.value;
    const to = elements.to.value;
    const { start, end } = getRangeDates(activeRange);
    const fetchStart = shiftDate(start, -MA_LOOKBACK_DAYS);

    const raw = await fetchRates(from, to, fetchStart, end);
    const full = buildDailySeries(raw, fetchStart, end);
    const startIndex = full.findIndex((item) => item.date === start);
    const data = full.filter((item) => item.date >= start);
    currentSeries = { visible: data, full, startIndex: Math.max(0, startIndex) };
    currentData = data;
    updateStats(from, to, data);
    updateMeta(data, activeRange);
    updateMetrics(data);
    drawChart(data);
  } catch (error) {
    console.error(error);
    showToast("Daten konnten nicht geladen werden.");
  }
}

async function init() {
  try {
    const currencies = await fetchCurrencies();
    const entries = Object.entries(currencies).sort();
    entries.forEach(([code, name]) => {
      const optionFrom = document.createElement("option");
      optionFrom.value = code;
      optionFrom.textContent = `${code} — ${name}`;
      elements.from.appendChild(optionFrom);

      const optionTo = document.createElement("option");
      optionTo.value = code;
      optionTo.textContent = `${code} — ${name}`;
      elements.to.appendChild(optionTo);
    });

    elements.from.value = defaultPair.from;
    elements.to.value = defaultPair.to;

    setActiveTab(activeRange);
    await refresh();
  } catch (error) {
    console.error(error);
    showToast("Währungen konnten nicht geladen werden.");
  }
}

elements.swap.addEventListener("click", () => {
  const fromValue = elements.from.value;
  elements.from.value = elements.to.value;
  elements.to.value = fromValue;
  refresh();
});

elements.from.addEventListener("change", refresh);

elements.to.addEventListener("change", refresh);

elements.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setActiveTab(tab.dataset.range);
    hoverIndex = null;
    elements.tooltip.classList.remove("show");
    refresh();
  });
});

elements.toggleExtremes.addEventListener("click", () => {
  showExtremes = !showExtremes;
  elements.toggleExtremes.classList.toggle("active", showExtremes);
  drawChart(currentData);
});

elements.toggleMetrics.addEventListener("click", () => {
  showMetrics = !showMetrics;
  elements.toggleMetrics.classList.toggle("active", showMetrics);
  elements.metricsCard.classList.toggle("hidden", !showMetrics);
});

elements.toggleDetails.addEventListener("click", () => {
  showDetails = !showDetails;
  elements.toggleDetails.classList.toggle("active", showDetails);
  elements.detailsCard.classList.toggle("hidden", !showDetails);
});

elements.toggleMa7.addEventListener("click", () => {
  showMa7 = !showMa7;
  elements.toggleMa7.classList.toggle("active", showMa7);
  drawChart(currentData);
});

elements.toggleMa30.addEventListener("click", () => {
  showMa30 = !showMa30;
  elements.toggleMa30.classList.toggle("active", showMa30);
  drawChart(currentData);
});

elements.toggleMa90.addEventListener("click", () => {
  showMa90 = !showMa90;
  elements.toggleMa90.classList.toggle("active", showMa90);
  drawChart(currentData);
});

elements.chart.addEventListener("mousemove", (event) => {
  if (!chartState || currentData.length === 0) return;
  const { rect, left, right, top, bottom, minY, maxY, data } = chartState;
  const x = event.clientX - rect.left;
  const width = right - left;
  const ratio = clamp((x - left) / width, 0, 1);
  const index = Math.round(ratio * (data.length - 1));
  hoverIndex = index;
  drawChart(currentData);

  const point = data[index];
  const ratioY = (point.value - minY) / (maxY - minY);
  const y = bottom - ratioY * (bottom - top);
  const tooltipX = left + ratio * width;
  const tooltipY = y;

  const note = point.filled ? " · fortgeschrieben" : "";
  elements.tooltip.innerHTML = `
    <div class="tooltip-date">${point.date}${note}</div>
    <div class="tooltip-value">1 ${elements.from.value} = ${formatNumber(point.value)} ${elements.to.value}</div>
  `;
  elements.tooltip.style.left = `${tooltipX + 18}px`;
  elements.tooltip.style.top = `${tooltipY + 6}px`;
  elements.tooltip.classList.add("show");
});

elements.chart.addEventListener("mouseleave", () => {
  hoverIndex = null;
  elements.tooltip.classList.remove("show");
  drawChart(currentData);
});

window.addEventListener("resize", () => drawChart(currentData));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

init();

const tipTargets = Array.from(document.querySelectorAll(".tip-target"));

tipTargets.forEach((target) => {
  target.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = target.classList.contains("tip-open");
    tipTargets.forEach((item) => item.classList.remove("tip-open"));
    if (!isOpen) {
      target.classList.add("tip-open");
    }
  });

  target.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      target.click();
    }
  });
});

document.addEventListener("click", () => {
  tipTargets.forEach((item) => item.classList.remove("tip-open"));
});

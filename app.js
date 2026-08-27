const ASSETS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "AUD/USD",
  "USD/CAD", "NZD/USD", "EUR/JPY", "GBP/JPY", "EUR/GBP"
];

const assetSelect = document.getElementById("asset");
const btnSignal = document.getElementById("btnSignal");
const resultDiv = document.getElementById("result");
const apiKeyInput = document.getElementById("apiKey");
const btnSaveKey = document.getElementById("btnSaveKey");

ASSETS.forEach(a => {
  const opt = document.createElement("option");
  opt.value = a;
  opt.textContent = a;
  assetSelect.appendChild(opt);
});

apiKeyInput.value = localStorage.getItem("twelve_data_api_key") || "";

btnSaveKey.addEventListener("click", () => {
  localStorage.setItem("twelve_data_api_key", apiKeyInput.value.trim());
  btnSaveKey.textContent = "✅ Clé enregistrée";
  setTimeout(() => (btnSaveKey.textContent = "Enregistrer la clé"), 1500);
});

function ema(values, period) {
  const k = 2 / (period + 1);
  const result = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function rsi(values, period = 14) {
  const result = new Array(values.length).fill(50);
  if (values.length <= period) return result;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result[i] = 100 - 100 / (1 + rs);
  }
  return result;
}

function macd(values) {
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

function analyze(candles) {
  if (candles.length < 30) return null;

  const closes = candles.map(c => c.close);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const rsiVals = rsi(closes, 14);
  const { histogram } = macd(closes);

  const last = candles[candles.length - 1];
  const i = candles.length - 1;

  const lastEma9 = ema9[i];
  const lastEma21 = ema21[i];
  const lastRsi = rsiVals[i];
  const lastHist = histogram[i];

  const bullish = last.close > last.open;
  const bearish = last.close < last.open;

  const condUp = [lastEma9 > lastEma21, lastRsi < 70, lastHist > 0, bullish];
  const condDown = [lastEma9 < lastEma21, lastRsi > 30, lastHist < 0, bearish];

  const scoreUp = condUp.filter(Boolean).length;
  const scoreDown = condDown.filter(Boolean).length;

  let type, score;
  if (scoreUp >= 3) { type = "CALL"; score = scoreUp; }
  else if (scoreDown >= 3) { type = "PUT"; score = scoreDown; }
  else { type = "WAIT"; score = Math.max(scoreUp, scoreDown); }

  return {
    type, score,
    price: last.close,
    ema9: lastEma9, ema21: lastEma21,
    rsi: lastRsi, macdHist: lastHist,
    candleTime: last.time
  };
}

async function fetchCandles(symbol) {
  const apiKey = localStorage.getItem("twelve_data_api_key");
  if (!apiKey) {
    throw new Error("Aucune clé API renseignée. Ouvre ⚙️ Réglages ci-dessous.");
  }

  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1min&outputsize=60&apikey=${apiKey}`;
  const resp = await fetch(url);
  const data = await resp.json();

  if (!data.values) {
    throw new Error(data.message || "Réponse API invalide.");
  }

  const candles = data.values.map(v => ({
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
    time: v.datetime
  }));
  candles.reverse();
  return candles;
}

function renderResult(symbol, r) {
  const config = {
    CALL: { label: "CALL 📈", cls: "call", bg: "call-bg" },
    PUT: { label: "PUT 📉", cls: "put", bg: "put-bg" },
    WAIT: { label: "ATTENDRE ⏸️", cls: "wait", bg: "wait-bg" }
  }[r.type];

  const now = new Date();
  const checkedAt = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  resultDiv.innerHTML = `
    <div class="card ${config.bg}">
      <div style="font-weight:600;">${symbol}</div>
      <div class="signal-title ${config.cls}">${config.label}</div>
      <div class="score">Score : ${r.score}/4</div>
      <div class="row"><span>Dernière bougie</span><span>${r.candleTime || "-"}</span></div>
      <div class="row"><span>Vérifié à</span><span>${checkedAt}</span></div>
      <div class="row"><span>Prix</span><span>${r.price.toFixed(5)}</span></div>
      <div class="row"><span>EMA9</span><span>${r.ema9.toFixed(5)}</span></div>
      <div class="row"><span>EMA21</span><span>${r.ema21.toFixed(5)}</span></div>
      <div class="row"><span>RSI14</span><span>${r.rsi.toFixed(2)}</span></div>
      <div class="row"><span>MACD hist.</span><span>${r.macdHist.toFixed(5)}</span></div>
    </div>
  `;
}

function renderError(msg) {
  resultDiv.innerHTML = `<div class="error">❌ ${msg}</div>`;
}

async function runSignal() {
  const symbol = assetSelect.value;
  btnSignal.disabled = true;
  btnSignal.textContent = "Analyse en cours...";

  try {
    const candles = await fetchCandles(symbol);
    const result = analyze(candles);
    if (!result) {
      renderError("Pas assez de données pour analyser.");
    } else {
      renderResult(symbol, result);
    }
  } catch (e) {
    renderError(e.message);
  } finally {
    btnSignal.disabled = false;
    btnSignal.textContent = "Obtenir le signal";
  }
}

btnSignal.addEventListener("click", () => {
  resultDiv.innerHTML = "";
  runSignal();
});

const autoRefreshCheckbox = document.getElementById("autoRefresh");
let autoRefreshInterval = null;

autoRefreshCheckbox.addEventListener("change", () => {
  if (autoRefreshCheckbox.checked) {
    runSignal();
    autoRefreshInterval = setInterval(runSignal, 30000);
  } else {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    autoRefreshCheckbox.checked = false;
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
  }

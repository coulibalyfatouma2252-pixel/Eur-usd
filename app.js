// ----------------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------------

const FOREX_ASSETS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "AUD/USD",
  "USD/CAD", "NZD/USD", "EUR/JPY", "GBP/JPY", "EUR/GBP",
  "EUR/CHF", "EUR/AUD", "EUR/CAD", "GBP/CHF", "GBP/AUD",
  "GBP/CAD", "AUD/JPY", "AUD/CHF", "CHF/JPY", "NZD/JPY",
  "EUR/NZD", "AUD/NZD", "AUD/CAD", "NZD/CAD", "CAD/JPY",
  "USD/SGD", "USD/MXN", "USD/ZAR", "USD/SEK", "USD/NOK"
];

const CRYPTO_ASSETS = ["BTC/USD", "ETH/USD", "SOL/USD", "BNB/USD", "XRP/USD"];

const COMMODITY_ASSETS = ["XAU/USD", "XAG/USD", "WTI/USD"];

const ASSETS = [...FOREX_ASSETS, ...CRYPTO_ASSETS, ...COMMODITY_ASSETS];

const assetSelect = document.getElementById("asset");
const btnSignal = document.getElementById("btnSignal");
const resultDiv = document.getElementById("result");
const apiKeyInput = document.getElementById("apiKey");
const btnSaveKey = document.getElementById("btnSaveKey");
const marketStatusEl = document.getElementById("marketStatus");
const clockEl = document.getElementById("clock");
const notifToggle = document.getElementById("notifToggle");

function buildGroup(label, list) {
  const group = document.createElement("optgroup");
  group.label = label;
  list.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = a;
    group.appendChild(opt);
  });
  return group;
}
assetSelect.appendChild(buildGroup("Forex", FOREX_ASSETS));
assetSelect.appendChild(buildGroup("Cryptomonnaies", CRYPTO_ASSETS));
assetSelect.appendChild(buildGroup("Matières premières", COMMODITY_ASSETS));

function isCrypto(symbol) {
  return CRYPTO_ASSETS.includes(symbol);
}

// ----------------------------------------------------------------------------
// HORLOGE + ÉTAT DU MARCHÉ
// ----------------------------------------------------------------------------

function isForexMarketOpen() {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = dimanche, 6 = samedi
  const hour = now.getUTCHours();
  if (day === 6) return false;
  if (day === 0 && hour < 22) return false;
  if (day === 5 && hour >= 22) return false;
  return true;
}

function updateClockAndStatus() {
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString("fr-FR");

  const symbol = assetSelect.value;
  if (isCrypto(symbol)) {
    marketStatusEl.textContent = "🟢 Marché ouvert (crypto 24/7)";
    marketStatusEl.style.color = "#4ade80";
  } else if (isForexMarketOpen()) {
    marketStatusEl.textContent = "🟢 Marché ouvert";
    marketStatusEl.style.color = "#4ade80";
  } else {
    marketStatusEl.textContent = "🔴 Marché fermé (week-end)";
    marketStatusEl.style.color = "#f87171";
  }
}
setInterval(updateClockAndStatus, 1000);
assetSelect.addEventListener("change", updateClockAndStatus);
updateClockAndStatus();

// Charger la clé sauvegardée
apiKeyInput.value = localStorage.getItem("twelve_data_api_key") || "";

btnSaveKey.addEventListener("click", () => {
  localStorage.setItem("twelve_data_api_key", apiKeyInput.value.trim());
  btnSaveKey.textContent = "✅ Clé enregistrée";
  setTimeout(() => (btnSaveKey.textContent = "Enregistrer la clé"), 1500);
});

// ----------------------------------------------------------------------------
// NOTIFICATIONS
// ----------------------------------------------------------------------------

notifToggle.checked = localStorage.getItem("notif_enabled") === "true";

notifToggle.addEventListener("change", async () => {
  if (notifToggle.checked) {
    if ("Notification" in window) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        notifToggle.checked = false;
        alert("Autorisation refusée : active les notifications dans les réglages de Chrome pour ce site.");
        return;
      }
    }
    localStorage.setItem("notif_enabled", "true");
  } else {
    localStorage.setItem("notif_enabled", "false");
  }
});

function notify(title, body) {
  if (localStorage.getItem("notif_enabled") === "true" && "Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "icon.svg" });
  }
}

// ----------------------------------------------------------------------------
// INDICATEURS TECHNIQUES
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// MOTEUR DE SIGNAL
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// RÉCUPÉRATION DES DONNÉES
// ----------------------------------------------------------------------------

async function fetchCandles(symbol, interval) {
  const apiKey = localStorage.getItem("twelve_data_api_key");
  if (!apiKey) {
    throw new Error("Aucune clé API renseignée. Ouvre ⚙️ Réglages ci-dessous.");
  }

  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=60&apikey=${apiKey}`;
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

// ----------------------------------------------------------------------------
// AFFICHAGE DU RÉSULTAT
// ----------------------------------------------------------------------------

function renderResult(symbol, r, intervalMinutes) {
  const config = {
    CALL: { label: "CALL 📈", cls: "call", bg: "call-bg" },
    PUT: { label: "PUT 📉", cls: "put", bg: "put-bg" },
    WAIT: { label: "ATTENDRE ⏸️", cls: "wait", bg: "wait-bg" }
  }[r.type];

  const now = new Date();
  const entryTime = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const expiry = new Date(now.getTime() + intervalMinutes * 60000);
  const expiryTime = expiry.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  resultDiv.innerHTML = `
    <div class="card ${config.bg}">
      <div style="font-weight:600;">${symbol}</div>
      <div class="signal-title ${config.cls}">${config.label}</div>
      <div class="score">Score : ${r.score}/4 — M${intervalMinutes}</div>
      <div class="row"><span>Dernière bougie</span><span>${r.candleTime || "-"}</span></div>
      <div class="row"><span>Heure d'entrée</span><span>${entryTime}</span></div>
      <div class="row"><span>Expiration (M${intervalMinutes})</span><span>${expiryTime}</span></div>
      <div class="row"><span>Prix</span><span>${r.price.toFixed(5)}</span></div>
      <div class="row"><span>EMA9</span><span>${r.ema9.toFixed(5)}</span></div>
      <div class="row"><span>EMA21</span><span>${r.ema21.toFixed(5)}</span></div>
      <div class="row"><span>RSI14</span><span>${r.rsi.toFixed(2)}</span></div>
      <div class="row"><span>MACD hist.</span><span>${r.macdHist.toFixed(5)}</span></div>
    </div>
  `;

  notify("Signal prêt — " + symbol, config.label + " (score " + r.score + "/4)");
}

function renderError(msg) {
  resultDiv.innerHTML = `<div class="error">❌ ${msg}</div>`;
}

// ----------------------------------------------------------------------------
// JOURNAL DES SIGNAUX
// ----------------------------------------------------------------------------

const HISTORY_KEY = "signal_history";
const historyList = document.getElementById("historyList");
const statsBar = document.getElementById("statsBar");
const btnClearHistory = document.getElementById("btnClearHistory");

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function addHistoryEntry(symbol, r, intervalMinutes) {
  const history = loadHistory();
  history.unshift({
    id: Date.now(),
    symbol,
    type: r.type,
    score: r.score,
    price: r.price,
    timeframe: "M" + intervalMinutes,
    checkedAt: new Date().toLocaleString("fr-FR"),
    result: null
  });
  saveHistory(history.slice(0, 200));
  renderHistory();
}

function setResult(id, result) {
  const history = loadHistory();
  const entry = history.find(h => h.id === id);
  if (entry) entry.result = result;
  saveHistory(history);
  renderHistory();
}

function renderStats(history) {
  const evaluated = history.filter(h => h.result === "win" || h.result === "loss");
  const wins = evaluated.filter(h => h.result === "win").length;
  const total = evaluated.length;
  const rate = total > 0 ? Math.round((wins / total) * 100) : null;

  if (total === 0) {
    statsBar.innerHTML = "";
    return;
  }

  statsBar.innerHTML = `
    <div class="stats-bar">
      <span>Taux de réussite<br><b>${rate}%</b></span>
      <span>Évalués<br><b>${total}</b></span>
      <span>Gagnés<br><b>${wins}</b></span>
      <span>Perdus<br><b>${total - wins}</b></span>
    </div>
  `;
}

function renderHistory() {
  const history = loadHistory();
  renderStats(history);

  if (history.length === 0) {
    historyList.innerHTML = `<div style="color:#7a7a7a; font-size:13px;">Aucun signal enregistré pour l'instant.</div>`;
    return;
  }

  historyList.innerHTML = history.map(h => {
    const typeLabel = { CALL: "CALL 📈", PUT: "PUT 📉", WAIT: "ATTENDRE ⏸️" }[h.type];
    let badges;
    if (h.result === "win") badges = `<span class="badge-win">✅ Gagné</span>`;
    else if (h.result === "loss") badges = `<span class="badge-loss">❌ Perdu</span>`;
    else if (h.result === "neutral") badges = `<span class="badge-neutral">➖ Neutre</span>`;
    else badges = `
      <span class="hist-badges">
        <button onclick="setResult(${h.id}, 'win')" style="background:#1a1d24;border:1px solid #2a2d34;color:#4ade80;">✅</button><button onclick="setResult(${h.id}, 'loss')" style="background:#1a1d24;border:1px solid #2a2d34;color:#f87171;">❌</button><button onclick="setResult(${h.id}, 'neutral')" style="background:#1a1d24;border:1px solid #2a2d34;color:#9a9a9a;">➖</button>
      </span>
    `;

    return `
      <div class="hist-item">
        <div class="hist-left">
          <div>${h.symbol} — ${typeLabel} (${h.score}/4) · ${h.timeframe || "M1"}</div>
          <div style="font-size:11px;color:#666;">${h.checkedAt}</div>
        </div>
        <div>${badges}</div>
      </div>
    `;
  }).join("");
}

btnClearHistory.addEventListener("click", () => {
  if (confirm("Effacer tout le journal des signaux ?")) {
    saveHistory([]);
    renderHistory();
  }
});

renderHistory();

// ----------------------------------------------------------------------------
// ACTION PRINCIPALE
// ----------------------------------------------------------------------------

const timeframeSelect = document.getElementById("timeframe");

async function runSignal() {
  const symbol = assetSelect.value;
  const interval = timeframeSelect.value; // "1min" | "5min" | "15min"
  const intervalMinutes = parseInt(interval);
  btnSignal.disabled = true;
  btnSignal.textContent = "Analyse en cours...";

  try {
    const candles = await fetchCandles(symbol, interval);
    const result = analyze(candles);
    if (!result) {
      renderError("Pas assez de données pour analyser.");
    } else {
      renderResult(symbol, result, intervalMinutes);
      if (result.type === "CALL" || result.type === "PUT") {
        addHistoryEntry(symbol, result, intervalMinutes);
      }
    }
  } catch (e) {
    renderError(e.message);
  } finally {
    btnSignal.disabled = false;
    btnSignal.textContent = "DONNER UN SIGNAL";
  }
}

btnSignal.addEventListener("click", () => {
  resultDiv.innerHTML = "";
  runSignal();
});

// ----------------------------------------------------------------------------
// RAFRAÎCHISSEMENT AUTOMATIQUE
// ----------------------------------------------------------------------------

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

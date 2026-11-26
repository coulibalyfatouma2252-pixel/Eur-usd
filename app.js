// ----------------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------------

const FOREX_ASSETS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "AUD/USD",
  "USD/CAD", "NZD/USD", "EUR/JPY", "GBP/JPY", "EUR/GBP",
  "EUR/CHF", "EUR/AUD", "EUR/CAD", "GBP/CHF", "GBP/AUD",
  "GBP/CAD", "AUD/JPY", "AUD/CHF", "CHF/JPY", "NZD/JPY",
  "EUR/NZD", "AUD/NZD", "AUD/CAD", "NZD/CAD", "CAD/JPY",
  "USD/SGD", "USD/MXN", "USD/ZAR", "USD/SEK", "USD/NOK",
  "USD/CNH", "USD/HKD", "USD/PLN", "EUR/SEK", "EUR/NOK",
  "EUR/PLN", "EUR/SGD", "CAD/CHF", "NZD/CHF", "GBP/NZD"
];

const CRYPTO_ASSETS = [
  "BTC/USD", "ETH/USD", "SOL/USD", "BNB/USD", "XRP/USD",
  "ADA/USD", "DOGE/USD", "LTC/USD", "AVAX/USD", "LINK/USD",
  "DOT/USD", "TRX/USD", "BCH/USD"
];

const COMMODITY_ASSETS = ["XAU/USD", "XAG/USD", "WTI/USD", "XPT/USD", "XPD/USD", "NG/USD"];

const ASSETS = [...FOREX_ASSETS, ...CRYPTO_ASSETS, ...COMMODITY_ASSETS];

// Réglages du moteur de signal
const MIN_SCORE = 4;          // signal uniquement si 4/4
const FLAT_ATR_RATIO = 0.15;  // marché "plat" si |EMA9-EMA21| < 15% de l'ATR

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

async function notify(title, body) {
  if (localStorage.getItem("notif_enabled") !== "true") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    // Android/Chrome : il faut passer par le service worker
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { body, icon: "icon.svg" });
    } else {
      new Notification(title, { body, icon: "icon.svg" });
    }
  } catch (e) {
    // une erreur de notification ne doit jamais bloquer le signal
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

// ATR : amplitude moyenne des bougies (sert à détecter un marché plat)
function atr(candles, period = 14) {
  const trs = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
  });
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// ----------------------------------------------------------------------------
// MOTEUR DE SIGNAL (sur bougies FERMÉES uniquement)
// ----------------------------------------------------------------------------

function analyze(candles) {
  if (candles.length < 40) return null;

  const closes = candles.map(c => c.close);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const rsiVals = rsi(closes, 14);
  const { histogram } = macd(closes);
  const atrVal = atr(candles, 14);

  const last = candles[candles.length - 1];
  const i = candles.length - 1;

  const lastEma9 = ema9[i];
  const lastEma21 = ema21[i];
  const lastRsi = rsiVals[i];
  const lastHist = histogram[i];
  const prevHist = histogram[i - 1];

  // 4 conditions par sens
  const condUp = [
    lastEma9 > lastEma21,                 // tendance haussière
    last.close > lastEma9,                // prix au-dessus de l'EMA9
    lastRsi >= 50 && lastRsi < 70,        // RSI haussier mais pas suracheté
    lastHist > 0 && lastHist > prevHist   // MACD positif et qui monte
  ];
  const condDown = [
    lastEma9 < lastEma21,
    last.close < lastEma9,
    lastRsi <= 50 && lastRsi > 30,
    lastHist < 0 && lastHist < prevHist
  ];

  const scoreUp = condUp.filter(Boolean).length;
  const scoreDown = condDown.filter(Boolean).length;

  // Filtre marché plat
  const spread = Math.abs(lastEma9 - lastEma21);
  const flat = spread < FLAT_ATR_RATIO * atrVal;

  let type, score, reason = "";
  if (flat) {
    type = "WAIT";
    score = Math.max(scoreUp, scoreDown);
    reason = "Marché plat (EMA9 et EMA21 trop proches)";
  } else if (scoreUp === 4 || (scoreUp === 3 && condUp[0] && condUp[1])) {
    type = "CALL"; score = scoreUp;
  } else if (scoreDown === 4 || (scoreDown === 3 && condDown[0] && condDown[1])) {
    type = "PUT"; score = scoreDown;
  } else {
    type = "WAIT";
    score = Math.max(scoreUp, scoreDown);
    reason = "Indicateurs non alignés";
  }

  return {
    type, score, reason,
    level: score === 4 ? "FORT" : "MOYEN",
    price: last.close,
    ema9: lastEma9, ema21: lastEma21,
    rsi: lastRsi, macdHist: lastHist,
    candleTime: last.time,
    candleTs: last.ts
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

  // timezone=UTC : toutes les heures reçues sont en UTC (corrige le décalage)
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=60&timezone=UTC&apikey=${apiKey}`;
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
    time: v.datetime,
    ts: Date.parse(v.datetime.replace(" ", "T") + "Z") // début de bougie, en UTC
  }));
  candles.reverse();
  return candles;
}

// ----------------------------------------------------------------------------
// AFFICHAGE DU RÉSULTAT
// ----------------------------------------------------------------------------

function formatUtc(ts) {
  return new Date(ts).toISOString().slice(0, 19).replace("T", " ") + " UTC";
}

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
      <div class="score">Score : ${r.score}/4 — M${intervalMinutes}${r.type !== "WAIT" ? " — Signal " + r.level : ""}</div>
      ${r.reason ? `<div class="score">${r.reason}</div>` : ""}
      <div class="row"><span>Dernière bougie</span><span>${formatUtc(r.candleTs)}</span></div>
      <div class="row"><span>Heure d'entrée</span><span>${entryTime}</span></div>
      <div class="row"><span>Expiration (M${intervalMinutes})</span><span>${expiryTime}</span></div>
      <div class="row"><span>Prix</span><span>${r.price.toFixed(5)}</span></div>
      <div class="row"><span>EMA9</span><span>${r.ema9.toFixed(5)}</span></div>
      <div class="row"><span>EMA21</span><span>${r.ema21.toFixed(5)}</span></div>
      <div class="row"><span>RSI14</span><span>${r.rsi.toFixed(2)}</span></div>
      <div class="row"><span>MACD hist.</span><span>${r.macdHist.toFixed(5)}</span></div>
    </div>
  `;

  if (r.type === "CALL" || r.type === "PUT") {
    notify("Signal prêt — " + symbol, config.label + " (score " + r.score + "/4)");
  }
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
    level: r.level,
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

  const levelRate = (lvl) => {
    const e = evaluated.filter(h => h.level === lvl);
    if (e.length === 0) return "-";
    return Math.round((e.filter(h => h.result === "win").length / e.length) * 100) + "% (" + e.length + ")";
  };

  statsBar.innerHTML = `
    <div class="stats-bar">
      <span>Fort (4/4)<br><b>${levelRate("FORT")}</b></span>
      <span>Moyen (3/4)<br><b>${levelRate("MOYEN")}</b></span>
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
  const intervalMs = intervalMinutes * 60000;
  btnSignal.disabled = true;
  btnSignal.textContent = "Analyse en cours...";

  try {
    if (!isCrypto(symbol) && !isForexMarketOpen()) {
      renderError("Marché fermé (week-end). Aucun signal.");
      return;
    }

    const candles = await fetchCandles(symbol, interval);

    // 1) Retirer la bougie en cours de formation (non fermée)
    const lastRaw = candles[candles.length - 1];
    if (lastRaw && lastRaw.ts + intervalMs > Date.now()) {
      candles.pop();
    }

    // 2) Vérifier la fraîcheur de la dernière bougie fermée
    const lastClosed = candles[candles.length - 1];
    if (!lastClosed) {
      renderError("Pas assez de données pour analyser.");
      return;
    }
    const ageMs = Date.now() - (lastClosed.ts + intervalMs);
    const maxAgeMs = intervalMs * 2 + 60000;
    if (ageMs > maxAgeMs) {
      const ageMin = Math.round(ageMs / 60000);
      renderError(`Données périmées : dernière bougie fermée il y a ${ageMin} min. Signal bloqué.`);
      return;
    }

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
// SCANNER DE FAVORIS
// ----------------------------------------------------------------------------

const FAV_KEY = "scan_favorites";
const DEFAULT_FAVS = ["EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "AUD/USD", "USD/CAD", "EUR/JPY", "GBP/JPY"];
const SCAN_DELAY_MS = 8000; // max 8 requêtes/minute (plan gratuit Twelve Data)

const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadFavorites() {
  try {
    const f = JSON.parse(localStorage.getItem(FAV_KEY));
    if (Array.isArray(f)) return f.filter(s => ASSETS.includes(s));
  } catch (e) {}
  return [...DEFAULT_FAVS];
}

function saveFavorites(list) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) {}
}

// Récupère les bougies, retire la bougie en cours, vérifie la fraîcheur, analyse.
async function getSignal(symbol, interval) {
  const intervalMs = parseInt(interval) * 60000;
  const candles = await fetchCandles(symbol, interval);

  const lastRaw = candles[candles.length - 1];
  if (lastRaw && lastRaw.ts + intervalMs > Date.now()) candles.pop();

  const lastClosed = candles[candles.length - 1];
  if (!lastClosed) return { status: "nodata" };

  const ageMs = Date.now() - (lastClosed.ts + intervalMs);
  if (ageMs > intervalMs * 2 + 60000) return { status: "stale" };

  const result = analyze(candles);
  if (!result) return { status: "nodata" };
  return { status: "ok", result };
}

// --- Interface du scanner (insérée avant la carte du résultat) ---
const scannerBox = document.createElement("div");
scannerBox.style.margin = "14px 0";
scannerBox.innerHTML = `
  <button id="btnScan" type="button" style="width:100%;padding:14px;border-radius:12px;border:1px solid #2563eb;background:transparent;color:#60a5fa;font-weight:700;font-size:16px;">🔍 SCANNER MES FAVORIS</button>
  <details style="margin-top:10px;background:#1a1d24;border:1px solid #2a2d34;border-radius:12px;padding:10px 12px;">
    <summary id="favSummary" style="cursor:pointer;font-size:14px;"></summary>
    <div id="favList"></div>
  </details>
  <div id="scanStatus" style="font-size:13px;color:#9a9a9a;margin-top:8px;"></div>
  <div id="scanResults"></div>
`;
resultDiv.parentNode.insertBefore(scannerBox, resultDiv);

const btnScan = document.getElementById("btnScan");
const favListEl = document.getElementById("favList");
const favSummaryEl = document.getElementById("favSummary");
const scanStatusEl = document.getElementById("scanStatus");
const scanResultsEl = document.getElementById("scanResults");

function updateFavSummary(n) {
  favSummaryEl.textContent = `⭐ Mes favoris (${n}) — scan ≈ ${(n * SCAN_DELAY_MS / 60000).toFixed(1)} min`;
}

function renderFavorites() {
  const favs = loadFavorites();
  const groups = [
    ["Forex", FOREX_ASSETS],
    ["Cryptomonnaies", CRYPTO_ASSETS],
    ["Matières premières", COMMODITY_ASSETS]
  ];
  favListEl.innerHTML = groups.map(([label, list]) => `
    <div style="margin:10px 0 2px;font-weight:600;font-size:13px;color:#9a9a9a;">${label}</div>
    ${list.map(s => `<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-size:14px;"><input type="checkbox" value="${s}" ${favs.includes(s) ? "checked" : ""} style="width:18px;height:18px;margin:0;">${s}</label>`).join("")}
  `).join("");
  updateFavSummary(favs.length);
}

favListEl.addEventListener("change", () => {
  const checked = [...favListEl.querySelectorAll("input:checked")].map(i => i.value);
  saveFavorites(checked);
  updateFavSummary(checked.length);
});

renderFavorites();

function renderScan(results) {
  const signals = results
    .filter(r => r.status === "ok" && r.result.type !== "WAIT")
    .sort((a, b) => b.result.score - a.result.score);
  const waits = results.filter(r => r.status === "ok" && r.result.type === "WAIT").map(r => r.symbol);
  const stale = results.filter(r => r.status === "stale").map(r => r.symbol);
  const failed = results.filter(r => r.status === "error" || r.status === "nodata").map(r => r.symbol);

  const rows = signals.map(r => {
    const t = r.result;
    const icon = t.type === "CALL" ? "📈" : "📉";
    const color = t.type === "CALL" ? "#4ade80" : "#f87171";
    return `<button type="button" data-symbol="${r.symbol}" style="display:flex;justify-content:space-between;width:100%;margin-top:8px;padding:12px 14px;border-radius:12px;border:1px solid ${color};background:#1a1d24;color:${color};font-size:15px;font-weight:600;"><span>${r.symbol} — ${t.type} ${icon}</span><span>${t.score}/4 · ${t.level}</span></button>`;
  }).join("");

  const line = (label, arr) => arr.length
    ? `<div style="font-size:12px;color:#7a7a7a;margin-top:6px;">${label} : ${arr.join(", ")}</div>`
    : "";

  scanResultsEl.innerHTML = rows
    + line("Sans signal", waits)
    + line("Données périmées", stale)
    + line("Indisponibles", failed);
}

// Toucher un signal du scanner : relance l'analyse fraîche de cette paire
scanResultsEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-symbol]");
  if (!btn || scanning) return;
  assetSelect.value = btn.dataset.symbol;
  updateClockAndStatus();
  resultDiv.innerHTML = "";
  runSignal();
  resultDiv.scrollIntoView({ behavior: "smooth", block: "start" });
});

let scanning = false;
let cancelScan = false;

async function runScan() {
  if (scanning) {
    cancelScan = true;
    btnScan.textContent = "Arrêt en cours…";
    return;
  }

  const interval = timeframeSelect.value;
  const forexOpen = isForexMarketOpen();
  const favs = loadFavorites();
  const list = favs.filter(s => isCrypto(s) || forexOpen);

  scanResultsEl.innerHTML = "";
  if (list.length === 0) {
    scanStatusEl.textContent = favs.length === 0
      ? "Coche au moins une paire dans tes favoris."
      : "Marché forex fermé et aucune crypto dans tes favoris.";
    return;
  }

  scanning = true;
  cancelScan = false;
  btnScan.textContent = "⏹ ARRÊTER LE SCAN";
  const results = [];

  try {
    for (let i = 0; i < list.length; i++) {
      if (cancelScan) break;
      const symbol = list[i];
      scanStatusEl.textContent = `Scan ${i + 1}/${list.length} : ${symbol}…`;

      let out;
      try {
        out = await getSignal(symbol, interval);
      } catch (e) {
        if (/credits|limit|minute/i.test(e.message)) {
          scanStatusEl.textContent = "Limite de requêtes atteinte, pause de 60 s…";
          await sleep(61000);
          try { out = await getSignal(symbol, interval); }
          catch (e2) { out = { status: "error", message: e2.message }; }
        } else {
          out = { status: "error", message: e.message };
        }
      }

      results.push({ symbol, ...out });
      renderScan(results);
      if (i < list.length - 1 && !cancelScan) await sleep(SCAN_DELAY_MS);
    }
  } finally {
    scanning = false;
    btnScan.textContent = "🔍 SCANNER MES FAVORIS";
  }

  const found = results.filter(r => r.status === "ok" && r.result.type !== "WAIT");
  const time = new Date().toLocaleTimeString("fr-FR");
  const skipped = forexOpen ? "" : " (forex fermé : cryptos seulement)";
  if (cancelScan) {
    scanStatusEl.textContent = `Scan arrêté à ${time} — ${found.length} signal(s)${skipped}.`;
  } else if (found.length === 0) {
    scanStatusEl.textContent = `Scan terminé à ${time} — aucun signal${skipped}. Réessaie à la prochaine bougie.`;
  } else {
    scanStatusEl.textContent = `Scan terminé à ${time} — ${found.length} signal(s)${skipped}. Touche une ligne pour l'analyser.`;
    notify("Scanner — " + found.length + " signal(s)", found.map(r => r.symbol + " " + r.result.type).join(", "));
  }
}

btnScan.addEventListener("click", runScan);

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

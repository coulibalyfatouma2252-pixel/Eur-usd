"""
Bot Telegram d'analyse technique forex
----------------------------------------
Ce bot NE PRÉDIT PAS l'avenir. Il calcule des indicateurs techniques
standards (EMA, RSI, MACD) sur des données de marché réelles et applique
des règles de décision transparentes pour proposer CALL / PUT / ATTENDRE.

Aucun taux de réussite n'est garanti. Ceci n'est pas un conseil financier.
"""

import os
import logging
import requests
import pandas as pd
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
)

# ----------------------------------------------------------------------------
# CONFIGURATION
# ----------------------------------------------------------------------------

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN", "")
TWELVE_DATA_API_KEY = os.environ.get("TWELVE_DATA_API_KEY", "")

# Au moins 10 actifs forex
ASSETS = [
    "EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "AUD/USD",
    "USD/CAD", "NZD/USD", "EUR/JPY", "GBP/JPY", "EUR/GBP",
]

INTERVAL = "1min"       # bougies 1 minute
OUTPUT_SIZE = 60        # nombre de bougies récupérées (assez pour EMA21/MACD)

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

DISCLAIMER = (
    "\n\n⚠️ _Analyse technique automatisée à partir de données réelles. "
    "Aucune garantie de résultat. Ceci n'est pas un conseil financier._"
)

# ----------------------------------------------------------------------------
# RÉCUPÉRATION DES DONNÉES
# ----------------------------------------------------------------------------

def fetch_candles(symbol: str) -> pd.DataFrame | None:
    """Récupère les dernières bougies pour un symbole via Twelve Data."""
    url = "https://api.twelvedata.com/time_series"
    params = {
        "symbol": symbol,
        "interval": INTERVAL,
        "outputsize": OUTPUT_SIZE,
        "apikey": TWELVE_DATA_API_KEY,
    }
    try:
        resp = requests.get(url, params=params, timeout=10)
        data = resp.json()
    except Exception as e:
        logger.error(f"Erreur réseau pour {symbol}: {e}")
        return None

    if "values" not in data:
        logger.error(f"Réponse API invalide pour {symbol}: {data}")
        return None

    df = pd.DataFrame(data["values"])
    df = df.rename(columns={"datetime": "time"})
    df["time"] = pd.to_datetime(df["time"])
    for col in ["open", "high", "low", "close"]:
        df[col] = df[col].astype(float)
    df = df.sort_values("time").reset_index(drop=True)
    return df


# ----------------------------------------------------------------------------
# INDICATEURS TECHNIQUES
# ----------------------------------------------------------------------------

def compute_ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def compute_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()
    rs = avg_gain / avg_loss.replace(0, 1e-10)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def compute_macd(series: pd.Series):
    ema12 = compute_ema(series, 12)
    ema26 = compute_ema(series, 26)
    macd_line = ema12 - ema26
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def analyze(df: pd.DataFrame) -> dict:
    """Applique les indicateurs et retourne un signal + score de qualité."""
    close = df["close"]

    ema9 = compute_ema(close, 9)
    ema21 = compute_ema(close, 21)
    rsi = compute_rsi(close, 14)
    macd_line, signal_line, hist = compute_macd(close)

    last_close = close.iloc[-1]
    last_open = df["open"].iloc[-1]
    last_ema9 = ema9.iloc[-1]
    last_ema21 = ema21.iloc[-1]
    last_rsi = rsi.iloc[-1]
    last_hist = hist.iloc[-1]

    bullish_candle = last_close > last_open
    bearish_candle = last_close < last_open

    # Conditions haussières
    cond_up = [
        last_ema9 > last_ema21,
        last_rsi < 70,
        last_hist > 0,
        bullish_candle,
    ]
    # Conditions baissières
    cond_down = [
        last_ema9 < last_ema21,
        last_rsi > 30,
        last_hist < 0,
        bearish_candle,
    ]

    score_up = sum(cond_up)
    score_down = sum(cond_down)

    if score_up >= 3:
        signal = "CALL 📈"
        score = score_up
    elif score_down >= 3:
        signal = "PUT 📉"
        score = score_down
    else:
        signal = "ATTENDRE ⏸️"
        score = max(score_up, score_down)

    return {
        "signal": signal,
        "score": score,
        "price": round(last_close, 5),
        "ema9": round(last_ema9, 5),
        "ema21": round(last_ema21, 5),
        "rsi": round(last_rsi, 2),
        "macd_hist": round(last_hist, 5),
    }


# ----------------------------------------------------------------------------
# HANDLERS TELEGRAM
# ----------------------------------------------------------------------------

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (
        "👋 *Bot d'analyse technique forex*\n\n"
        "Commandes disponibles :\n"
        "/actifs — liste des paires disponibles\n"
        "/signal PAIRE — ex: `/signal EURUSD`\n"
        "/menu — choisir une paire via boutons"
        + DISCLAIMER
    )
    await update.message.reply_markdown(text)


async def list_assets(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = "📊 *Paires disponibles :*\n" + "\n".join(f"• {a}" for a in ASSETS)
    await update.message.reply_markdown(text)


async def menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton(a, callback_data=a)] for a in ASSETS
    ]
    await update.message.reply_text(
        "Choisis une paire :", reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    symbol = query.data
    await query.edit_message_text(f"⏳ Analyse de {symbol} en cours...")
    result_text = await get_signal_text(symbol)
    await query.edit_message_text(result_text, parse_mode="Markdown")


async def signal_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text(
            "Utilisation : /signal PAIRE (ex: /signal EURUSD)\n"
            "Voir /actifs pour la liste des paires."
        )
        return

    raw = context.args[0].upper().replace("/", "")
    # Reconstruire le format "EUR/USD" à partir de "EURUSD"
    symbol = None
    for a in ASSETS:
        if a.replace("/", "") == raw:
            symbol = a
            break

    if symbol is None:
        await update.message.reply_text(
            f"Paire '{context.args[0]}' non reconnue. Voir /actifs."
        )
        return

    msg = await update.message.reply_text(f"⏳ Analyse de {symbol} en cours...")
    result_text = await get_signal_text(symbol)
    await msg.edit_text(result_text, parse_mode="Markdown")


async def get_signal_text(symbol: str) -> str:
    df = fetch_candles(symbol)
    if df is None or len(df) < 30:
        return f"❌ Impossible de récupérer les données pour {symbol}."

    r = analyze(df)
    text = (
        f"*{symbol}*\n"
        f"Signal : *{r['signal']}*  (score {r['score']}/4)\n\n"
        f"Prix : `{r['price']}`\n"
        f"EMA9 : `{r['ema9']}`  |  EMA21 : `{r['ema21']}`\n"
        f"RSI14 : `{r['rsi']}`\n"
        f"MACD hist : `{r['macd_hist']}`"
        + DISCLAIMER
    )
    return text


# ----------------------------------------------------------------------------
# LANCEMENT
# ----------------------------------------------------------------------------

def main():
    if not TELEGRAM_TOKEN or not TWELVE_DATA_API_KEY:
        raise SystemExit(
            "Définis les variables d'environnement TELEGRAM_TOKEN et "
            "TWELVE_DATA_API_KEY avant de lancer le bot."
        )

    app = Application.builder().token(TELEGRAM_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("actifs", list_assets))
    app.add_handler(CommandHandler("menu", menu))
    app.add_handler(CommandHandler("signal", signal_command))
    app.add_handler(CallbackQueryHandler(button_callback))

    logger.info("Bot démarré — polling en cours...")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
    

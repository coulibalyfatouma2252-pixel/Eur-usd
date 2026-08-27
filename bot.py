"""
Bot Telegram - Signal multi-devises basé sur les patterns de bougies japonaises
Commande : /signal <DEVISE> <TEMPS>
Exemple : /signal EURUSD 5m
"""

import os
import logging
import threading
import requests
from flask import Flask
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

web_app = Flask(__name__)


@web_app.route("/")
def home():
    return "Bot Trading actif ✅"


def run_web_server():
    port = int(os.environ.get("PORT", 10000))
    web_app.run(host="0.0.0.0", port=port)


TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TWELVE_DATA_API_KEY = os.environ.get("TWELVE_DATA_API_KEY")

# Devises disponibles : ce que l'utilisateur tape → symbole API
PAIRS = {
    "EURUSD": "EUR/USD",
    "GBPUSD": "GBP/USD",
    "USDJPY": "USD/JPY",
}

# Temps disponibles : ce que l'utilisateur tape → intervalle API
TIMEFRAMES = {
    "1M": "1min",
    "5M": "5min",
}

CANDLES_NEEDED = 3


def get_candles(symbol, interval):
    url = "https://api.twelvedata.com/time_series"
    params = {
        "symbol": symbol,
        "interval": interval,
        "outputsize": CANDLES_NEEDED,
        "apikey": TWELVE_DATA_API_KEY,
    }
    response = requests.get(url, params=params, timeout=10)
    data = response.json()

    if "values" not in data:
        raise RuntimeError(f"Erreur API: {data.get('message', data)}")

    candles = list(reversed(data["values"]))
    return [
        {
            "time": c["datetime"],
            "open": float(c["open"]),
            "high": float(c["high"]),
            "low": float(c["low"]),
            "close": float(c["close"]),
        }
        for c in candles
    ]


def body(c):
    return abs(c["close"] - c["open"])


def range_(c):
    return c["high"] - c["low"]


def is_bullish(c):
    return c["close"] > c["open"]


def is_bearish(c):
    return c["close"] < c["open"]


def detect_pattern(candles):
    last = candles[-1]
    prev = candles[-2] if len(candles) >= 2 else None

    r = range_(last)
    if r == 0:
        return None, None
    b = body(last)
    upper_wick = last["high"] - max(last["open"], last["close"])
    lower_wick = min(last["open"], last["close"]) - last["low"]

    if b <= r * 0.1:
        return "Doji", "NEUTRE — attendre confirmation"

    if lower_wick >= b * 2 and upper_wick <= b * 0.5 and b <= r * 0.4:
        return "Marteau (Hammer)", "CALL (achat)"

    if upper_wick >= b * 2 and lower_wick <= b * 0.5 and b <= r * 0.4:
        return "Étoile filante (Shooting Star)", "PUT (vente)"

    if prev and is_bearish(prev) and is_bullish(last):
        if last["open"] <= prev["close"] and last["close"] >= prev["open"]:
            return "Avalement haussier (Bullish Engulfing)", "CALL (achat)"

    if prev and is_bullish(prev) and is_bearish(last):
        if last["open"] >= prev["close"] and last["close"] <= prev["open"]:
            return "Avalement baissier (Bearish Engulfing)", "PUT (vente)"

    return None, None


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    pairs_list = ", ".join(PAIRS.keys())
    times_list = ", ".join(t.lower() for t in TIMEFRAMES.keys())
    await update.message.reply_text(
        "Bot d'analyse multi-devises activé.\n\n"
        f"Utilise : /signal <devise> <temps>\n"
        f"Exemple : /signal EURUSD 5m\n\n"
        f"Devises disponibles : {pairs_list}\n"
        f"Temps disponibles : {times_list}\n\n"
        "⚠️ Outil éducatif, pas un conseil financier — le trading comporte des risques de perte."
    )


async def signal(update: Update, context: ContextTypes.DEFAULT_TYPE):
    args = context.args  # ce que l'utilisateur tape après /signal

    if len(args) != 2:
        await update.message.reply_text(
            "Format incorrect.\nUtilise : /signal <devise> <temps>\n"
            "Exemple : /signal EURUSD 5m"
        )
        return

    pair_input = args[0].upper().replace("/", "")
    time_input = args[1].upper()

    if pair_input not in PAIRS:
        await update.message.reply_text(
            f"Devise inconnue : {args[0]}\n"
            f"Devises disponibles : {', '.join(PAIRS.keys())}"
        )
        return

    if time_input not in TIMEFRAMES:
        await update.message.reply_text(
            f"Temps inconnu : {args[1]}\n"
            f"Temps disponibles : {', '.join(t.lower() for t in TIMEFRAMES.keys())}"
        )
        return

    symbol = PAIRS[pair_input]
    interval = TIMEFRAMES[time_input]

    await update.message.reply_text(f"Analyse de {pair_input} ({time_input.lower()}) en cours...")

    try:
        candles = get_candles(symbol, interval)
        pattern, direction = detect_pattern(candles)
        last = candles[-1]

        if pattern:
            msg = (
                f"📊 *{symbol}* ({time_input.lower()})\n"
                f"Dernière clôture : {last['close']}\n\n"
                f"Pattern détecté : *{pattern}*\n"
                f"Signal : *{direction}*\n\n"
                f"⚠️ Vérifie toujours toi-même avant de trader."
            )
        else:
            msg = (
                f"📊 *{symbol}* ({time_input.lower()})\n"
                f"Dernière clôture : {last['close']}\n\n"
                f"Aucun pattern clair détecté. Attends une meilleure configuration."
            )
        await update.message.reply_markdown(msg)

    except Exception as e:
        logger.error(f"Erreur /signal: {e}")
        await update.message.reply_text("Erreur lors de la récupération des données. Réessaie.")


def main():
    if not TELEGRAM_BOT_TOKEN or not TWELVE_DATA_API_KEY:
        raise RuntimeError("Il manque TELEGRAM_BOT_TOKEN ou TWELVE_DATA_API_KEY.")

    threading.Thread(target=run_web_server, daemon=True).start()

    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("signal", signal))

    logger.info("Bot démarré...")
    app.run_polling()


if __name__ == "__main__":
    main()

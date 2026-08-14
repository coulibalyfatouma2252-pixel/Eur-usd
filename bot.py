"""
Bot Telegram - Signal EUR/USD basé sur les patterns de bougies japonaises
Commande principale : /signal
"""

import os
import logging
import requests
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# ── Configuration (à définir en variables d'environnement) ─────────────────
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TWELVE_DATA_API_KEY = os.environ.get("TWELVE_DATA_API_KEY")

SYMBOL = "EUR/USD"
INTERVAL = "5min"          # timeframe des bougies
CANDLES_NEEDED = 3          # nombre de bougies à récupérer pour l'analyse


# ── Récupération des données de marché ──────────────────────────────────────
def get_candles():
    """Récupère les dernières bougies OHLC via l'API Twelve Data."""
    url = "https://api.twelvedata.com/time_series"
    params = {
        "symbol": SYMBOL,
        "interval": INTERVAL,
        "outputsize": CANDLES_NEEDED,
        "apikey": TWELVE_DATA_API_KEY,
    }
    response = requests.get(url, params=params, timeout=10)
    data = response.json()

    if "values" not in data:
        raise RuntimeError(f"Erreur API: {data.get('message', data)}")

    # L'API renvoie du plus récent au plus ancien -> on remet dans l'ordre chronologique
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


# ── Détection de patterns de bougies japonaises ─────────────────────────────
def body(c):
    return abs(c["close"] - c["open"])


def range_(c):
    return c["high"] - c["low"]


def is_bullish(c):
    return c["close"] > c["open"]


def is_bearish(c):
    return c["close"] < c["open"]


def detect_pattern(candles):
    """Analyse les 2-3 dernières bougies et retourne (nom_pattern, signal) ou (None, None)."""
    last = candles[-1]
    prev = candles[-2] if len(candles) >= 2 else None

    r = range_(last)
    if r == 0:
        return None, None
    b = body(last)
    upper_wick = last["high"] - max(last["open"], last["close"])
    lower_wick = min(last["open"], last["close"]) - last["low"]

    # Doji : corps très petit par rapport au range
    if b <= r * 0.1:
        return "Doji", "NEUTRE — attendre confirmation"

    # Marteau (Hammer) : petit corps en haut, grande mèche basse
    if lower_wick >= b * 2 and upper_wick <= b * 0.5 and b <= r * 0.4:
        return "Marteau (Hammer)", "CALL (achat)"

    # Étoile filante (Shooting Star) : petit corps en bas, grande mèche haute
    if upper_wick >= b * 2 and lower_wick <= b * 0.5 and b <= r * 0.4:
        return "Étoile filante (Shooting Star)", "PUT (vente)"

    # Avalement haussier (Bullish Engulfing)
    if prev and is_bearish(prev) and is_bullish(last):
        if last["open"] <= prev["close"] and last["close"] >= prev["open"]:
            return "Avalement haussier (Bullish Engulfing)", "CALL (achat)"

    # Avalement baissier (Bearish Engulfing)
    if prev and is_bullish(prev) and is_bearish(last):
        if last["open"] >= prev["close"] and last["close"] <= prev["open"]:
            return "Avalement baissier (Bearish Engulfing)", "PUT (vente)"

    return None, None


# ── Commandes Telegram ───────────────────────────────────────────────────────
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Bot d'analyse EUR/USD activé.\n\n"
        "Tape /signal pour recevoir l'analyse du marché en temps réel.\n\n"
        "⚠️ Ceci est un outil éducatif basé sur l'analyse technique. "
        "Ce n'est pas un conseil financier — le trading comporte des risques de perte."
    )


async def signal(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Analyse en cours...")
    try:
        candles = get_candles()
        pattern, direction = detect_pattern(candles)
        last = candles[-1]

        if pattern:
            msg = (
                f"📊 *{SYMBOL}* ({INTERVAL})\n"
                f"Dernière clôture : {last['close']}\n\n"
                f"Pattern détecté : *{pattern}*\n"
                f"Signal : *{direction}*\n\n"
                f"⚠️ Analyse technique automatique — vérifie toujours avec ta propre analyse "
                f"avant de trader. Aucun signal n'est garanti."
            )
        else:
            msg = (
                f"📊 *{SYMBOL}* ({INTERVAL})\n"
                f"Dernière clôture : {last['close']}\n\n"
                f"Aucun pattern clair détecté en ce moment. Attends une meilleure configuration."
            )
        await update.message.reply_markdown(msg)

    except Exception as e:
        logger.error(f"Erreur /signal: {e}")
        await update.message.reply_text(
            "Erreur lors de la récupération des données de marché. Réessaie dans un instant."
        )


def main():
    if not TELEGRAM_BOT_TOKEN or not TWELVE_DATA_API_KEY:
        raise RuntimeError(
            "Il manque TELEGRAM_BOT_TOKEN ou TWELVE_DATA_API_KEY dans les variables d'environnement."
        )

    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("signal", signal))

    logger.info("Bot démarré...")
    app.run_polling()


if __name__ == "__main__":
    main()

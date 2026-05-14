"""
Solar Finance Core — Deterministic Indicator Layer

Sprint 4.5 scope:
  - SMA(n)              simple moving average over the last n prices
  - volatility_pct      stdev of arithmetic returns × 100 (sample stdev)
  - distance_to_sma_pct percentage distance from a price to its SMA

Design principles:
  - Pure functions. No I/O, no DB, no LLM, no global state.
  - No external math libs (pandas/numpy NOT in requirements.txt).
    statistics.stdev from stdlib is enough at this layer.
  - Insufficient input → return None. Caller decides JSON shape.
  - No signals, no recommendations, no "bullish/bearish" — math only.

Strictly out of scope (Sprint 4.5 forbidden list):
  - RSI, MACD, EMA, Bollinger
  - signals, confidence scores
  - AI/LLM analysis
  - trade plans A/B/C/D/E
  - scheduling, Telegram, UI
"""

import statistics
from typing import Optional, Sequence


def sma(prices: Sequence[float], window: int) -> Optional[float]:
    """
    Simple Moving Average over the last `window` prices.

    Args:
        prices:  chronologically ordered (oldest -> newest) numeric series.
        window:  rolling window size. Must be >= 2.

    Returns:
        float SMA, or None if len(prices) < window.
    """
    if window < 2:
        raise ValueError("window must be >= 2")
    if len(prices) < window:
        return None
    window_slice = prices[-window:]
    return float(sum(window_slice)) / window


def volatility_pct(
    prices: Sequence[float], window: int = 50
) -> Optional[float]:
    """
    Sample standard deviation of arithmetic returns × 100.

    `window` is the number of *returns* used, so we need window + 1 prices.
    Arithmetic return: (p_i - p_{i-1}) / p_{i-1}.

    Args:
        prices:  chronologically ordered (oldest -> newest) numeric series.
        window:  number of returns to consider. Must be >= 2.

    Returns:
        float volatility in percent, or None if data insufficient or
        all returns are zero (constant price).
    """
    if window < 2:
        raise ValueError("window must be >= 2")
    if len(prices) < window + 1:
        return None

    tail = prices[-(window + 1):]
    returns = [
        (tail[i] - tail[i - 1]) / tail[i - 1]
        for i in range(1, len(tail))
        if tail[i - 1] != 0
    ]
    if len(returns) < 2:
        # statistics.stdev needs at least 2 data points
        return None
    return float(statistics.stdev(returns)) * 100.0


def distance_to_sma_pct(
    price: float, sma_value: Optional[float]
) -> Optional[float]:
    """
    Percentage distance from `price` to `sma_value`.

    Formula: (price - sma) / sma * 100.

    Args:
        price:     current/latest price.
        sma_value: SMA value, or None if SMA was undefined.

    Returns:
        float distance in percent, or None when SMA is None or zero.
    """
    if sma_value is None or sma_value == 0:
        return None
    return (float(price) - float(sma_value)) / float(sma_value) * 100.0

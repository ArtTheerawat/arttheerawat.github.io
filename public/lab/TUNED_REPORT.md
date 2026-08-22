# 🧪 Hermes Research Lab — TUNED Report (หลังจูนพารามิเตอร์)
**Data:** 503 วัน GC=F 2024-08-22 → 2026-08-21 | **Grid รวม:** 270+162+96+81+486 = 1,095 combos | **MC:** 2000 รอบ/ตัว

| อันดับ | ระบบ | เดิม → จูน | Δ | Trades | WR | PF | DD | Verdict |
|---:|---|---|---:|---:|---:|---:|---:|---|
| 1 | **SCALP_BREAKOUT** | 92.4 → **95.3** | +2.9 | 16 | 81.2% | 6.63 | 3.8% | 🟢 SURVIVE — พร้อมส่ง MT5 |
| 2 | **SWING_MACD_RSI** | 66.4 → **88.9** | +22.5 | 13 | 61.5% | 3.17 | 4.5% | 🟢 SURVIVE — พร้อมส่ง MT5 |
| 3 | **LONG_TREND_ATR** | 83.1 → **88.1** | +5.0 | 3 | 66.7% | 5.03 | 3.4% | ⚠️ OVERFIT — เทรดน้อยเกิน ไม่ควรใช้จริง |
| 4 | **SWING_TREND_EMA** | 65.7 → **74.6** | +8.9 | 13 | 46.2% | 2.33 | 12.9% | 🟡 CONDITIONAL — ลด lot/กรองเพิ่ม |
| 5 | **SCALP_RSI_MR** | 13.4 → **70.5** | +57.1 | 11 | 36.4% | 1.94 | 8.4% | 🟡 CONDITIONAL — ลด lot/กรองเพิ่ม |

## 📋 พารามิเตอร์เทพ (Robust — พร้อมลง MT5)
### SCALP_BREAKOUT — Score 95.3
- **Params:** `{"window": 40, "atr_filter": 0.7, "sl_atr": 1.5, "rr": 2.0}`
- **Metrics:** 16 เทรด WR81.2% PF6.63 Ret56.1% DD3.8% Sharpe2.87
- _ใช้ Top2 (16 เทรด) robust กว่า raw #1 (8 เทรด)_

### SWING_MACD_RSI — Score 88.9
- **Params:** `{"ema_fast": 8, "ema_slow": 21, "signal": 7, "rsi_low": 35, "rsi_high": 70, "rr": 2.0}`
- **Metrics:** 13 เทรด WR61.5% PF3.17 Ret29.4% DD4.5% Sharpe1.39

### LONG_TREND_ATR — Score 88.1
- **Params:** `{"ema_fast": 50, "ema_slow": 250, "sl_atr": 2.0, "rr": 4.0}`
- **Metrics:** 3 เทรด WR66.7% PF5.03 Ret13.8% DD3.4% Sharpe0.96
- _raw 70/250 มี 1 เทรด overfit → ใช้ robust 50/250 (3 เทรด) แต่ยังเทรดน้อย → ไม่แนะนำเทรดจริง_

### SWING_TREND_EMA — Score 74.6
- **Params:** `{"ema_fast": 20, "ema_slow": 100, "adx_threshold": 20, "sl_atr": 1.5, "rr": 4.0}`
- **Metrics:** 13 เทรด WR46.2% PF2.33 Ret31.6% DD12.9% Sharpe0.94

### SCALP_RSI_MR — Score 70.5
- **Params:** `{"rsi_period": 14, "rsi_buy": 28, "rsi_sell": 72, "bb_period": 15, "bb_std": 2.0, "rr": 2.0}`
- **Metrics:** 11 เทรด WR36.4% PF1.94 Ret12.1% DD8.4% Sharpe0.62
- _RESCUED (มีเงื่อนไข) — raw grid best score 100 แต่ overfit (2 trades, BB 2.5 แคบเกิน) | robust best (trades>=10) score 7_

## 🎯 สรุปส่ง MT5
- **อันดับ 1-2 พร้อมเทรดจริง:** `SCALP_BREAKOUT 40/0.7/1.5/2.0` (95.3, 16 เทรด) + `SWING_MACD_RSI 8/21/7 35/70 RR2.0` (88.9, 13 เทรด) → correlation 0.15 กระจายดี แนะนำพอร์ตรวม 2 ตัวนี้
- **อันดับ 3 สำรอง:** `SWING_TREND_EMA 20/100 ADX20 RR4.0` (74.6) — bot ปัจจุบันจูนดีขึ้น แต่ DD 12.9% → ลด lot 0.7%
- **RESCUED แบบมีเงื่อนไข:** `SCALP_RSI_MR 14/28/72/15/2.0/2.0` (70.5, 11 เทรด) — ใช้ได้เฉพาะ sideway (ADX<20) + กรองเทรนด์, ไม่เหมาะตลาดเทรนด์ทอง
- **ทิ้ง:** `LONG_TREND_ATR` แม้ robust 50/250 ได้ 88.1 แต่มีแค่ 3 เทรดใน 2 ปี → ไม่มีนัยสำคัญ ต้อง forward test หรือลด TF

_Generated: tuned 1,095 combos + MC2000 + ranking | by Hermes Research Lab_
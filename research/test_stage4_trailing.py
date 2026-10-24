import pandas as pd
from run_ato_7stage_playbook import run_simulation

print("="*85)
print("TESTING STAGE 4 (TREND SHIELD + 30m ORB + 5% STOP) WITH DYNAMIC PROFIT TRAILING")
print("="*85)

# Benchmark: Stage 4 Baseline (Fixed +3.0% Take Profit, No Trailing)
res_base = run_simulation(
    use_trend_shield=True,
    hard_stop_pct=0.05,
    use_breakeven=False,
    use_dynamic_trailing=False,
    orb_window_mins=30,
    min_volume_threshold=100.0,
    take_profit_pct=0.03
)
print(f"BASELINE STAGE 4 (Fixed +3% TP) -> Trades: {res_base['total_trades']} | WinRate: {res_base['win_rate']:.1f}% | Net PnL: €{res_base['net_pnl']:+,.2f} ({res_base['return_pct']:+.2f}%) | PF: {res_base['profit_factor']:.2f} | Max DD: {res_base['max_dd']:.2f}%")
print("-" * 85)

# Test various Trailing Trigger (+2.5%, +3.0%, +3.5%, +4.0%, +4.5%) and Trailing Distance (1.2%, 1.5%, 1.8%, 2.0%)
results = []
for trail_trig in [0.025, 0.030, 0.035, 0.040, 0.045]:
    for trail_dist in [0.012, 0.015, 0.018, 0.020]:
        res = run_simulation(
            use_trend_shield=True,
            hard_stop_pct=0.05,
            use_breakeven=False,
            use_dynamic_trailing=True,
            trail_trigger_pct=trail_trig,
            trail_dist_pct=trail_dist,
            orb_window_mins=30,
            min_volume_threshold=100.0
        )
        results.append({
            "trigger": trail_trig,
            "dist": trail_dist,
            "trades": res['total_trades'],
            "win_rate": res['win_rate'],
            "net_pnl": res['net_pnl'],
            "ret_pct": res['return_pct'],
            "pf": res['profit_factor'],
            "max_dd": res['max_dd']
        })
        print(f"Trigger: +{trail_trig*100:.1f}% | Trail Dist: {trail_dist*100:.1f}% -> Trades: {res['total_trades']:2d} | WinRate: {res['win_rate']:5.1f}% | Net PnL: €{res['net_pnl']:+8.2f} ({res['return_pct']:+6.2f}%) | PF: {res['profit_factor']:5.2f} | Max DD: {res['max_dd']:5.2f}%")

df_res = pd.DataFrame(results).sort_values("net_pnl", ascending=False)
print("\n" + "="*85)
print("TOP 3 TRAILING CONFIGURATIONS FOR STAGE 4:")
print("="*85)
print(df_res.head(3).to_string(index=False))

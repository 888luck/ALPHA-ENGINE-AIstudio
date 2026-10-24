import pandas as pd
from run_ato_7stage_playbook import run_simulation

res_opt = run_simulation(
    use_trend_shield=True,
    hard_stop_pct=0.015,
    use_breakeven=True,
    breakeven_trigger=0.012,
    use_dynamic_trailing=True,
    trail_trigger_pct=0.045,
    trail_dist_pct=0.015,
    orb_window_mins=15,
    min_volume_threshold=500.0
)

tr_df = res_opt['trades_df']
print("Trades df columns:", tr_df.columns)
print(f"Total trades: {len(tr_df)}")
print(f"Wins: {len(tr_df[tr_df['pnl'] > 0])} | Losses: {len(tr_df[tr_df['pnl'] < 0])}")
print(tr_df.to_string())

tr_df.to_csv("ATO_1YEAR_OPTIMIZED_TRADES.csv", index=False)
print("Saved ATO_1YEAR_OPTIMIZED_TRADES.csv")

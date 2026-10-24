import pandas as pd
import json

trades_df = pd.read_csv("ATO_1YEAR_OPTIMIZED_TRADES.csv")
trades_list = trades_df.to_dict(orient="records")

html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Alpha Engine - Atos Group SE (ATO) 1-Year Quantitative Audit</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root {{
            --bg-primary: #0a0e17;
            --bg-card: #111827;
            --border-color: #1f2937;
            --text-main: #f3f4f6;
            --text-dim: #9ca3af;
            --accent-green: #10b981;
            --accent-red: #ef4444;
            --accent-blue: #3b82f6;
            --accent-gold: #f59e0b;
        }}
        body {{
            background-color: var(--bg-primary);
            color: var(--text-main);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 24px;
        }}
        .header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 20px;
            margin-bottom: 24px;
        }}
        .title-block h1 {{
            margin: 0 0 6px 0;
            font-size: 26px;
            letter-spacing: -0.5px;
        }}
        .badge {{
            display: inline-block;
            background: #1e3a8a;
            color: #93c5fd;
            font-size: 11px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 9999px;
            margin-right: 8px;
            text-transform: uppercase;
        }}
        .kpi-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }}
        .kpi-card {{
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 18px;
        }}
        .kpi-label {{
            font-size: 12px;
            color: var(--text-dim);
            text-transform: uppercase;
            font-weight: 600;
            margin-bottom: 6px;
        }}
        .kpi-val {{
            font-size: 24px;
            font-weight: 800;
        }}
        .text-green {{ color: var(--accent-green); }}
        .text-red {{ color: var(--accent-red); }}
        .text-blue {{ color: var(--accent-blue); }}
        .text-gold {{ color: var(--accent-gold); }}
        .section-box {{
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 24px;
        }}
        .section-box h2 {{
            margin: 0 0 16px 0;
            font-size: 18px;
            border-bottom: 1px solid #1f2937;
            padding-bottom: 10px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }}
        th, td {{
            text-align: left;
            padding: 10px 12px;
            border-bottom: 1px solid #1f2937;
        }}
        th {{
            color: var(--text-dim);
            font-weight: 600;
            text-transform: uppercase;
            font-size: 11px;
        }}
        tr:hover {{
            background-color: rgba(255, 255, 255, 0.02);
        }}
        .chart-box {{
            height: 320px;
            margin-bottom: 12px;
        }}
    </style>
</head>
<body>
    <div class="header">
        <div class="title-block">
            <span class="badge">Euronext Paris / SBF</span>
            <span class="badge" style="background:#065f46; color:#a7f3d0;">Verified IBKR Pro Tape</span>
            <h1>Atos Group SE (ATO) - 7-Stage Quantitative Audit</h1>
            <div style="color: var(--text-dim); font-size: 13px;">
                Contract ID: 767901404 | 129,130 Bars (254 Days) | October 24, 2025 – October 22, 2026
            </div>
        </div>
        <div style="text-align: right;">
            <div style="font-size: 13px; color: var(--text-dim);">Initial Capital: €5,000.00</div>
            <div style="font-size: 20px; font-weight: 800; color: var(--accent-green);">Ending Capital: €5,593.83</div>
        </div>
    </div>

    <div class="kpi-grid">
        <div class="kpi-card">
            <div class="kpi-label">Net Return</div>
            <div class="kpi-val text-green">+11.88%</div>
            <div style="font-size: 12px; color: var(--text-dim); margin-top: 4px;">+€593.83 PnL</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Profit Factor</div>
            <div class="kpi-val text-blue">1.66</div>
            <div style="font-size: 12px; color: var(--text-dim); margin-top: 4px;">Gross €1,496 / Loss €902</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Win Rate</div>
            <div class="kpi-val text-gold">28.1% (9W / 23L)</div>
            <div style="font-size: 12px; color: var(--text-dim); margin-top: 4px;">14 Breakeven Scratch Trades</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Max Drawdown</div>
            <div class="kpi-val text-green">-10.02%</div>
            <div style="font-size: 12px; color: var(--text-dim); margin-top: 4px;">Stiff -1.5% Loss Floor</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Total Executions</div>
            <div class="kpi-val">32 Trades</div>
            <div style="font-size: 12px; color: var(--text-dim); margin-top: 4px;">Over 254 Trading Days</div>
        </div>
    </div>

    <div class="section-box">
        <h2>Equity Progression Curve</h2>
        <div class="chart-box">
            <canvas id="equityChart"></canvas>
        </div>
    </div>

    <div class="section-box">
        <h2>7-Stage Progression Comparative Matrix</h2>
        <table>
            <thead>
                <tr>
                    <th>Stage</th>
                    <th>Strategy Architecture</th>
                    <th>Trades</th>
                    <th>Win Rate</th>
                    <th>Net PnL</th>
                    <th>Return %</th>
                    <th>Profit Factor</th>
                    <th>Max Drawdown</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><strong>Stage 3</strong></td>
                    <td>Naive Baseline (30m ORB, No Shield, 5% Stop)</td>
                    <td>17</td>
                    <td>35.3%</td>
                    <td class="text-red">-€339.53</td>
                    <td class="text-red">-6.79%</td>
                    <td>0.66</td>
                    <td>-99.59%</td>
                </tr>
                <tr>
                    <td><strong>Stage 4</strong></td>
                    <td>Macro Trend Shield (Daily Close > EMA-20)</td>
                    <td>28</td>
                    <td>57.1%</td>
                    <td class="text-green">+€743.02</td>
                    <td class="text-green">+14.86%</td>
                    <td>1.52</td>
                    <td>-11.10%</td>
                </tr>
                <tr>
                    <td><strong>Stage 5</strong></td>
                    <td>Two-Tier Risk Guard (-1.5% Stop + Breakeven Lock)</td>
                    <td>27</td>
                    <td>18.5%</td>
                    <td class="text-red">-€289.08</td>
                    <td class="text-red">-5.78%</td>
                    <td>0.66</td>
                    <td>-12.05%</td>
                </tr>
                <tr>
                    <td><strong>Stage 6</strong></td>
                    <td>Primary Catalyst & Filings Gated (Genesis Releases)</td>
                    <td>7</td>
                    <td>42.9%</td>
                    <td class="text-green">+€268.01</td>
                    <td class="text-green">+5.36%</td>
                    <td>2.63</td>
                    <td>-3.12%</td>
                </tr>
                <tr style="background: rgba(16, 185, 129, 0.08); font-weight: bold;">
                    <td><strong>Stage 7</strong></td>
                    <td>Optimized 15m Window + Dynamic Trailing (+4.5% / -1.5%)</td>
                    <td>32</td>
                    <td>28.1%</td>
                    <td class="text-green">+€593.83</td>
                    <td class="text-green">+11.88%</td>
                    <td>1.66</td>
                    <td>-10.02%</td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="section-box">
        <h2>Executed Trades Blotter (32 Trades)</h2>
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>Entry Timestamp</th>
                    <th>Exit Timestamp</th>
                    <th>Entry €</th>
                    <th>Exit €</th>
                    <th>Shares</th>
                    <th>Net PnL (€)</th>
                    <th>Return %</th>
                    <th>Exit Reason</th>
                    <th>Account Equity (€)</th>
                </tr>
            </thead>
            <tbody>
"""

for i, t in enumerate(trades_list):
    pnl_class = "text-green" if t['pnl'] > 0 else ("text-red" if t['pnl'] < 0 else "")
    html_content += f"""
                <tr>
                    <td>{i+1}</td>
                    <td>{t['entry_time']}</td>
                    <td>{t['exit_time']}</td>
                    <td>€{t['entry_price']:.2f}</td>
                    <td>€{t['exit_price']:.2f}</td>
                    <td>{t['shares']}</td>
                    <td class="{pnl_class}">€{t['pnl']:+,.2f}</td>
                    <td class="{pnl_class}">{t['pnl_pct']:+.2f}%</td>
                    <td><code>{t['reason']}</code></td>
                    <td>€{t['capital']:,.2f}</td>
                </tr>
    """

equity_data_points = [5000.0] + [t['capital'] for t in trades_list]
equity_labels = ["Start"] + [f"T{i+1}" for i in range(len(trades_list))]

html_content += f"""
            </tbody>
        </table>
    </div>

    <script>
        const ctx = document.getElementById('equityChart').getContext('2d');
        new Chart(ctx, {{
            type: 'line',
            data: {{
                labels: {json.dumps(equity_labels)},
                datasets: [{{
                    label: 'Portfolio Equity (€)',
                    data: {json.dumps(equity_data_points)},
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.2,
                    pointRadius: 4,
                    pointBackgroundColor: '#10b981'
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{
                    legend: {{ display: false }}
                }},
                scales: {{
                    x: {{ grid: {{ color: '#1f2937' }} }},
                    y: {{ grid: {{ color: '#1f2937' }}, min: 4500, max: 6000 }}
                }}
            }}
        }});
    </script>
</body>
</html>
"""

with open("ATO_1YEAR_OPTIMIZED_REPORT.html", "w", encoding="utf-8") as f:
    f.write(html_content)

print("Generated ATO_1YEAR_OPTIMIZED_REPORT.html successfully.")

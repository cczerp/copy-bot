# copy-bot
copies trades that have already happened 

## Profitability Rules

To ensure profitable operations, this bot implements comprehensive risk management and trade selection rules. See [PROFITABILITY_RULES.md](PROFITABILITY_RULES.md) for complete documentation.

### Key Rules

1. **Risk Management**: Never risk more than 1-2% per trade
2. **Stop-Loss**: Mandatory stop-loss on every trade
3. **Risk-Reward**: Minimum 1:2 risk-reward ratio
4. **Trader Selection**: Only copy traders with 55%+ win rate and 1.5+ profit factor
5. **Position Sizing**: Maximum 10% per position, 50% total exposure
6. **Kill Switch**: Auto-stop if daily losses exceed 15%

### Configuration

Adjust parameters in `config.json` to customize risk tolerance and trading rules.

### Implementation Priority

1. **Critical**: Stop-loss, risk per trade, kill switch
2. **High**: Risk-reward ratio, daily loss limit, trader selection
3. **Medium**: Market filters, position sizing, monitoring
4. **Low**: Profit taking optimization, trailing stops


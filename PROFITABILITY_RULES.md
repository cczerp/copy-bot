# Copy-Bot Profitability Rules

## Overview
These rules ensure the copy-bot operates profitably by implementing risk management, trade filtering, and position sizing strategies.

## 1. Risk Management Rules

### 1.1 Maximum Risk Per Trade
- **Rule**: Never risk more than 1-2% of total account balance on any single trade
- **Rationale**: Protects capital from catastrophic losses
- **Implementation**: Calculate position size based on stop-loss distance

### 1.2 Maximum Daily Loss Limit
- **Rule**: Stop all trading if daily losses exceed 5% of account balance
- **Rationale**: Prevents emotional trading and compounding losses
- **Implementation**: Track cumulative daily P&L and halt operations when limit reached

### 1.3 Maximum Drawdown
- **Rule**: Reduce position sizes by 50% if drawdown exceeds 10% from peak equity
- **Rationale**: Preserves capital during losing streaks
- **Implementation**: Monitor peak account value and current equity difference

## 2. Position Sizing Rules

### 2.1 Fixed Fractional Position Sizing
- **Rule**: Position size = (Account Balance × Risk %) / (Entry Price - Stop Loss Price)
- **Rationale**: Maintains consistent risk across all trades
- **Implementation**: Calculate before each trade execution

### 2.2 Maximum Position Size
- **Rule**: No single position should exceed 10% of total account balance
- **Rationale**: Prevents over-concentration in one trade
- **Implementation**: Cap position size regardless of risk calculation

### 2.3 Maximum Portfolio Exposure
- **Rule**: Total open positions should not exceed 50% of account balance
- **Rationale**: Maintains liquidity and flexibility
- **Implementation**: Sum all open position values before entering new trades

## 3. Stop-Loss and Take-Profit Rules

### 3.1 Mandatory Stop-Loss
- **Rule**: Every trade must have a stop-loss order placed immediately upon entry
- **Rationale**: Limits maximum loss per trade
- **Implementation**: Place stop-loss at technical support/resistance or 2-3% below entry

### 3.2 Risk-Reward Ratio
- **Rule**: Only copy trades with minimum 1:2 risk-reward ratio
- **Rationale**: Ensures profitability even with 50% win rate
- **Implementation**: Calculate potential profit vs potential loss before copying

### 3.3 Trailing Stop-Loss
- **Rule**: Move stop-loss to breakeven after 1:1 risk-reward achieved
- **Rationale**: Protects profits and creates risk-free trades
- **Implementation**: Monitor unrealized P&L and adjust stop-loss automatically

### 3.4 Partial Profit Taking
- **Rule**: Close 50% of position at 1:1 risk-reward, let remainder run to 1:2 or higher
- **Rationale**: Secures profits while maintaining upside potential
- **Implementation**: Split orders and track multiple exit levels

## 4. Trade Selection Criteria

### 4.1 Minimum Win Rate Filter
- **Rule**: Only copy traders with documented win rate of 55% or higher over 100+ trades
- **Rationale**: Historical performance indicates future probability
- **Implementation**: Track and calculate win rate from trade history

### 4.2 Minimum Profit Factor
- **Rule**: Only copy traders with profit factor of 1.5 or higher
- **Rationale**: Gross profits should exceed gross losses by significant margin
- **Implementation**: Calculate (Total Winning Trades $ / Total Losing Trades $)

### 4.3 Maximum Drawdown History
- **Rule**: Avoid copying traders who have experienced drawdowns exceeding 25%
- **Rationale**: Indicates poor risk management or unstable strategy
- **Implementation**: Analyze historical equity curve

### 4.4 Consistency Filter
- **Rule**: Trader must have profitable months in at least 70% of last 12 months
- **Rationale**: Consistency indicates robust strategy
- **Implementation**: Review monthly P&L history

## 5. Market Condition Filters

### 5.1 High Volatility Filter
- **Rule**: Reduce position sizes by 50% when VIX or equivalent volatility index exceeds 30
- **Rationale**: High volatility increases risk of stop-loss triggering
- **Implementation**: Check volatility index before each trade

### 5.2 Low Liquidity Filter
- **Rule**: Avoid copying trades in assets with average daily volume below $1M
- **Rationale**: Low liquidity increases slippage and execution risk
- **Implementation**: Query volume data before trade execution

### 5.3 News Event Filter
- **Rule**: Avoid copying trades 30 minutes before and after major economic announcements
- **Rationale**: High uncertainty and volatility during news events
- **Implementation**: Maintain economic calendar and check timing

### 5.4 Market Hours Filter
- **Rule**: Only copy trades during high-liquidity trading hours (avoid first/last 15 minutes)
- **Rationale**: Better execution and tighter spreads during peak hours
- **Implementation**: Check timestamp against market schedule

## 6. Execution Rules

### 6.1 Slippage Tolerance
- **Rule**: Reject trade if execution price differs from copied price by more than 0.5%
- **Rationale**: Excessive slippage erodes profitability
- **Implementation**: Compare intended vs actual execution price

### 6.2 Maximum Delay
- **Rule**: Do not copy trades if signal is older than 5 seconds
- **Rationale**: Stale signals may no longer be valid
- **Implementation**: Timestamp each signal and check age before execution

### 6.3 Confirmation Required
- **Rule**: Require two independent data sources confirming the original trade occurred
- **Rationale**: Prevents copying false or manipulated signals
- **Implementation**: Cross-reference multiple data feeds

## 7. Monitoring and Adjustment Rules

### 7.1 Daily Performance Review
- **Rule**: Review all trades and performance metrics at end of each trading day
- **Rationale**: Identifies issues early and enables rapid adjustment
- **Implementation**: Generate daily performance report

### 7.2 Weekly Strategy Review
- **Rule**: Analyze trader performance and adjust copying list weekly
- **Rationale**: Removes underperforming traders and adds new opportunities
- **Implementation**: Calculate weekly metrics and rerank traders

### 7.3 Monthly Rules Adjustment
- **Rule**: Review and update profitability rules based on performance data
- **Rationale**: Adapts to changing market conditions and bot performance
- **Implementation**: Conduct monthly strategy session with stakeholders

## 8. Emergency Protocols

### 8.1 Kill Switch
- **Rule**: Immediately stop all trading and close positions if:
  - Account losses exceed 15% in single day
  - Multiple system errors detected
  - Unusual market conditions observed
- **Rationale**: Prevents catastrophic losses
- **Implementation**: Automated monitoring with manual override capability

### 8.2 Position Reduction Protocol
- **Rule**: Reduce all position sizes by 75% if:
  - Three consecutive losing days
  - Market volatility doubles historical average
  - Key trader being copied shows signs of deterioration
- **Rationale**: Defensive posture during adverse conditions
- **Implementation**: Trigger-based automatic position sizing adjustment

## 9. Compliance and Ethical Rules

### 9.1 No Front-Running
- **Rule**: Never execute trades before the original trader
- **Rationale**: Maintains ethical standards and prevents market manipulation
- **Implementation**: Timestamp verification and execution delay

### 9.2 Regulatory Compliance
- **Rule**: Ensure all copied trades comply with applicable regulations
- **Rationale**: Avoids legal issues and account restrictions
- **Implementation**: Maintain compliance checklist and review process

### 9.3 No Illegal Assets
- **Rule**: Do not copy trades in restricted or illegal instruments
- **Rationale**: Maintains legal operation
- **Implementation**: Maintain whitelist of approved instruments

## 10. Performance Metrics

### 10.1 Required Metrics to Track
- Win Rate (%)
- Profit Factor
- Average Risk:Reward Ratio
- Maximum Drawdown (%)
- Sharpe Ratio
- Average Trade Duration
- Total Return (%)
- Number of Trades per Week

### 10.2 Minimum Performance Targets
- **Win Rate**: ≥ 50%
- **Profit Factor**: ≥ 1.5
- **Maximum Drawdown**: ≤ 15%
- **Sharpe Ratio**: ≥ 1.0
- **Monthly Return**: ≥ 3%

### 10.3 Performance-Based Scaling
- **Rule**: Increase position sizes by 10% for each month meeting all targets
- **Rule**: Decrease position sizes by 20% for each month missing targets
- **Rationale**: Scales exposure based on proven performance
- **Implementation**: Monthly review and adjustment

## Implementation Priority

1. **Critical (Implement First)**:
   - Mandatory stop-loss (3.1)
   - Maximum risk per trade (1.1)
   - Kill switch (8.1)

2. **High Priority**:
   - Risk-reward ratio (3.2)
   - Daily loss limit (1.2)
   - Slippage tolerance (6.1)
   - Trade selection criteria (4.1-4.4)

3. **Medium Priority**:
   - Market condition filters (5.1-5.4)
   - Position sizing rules (2.1-2.3)
   - Performance monitoring (7.1-7.3)

4. **Low Priority (Optimization)**:
   - Partial profit taking (3.4)
   - Trailing stops (3.3)
   - Performance-based scaling (10.3)

## Review Schedule

- **Daily**: Check if all critical rules are being followed
- **Weekly**: Review performance metrics and trader selection
- **Monthly**: Full rules review and adjustment based on results
- **Quarterly**: Comprehensive strategy review and optimization

---

**Note**: These rules should be implemented programmatically with proper logging, alerting, and override capabilities. All rule violations should be logged for analysis. Rules may need adjustment based on specific market conditions, asset classes, and regulatory requirements.

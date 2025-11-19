/**
 * Core type definitions for Polygon arbitrage monitor
 * All types designed for research and academic purposes
 */

export enum DEXType {
  QuickSwap = 'quickswap',
  Algebra = 'algebra',
  Uniswap = 'uniswap',
  Balancer = 'balancer',
  Curve = 'curve',
}

export interface Token {
  address: string;
  symbol: string;
  decimals: number;
  priceUSD?: number;
}

export interface PoolState {
  dexType: DEXType;
  address: string;
  token0: Token;
  token1: Token;
  reserve0: bigint;
  reserve1: bigint;
  fee?: number; // basis points
  liquidity?: bigint;
  sqrtPriceX96?: bigint; // Uniswap V3 specific
  currentTick?: number;
  twapPrice?: number;
  timestamp: number;
}

export interface PendingTx {
  hash: string;
  from: string;
  to?: string;
  value: string;
  data: string;
  gasPrice: string;
  gasLimit: string;
  nonce: number;
  timestamp: number;
  source: 'bloxroute' | 'eden' | 'manifold';
}

export enum OpportunityType {
  CrossDexArbitrage = 'cross_dex_arbitrage',
  JitLiquidity = 'jit_liquidity',
  TWAPArbitrage = 'twap_arbitrage',
  TriangleCycle = 'triangle_cycle',
  StatisticalArbitrage = 'statistical_arbitrage',
}

export interface ArbitrageOpportunity {
  id: string;
  type: OpportunityType;
  createdAt: number;
  triggeringTx?: PendingTx;
  pools: PoolState[];
  expectedProfitUSD: number;
  expectedProfitBPS: number;
  profitMargin: number; // Decimal, e.g., 0.008 for 0.8%
  gasEstimate: bigint;
  flashloanRequired: boolean;
  flashloanAmount: bigint;
  path: string[]; // Token addresses
  simulation?: SimulationResult;
  confidence: number; // 0-1
}

export interface SimulationResult {
  success: boolean;
  outputAmount: bigint;
  actualProfit: bigint;
  actualProfitBPS: number;
  gasCost: bigint;
  flashloanFee: bigint;
  netProfit: bigint;
  netProfitBPS: number;
  deviations: StateDeviation[];
  revertReason?: string;
}

export interface StateDeviation {
  poolAddress: string;
  expectedState: PoolState;
  actualState: PoolState;
  deviationBPS: number;
}

export interface BundleConfig {
  transactionHash?: string;
  profitRecipient: string;
  minProfitBPS: number;
  maxGasBPS: number;
  revertOnDeviation: boolean;
  deviationThresholdBPS: number;
}

export interface ExecutionResult {
  bundleHash: string;
  submittedAt: number;
  includedInBlock?: number;
  profitRealized?: bigint;
  txHash?: string;
  status: 'submitted' | 'included' | 'failed' | 'reverted';
  error?: string;
}

export interface AuditLog {
  timestamp: number;
  type: 'opportunity_detected' | 'simulation_run' | 'bundle_submitted' | 'execution_result' | 'safety_check_failed';
  opportunityId?: string;
  data: Record<string, unknown>;
  severity: 'info' | 'warning' | 'error';
}

export interface MonitorConfig {
  minProfitBPS: number;
  minLiquidityUSD: number;
  maxSlippageBPS: number;
  simulationTimeoutMs: number;
  enableExecution: boolean;
  revertOnDeviation: boolean;
  deviationThresholdBPS: number;
}

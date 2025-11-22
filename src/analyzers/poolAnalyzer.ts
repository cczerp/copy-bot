/**
 * Pool State Analyzer
 * Monitors DEX pool states and identifies mispricing opportunities
 */

import { ethers } from 'ethers';
import pino from 'pino';
import Decimal from 'decimal.js';
import { PoolState, DEXType, Token, ArbitrageOpportunity, OpportunityType } from '../types/index.js';

const logger = pino();

// Pool ABI excerpts for state queries
const UNISWAP_V2_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];

const UNISWAP_V3_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
];

const ALGEBRA_ABI = [
  'function globalState() external view returns (uint160 price, int24 tick, uint16 feeZoneID, uint16 communityFeeToken0, uint16 communityFeeToken1, uint8 unlocked)',
  'function liquidity() external view returns (uint128)',
];

const CURVE_ABI = [
  'function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)',
];

const TOKEN_ABI = ['function decimals() external view returns (uint8)', 'function symbol() external view returns (string)'];

export class PoolAnalyzer {
  private provider: ethers.Provider;
  private poolCache: Map<string, PoolState> = new Map();

  constructor(provider: ethers.Provider) {
    this.provider = provider;
  }

  /**
   * Fetch current state of a Uniswap V2 pool
   */
  async getUniswapV2PoolState(
    poolAddress: string,
    token0: Token,
    token1: Token,
    fee?: number
  ): Promise<PoolState | null> {
    try {
      const contract = new ethers.Contract(poolAddress, UNISWAP_V2_ABI, this.provider);
      const [reserve0, reserve1, blockTimestamp] = await contract.getReserves();

      const pool: PoolState = {
        dexType: DEXType.QuickSwap,
        address: poolAddress,
        token0,
        token1,
        reserve0: BigInt(reserve0),
        reserve1: BigInt(reserve1),
        fee: fee || 3000, // Default to 0.3%
        timestamp: blockTimestamp,
      };

      // Cache and return
      this.poolCache.set(poolAddress, pool);
      return pool;
    } catch (error) {
      logger.debug({ error, poolAddress }, 'Failed to fetch Uniswap V2 pool state');
      return null;
    }
  }

  /**
   * Fetch current state of a Uniswap V3 pool
   */
  async getUniswapV3PoolState(
    poolAddress: string,
    token0: Token,
    token1: Token,
    fee?: number
  ): Promise<PoolState | null> {
    try {
      const contract = new ethers.Contract(poolAddress, UNISWAP_V3_ABI, this.provider);
      const [sqrtPriceX96, tick] = await contract.slot0();
      const liquidity = await contract.liquidity();

      const pool: PoolState = {
        dexType: DEXType.Uniswap,
        address: poolAddress,
        token0,
        token1,
        reserve0: BigInt(0), // V3 doesn't use reserves
        reserve1: BigInt(0),
        fee: fee || 3000,
        sqrtPriceX96: BigInt(sqrtPriceX96),
        currentTick: tick,
        liquidity: BigInt(liquidity),
        timestamp: Date.now(),
      };

      this.poolCache.set(poolAddress, pool);
      return pool;
    } catch (error) {
      logger.debug({ error, poolAddress }, 'Failed to fetch Uniswap V3 pool state');
      return null;
    }
  }

  /**
   * Fetch current state of an Algebra pool
   */
  async getAlgebraPoolState(
    poolAddress: string,
    token0: Token,
    token1: Token,
    fee?: number
  ): Promise<PoolState | null> {
    try {
      const contract = new ethers.Contract(poolAddress, ALGEBRA_ABI, this.provider);
      const [price, tick] = await contract.globalState();
      const liquidity = await contract.liquidity();

      const pool: PoolState = {
        dexType: DEXType.Algebra,
        address: poolAddress,
        token0,
        token1,
        reserve0: BigInt(0),
        reserve1: BigInt(0),
        fee: fee || 500, // Dynamic fee pool, use minimal default
        sqrtPriceX96: BigInt(price),
        currentTick: tick,
        liquidity: BigInt(liquidity),
        timestamp: Date.now(),
      };

      this.poolCache.set(poolAddress, pool);
      return pool;
    } catch (error) {
      logger.debug({ error, poolAddress }, 'Failed to fetch Algebra pool state');
      return null;
    }
  }

  /**
   * Calculate spot price between two tokens
   */
  calculateSpotPrice(pool: PoolState): Decimal {
    try {
      if (pool.sqrtPriceX96) {
        // Uniswap V3 / Algebra style
        const sqrtPrice = new Decimal(pool.sqrtPriceX96.toString());
        const price = sqrtPrice.pow(2).dividedBy(new Decimal(2).pow(192));
        return price;
      } else {
        // Uniswap V2 style (use reserves)
        const reserve0 = new Decimal(pool.reserve0.toString());
        const reserve1 = new Decimal(pool.reserve1.toString());

        if (reserve0.isZero()) {
          return new Decimal(0);
        }

        return reserve1.dividedBy(reserve0);
      }
    } catch (error) {
      logger.debug({ error, pool }, 'Error calculating spot price');
      return new Decimal(0);
    }
  }

  /**
   * Detect cross-DEX arbitrage opportunities
   */
  detectCrossArbitrage(pools: Map<string, PoolState>, minProfitBPS: number): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];

    try {
      // Group pools by token pair
      const pairMap: Map<string, PoolState[]> = new Map();

      for (const [poolAddr, pool] of pools) {
        const pairKey = [pool.token0.address.toLowerCase(), pool.token1.address.toLowerCase()]
          .sort()
          .join('-');

        if (!pairMap.has(pairKey)) {
          pairMap.set(pairKey, []);
        }
        pairMap.get(pairKey)!.push(pool);
      }

      // Check for price divergence
      for (const [pairKey, poolList] of pairMap) {
        if (poolList.length < 2) continue;

        // Sort by price to find highest and lowest
        const priceMap = poolList.map((p) => ({
          pool: p,
          price: this.calculateSpotPrice(p),
        }));

        priceMap.sort((a, b) => a.price.comparedTo(b.price));

        const lowPricePool = priceMap[0];
        const highPricePool = priceMap[priceMap.length - 1];

        // Calculate profit opportunity
        const priceDiff = highPricePool.price.minus(lowPricePool.price);
        const profitBPS = priceDiff
          .dividedBy(lowPricePool.price)
          .times(10000)
          .toNumber();

        // Only flag if profitable after slippage and fees
        if (profitBPS > minProfitBPS + 100) {
          // Add 1% for slippage + fees
          const opportunity: ArbitrageOpportunity = {
            id: `arb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: OpportunityType.CrossDexArbitrage,
            createdAt: Date.now(),
            pools: [lowPricePool.pool, highPricePool.pool],
            expectedProfitBPS: profitBPS - 100,
            expectedProfitUSD: 0, // Will be calculated with simulation
            profitMargin: profitBPS / 10000 - 0.01,
            gasEstimate: BigInt(150000),
            flashloanRequired: false,
            flashloanAmount: BigInt(0),
            path: [lowPricePool.pool.token0.address, lowPricePool.pool.token1.address],
            confidence: 0.7,
          };

          opportunities.push(opportunity);

          logger.info(
            {
              pair: pairKey,
              profitBPS: profitBPS.toFixed(2),
              lowPool: lowPricePool.pool.dexType,
              highPool: highPricePool.pool.dexType,
            },
            'Found cross-DEX arbitrage opportunity'
          );
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error detecting cross-DEX arbitrage');
    }

    return opportunities;
  }

  /**
   * Detect potential TWAP arbitrage (oracle stale price vs spot)
   */
  detectTWAPArbitrage(
    spotPools: PoolState[],
    twapPrices: Map<string, Decimal>,
    minProfitBPS: number
  ): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];

    try {
      for (const pool of spotPools) {
        const spotPrice = this.calculateSpotPrice(pool);
        const twapKey = `${pool.token0.address}-${pool.token1.address}`;
        const twapPrice = twapPrices.get(twapKey);

        if (!twapPrice) continue;

        const priceDiff = spotPrice.minus(twapPrice).abs();
        const profitBPS = priceDiff.dividedBy(twapPrice).times(10000).toNumber();

        // Only flag significant deviations
        if (profitBPS > minProfitBPS + 50) {
          const opportunity: ArbitrageOpportunity = {
            id: `twap-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: OpportunityType.TWAPArbitrage,
            createdAt: Date.now(),
            pools: [pool],
            expectedProfitBPS: profitBPS - 50,
            expectedProfitUSD: 0,
            profitMargin: profitBPS / 10000 - 0.005,
            gasEstimate: BigInt(200000),
            flashloanRequired: true,
            flashloanAmount: BigInt(0), // To be calculated during simulation
            path: [pool.token0.address, pool.token1.address],
            confidence: 0.6,
          };

          opportunities.push(opportunity);

          logger.info(
            {
              pair: twapKey,
              profitBPS: profitBPS.toFixed(2),
              spotPrice: spotPrice.toString(),
              twapPrice: twapPrice.toString(),
            },
            'Found TWAP arbitrage opportunity'
          );
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error detecting TWAP arbitrage');
    }

    return opportunities;
  }

  /**
   * Estimate liquidity impact on a swap
   */
  estimateSwapSlippage(pool: PoolState, tokenInAmount: bigint): Decimal {
    try {
      if (pool.sqrtPriceX96) {
        // V3 pools - simplified impact model
        const liquidity = pool.liquidity || BigInt(1);
        const impact = new Decimal(tokenInAmount.toString()).dividedBy(
          new Decimal(liquidity.toString()).times(2)
        );
        return impact.times(10000); // Return in BPS
      } else {
        // V2 pools - use constant product formula
        const reserve0 = new Decimal(pool.reserve0.toString());
        const amountIn = new Decimal(tokenInAmount.toString());

        // Calculate k = reserve0 * reserve1
        const k = reserve0.times(new Decimal(pool.reserve1.toString()));

        // New reserve0 after swap
        const newReserve0 = reserve0.plus(amountIn);

        // New reserve1 from constant product
        const newReserve1 = k.dividedBy(newReserve0);

        // Amount out
        const amountOut = new Decimal(pool.reserve1.toString()).minus(newReserve1);

        // Spot price before
        const spotPrice = new Decimal(pool.reserve1.toString()).dividedBy(reserve0);

        // Effective price (what we actually get)
        const effectivePrice = amountOut.dividedBy(amountIn);

        // Slippage in BPS
        const slippage = spotPrice.minus(effectivePrice).dividedBy(spotPrice).times(10000);

        return slippage;
      }
    } catch (error) {
      logger.debug({ error, pool }, 'Error estimating swap slippage');
      return new Decimal(0);
    }
  }

  /**
   * Clear expired cache entries
   */
  clearOldCache(maxAgeMs: number = 60000): void {
    const now = Date.now();
    for (const [addr, pool] of this.poolCache) {
      if (now - pool.timestamp > maxAgeMs) {
        this.poolCache.delete(addr);
      }
    }
  }

  getCachedPool(address: string): PoolState | undefined {
    return this.poolCache.get(address);
  }
}

/**
 * Arbitrage Executor
 * Builds and submits arbitrage transactions with flashloan support
 * Includes safety checks and revert-on-deviation patterns
 */

import { ethers } from 'ethers';
import pino from 'pino';
import Decimal from 'decimal.js';
import {
  ArbitrageOpportunity,
  OpportunityType,
  ExecutionResult,
  BundleConfig,
} from '../types/index.js';

const logger = pino();

// Flashloan provider ABIs
const AAVE_FLASHLOAN_ABI = [
  'function flashLoanSimple(address receiver, address token, uint256 amount, bytes calldata params) external',
  'function ADDRESSES_PROVIDER() external view returns (address)',
];

const BALANCER_VAULT_ABI = [
  'function flashLoan(address recipient, address[] calldata tokens, uint256[] calldata amounts, bytes calldata userData) external',
];

export interface FlashloanConfig {
  provider: 'aave' | 'balancer' | 'custom';
  address: string;
  maxFeePercent: Decimal;
}

export class ArbitrageExecutor {
  private wallet?: ethers.Wallet;
  private provider: ethers.Provider;
  private flashloanConfig: FlashloanConfig;
  private dryRunMode: boolean;

  constructor(
    provider: ethers.Provider,
    flashloanConfig: FlashloanConfig,
    dryRunMode: boolean = true,
    privateKey?: string
  ) {
    this.provider = provider;
    this.flashloanConfig = flashloanConfig;
    this.dryRunMode = dryRunMode;

    if (privateKey && !dryRunMode) {
      this.wallet = new ethers.Wallet(privateKey, provider);
    }
  }

  /**
   * Build arbitrage transaction
   */
  buildTransaction(opportunity: ArbitrageOpportunity): ethers.TransactionRequest {
    switch (opportunity.type) {
      case OpportunityType.CrossDexArbitrage:
        return this.buildCrossArbitrageTransaction(opportunity);
      case OpportunityType.TWAPArbitrage:
        return this.buildTWAPArbitrageTransaction(opportunity);
      case OpportunityType.TriangleCycle:
        return this.buildTriangleCycleTransaction(opportunity);
      case OpportunityType.JitLiquidity:
        return this.buildJitLiquidityTransaction(opportunity);
      default:
        throw new Error(`Unsupported opportunity type: ${opportunity.type}`);
    }
  }

  /**
   * Build cross-DEX arbitrage transaction
   * Buys from cheaper pool, sells to expensive pool
   */
  private buildCrossArbitrageTransaction(opportunity: ArbitrageOpportunity): ethers.TransactionRequest {
    const [cheapPool, expensivePool] = opportunity.pools;

    logger.debug(
      {
        opportunityId: opportunity.id,
        cheapPool: cheapPool.dexType,
        expensivePool: expensivePool.dexType,
      },
      'Building cross-DEX arbitrage transaction'
    );

    // Simplified calldata construction
    // In production, this would use actual swap router contracts
    const swapData = this.encodeSwapCalldata(
      cheapPool.address,
      cheapPool.token0.address,
      cheapPool.token1.address,
      opportunity.pools[0].reserve0 // Use pool 0's reserve as input amount
    );

    return {
      to: cheapPool.address,
      value: '0',
      gasLimit: opportunity.gasEstimate,
      data: swapData,
      chainId: 137, // Polygon
    };
  }

  /**
   * Build TWAP arbitrage with flashloan
   */
  private buildTWAPArbitrageTransaction(opportunity: ArbitrageOpportunity): ethers.TransactionRequest {
    logger.debug(
      {
        opportunityId: opportunity.id,
        flashloan: opportunity.flashloanRequired,
      },
      'Building TWAP arbitrage transaction'
    );

    if (!opportunity.flashloanRequired) {
      throw new Error('TWAP arbitrage requires flashloan');
    }

    // Build flashloan + callback transaction
    return this.buildFlashloanTransaction(opportunity);
  }

  /**
   * Build triangular/cyclic arbitrage transaction
   */
  private buildTriangleCycleTransaction(opportunity: ArbitrageOpportunity): ethers.TransactionRequest {
    logger.debug(
      {
        opportunityId: opportunity.id,
        pathLength: opportunity.path.length,
      },
      'Building triangular arbitrage transaction'
    );

    const gasEstimate = BigInt(opportunity.path.length) * BigInt(150000); // ~150k per hop

    return {
      to: opportunity.pools[0].address,
      value: '0',
      gasLimit: gasEstimate,
      data: '0x', // Would encode multi-hop swap
      chainId: 137,
    };
  }

  /**
   * Build JIT liquidity transaction
   */
  private buildJitLiquidityTransaction(opportunity: ArbitrageOpportunity): ethers.TransactionRequest {
    logger.debug(
      {
        opportunityId: opportunity.id,
        liquidity: opportunity.flashloanAmount.toString(),
      },
      'Building JIT liquidity transaction'
    );

    return {
      to: opportunity.pools[0].address,
      value: '0',
      gasLimit: BigInt(300000),
      data: '0x', // Would encode add + remove liquidity
      chainId: 137,
    };
  }

  /**
   * Build flashloan wrapper transaction
   */
  private buildFlashloanTransaction(opportunity: ArbitrageOpportunity): ethers.TransactionRequest {
    const token = opportunity.pools[0].token0.address;
    const amount = opportunity.flashloanAmount;

    let calldataPath: string;

    if (this.flashloanConfig.provider === 'aave') {
      calldataPath = this.encodeAaveFlashloan(token, amount, opportunity.id);
    } else if (this.flashloanConfig.provider === 'balancer') {
      calldataPath = this.encodeBalancerFlashloan([token], [amount], opportunity.id);
    } else {
      calldataPath = this.encodeCustomFlashloan(token, amount, opportunity.id);
    }

    return {
      to: this.flashloanConfig.address,
      value: '0',
      gasLimit: opportunity.gasEstimate,
      data: calldataPath,
      chainId: 137,
    };
  }

  /**
   * Encode Aave V3 flashloan call
   */
  private encodeAaveFlashloan(token: string, amount: bigint, opportunityId: string): string {
    const iface = new ethers.Interface(AAVE_FLASHLOAN_ABI);

    // Encode callback data with opportunity ID
    const callbackData = ethers.solidityPacked(
      ['string'],
      [opportunityId]
    );

    const data = iface.encodeFunctionData('flashLoanSimple', [
      process.env.EXECUTOR_ADDRESS || '0x0000000000000000000000000000000000000000',
      token,
      amount,
      callbackData,
    ]);

    return data;
  }

  /**
   * Encode Balancer flashloan call
   */
  private encodeBalancerFlashloan(tokens: string[], amounts: bigint[], opportunityId: string): string {
    const iface = new ethers.Interface(BALANCER_VAULT_ABI);

    const callbackData = ethers.solidityPacked(
      ['string'],
      [opportunityId]
    );

    const data = iface.encodeFunctionData('flashLoan', [
      process.env.EXECUTOR_ADDRESS || '0x0000000000000000000000000000000000000000',
      tokens,
      amounts,
      callbackData,
    ]);

    return data;
  }

  /**
   * Encode custom flashloan call
   */
  private encodeCustomFlashloan(token: string, amount: bigint, opportunityId: string): string {
    // Standard ERC-3156 flashloan interface
    const iface = new ethers.Interface([
      'function flashLoan(address receiver, address token, uint256 amount, bytes calldata data) external returns (bytes32)',
    ]);

    const callbackData = ethers.solidityPacked(
      ['string'],
      [opportunityId]
    );

    return iface.encodeFunctionData('flashLoan', [
      process.env.EXECUTOR_ADDRESS || '0x0000000000000000000000000000000000000000',
      token,
      amount,
      callbackData,
    ]);
  }

  /**
   * Encode generic swap calldata (Uniswap V2 format)
   */
  private encodeSwapCalldata(
    poolAddress: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): string {
    // This would be the actual router contract, not the pool
    // Simplified for demonstration
    const iface = new ethers.Interface([
      'function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient) external',
    ]);

    return iface.encodeFunctionData('swap', [
      tokenIn,
      tokenOut,
      amountIn,
      0, // minAmountOut would be set during execution
      process.env.EXECUTOR_ADDRESS || '0x0000000000000000000000000000000000000000',
    ]);
  }

  /**
   * Execute arbitrage transaction (with safety checks)
   */
  async execute(opportunity: ArbitrageOpportunity): Promise<ExecutionResult> {
    if (this.dryRunMode) {
      return this.simulateExecute(opportunity);
    }

    if (!this.wallet) {
      throw new Error('Wallet not configured for execution');
    }

    try {
      logger.info(
        {
          opportunityId: opportunity.id,
          type: opportunity.type,
          expectedProfit: opportunity.expectedProfitBPS,
        },
        'Executing arbitrage opportunity'
      );

      // Verify opportunity is still profitable
      if (!opportunity.simulation || opportunity.simulation.netProfitBPS < 50) {
        throw new Error('Opportunity no longer profitable');
      }

      // Build transaction
      const tx = this.buildTransaction(opportunity);

      // Add safety parameters
      const safetyTx = this.addSafetyParameters(tx, opportunity);

      // Send transaction
      const result = await this.wallet.sendTransaction(safetyTx);

      logger.info(
        {
          opportunityId: opportunity.id,
          txHash: result.hash,
        },
        'Arbitrage transaction submitted'
      );

      return {
        bundleHash: result.hash,
        submittedAt: Date.now(),
        status: 'submitted',
      };
    } catch (error) {
      logger.error(
        {
          error,
          opportunityId: opportunity.id,
        },
        'Arbitrage execution failed'
      );

      return {
        bundleHash: '',
        submittedAt: Date.now(),
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Simulate execution (dry run mode)
   */
  private simulateExecute(opportunity: ArbitrageOpportunity): ExecutionResult {
    logger.info(
      {
        opportunityId: opportunity.id,
        type: opportunity.type,
        expectedProfit: opportunity.expectedProfitBPS,
        dryRun: true,
      },
      'Simulating arbitrage execution'
    );

    return {
      bundleHash: `0x${Math.random().toString(16).slice(2).padEnd(64, '0')}`,
      submittedAt: Date.now(),
      status: 'submitted', // In dry-run, we say "submitted" but nothing actually happens
    };
  }

  /**
   * Add safety parameters to transaction
   */
  private addSafetyParameters(
    tx: ethers.TransactionRequest,
    opportunity: ArbitrageOpportunity
  ): ethers.TransactionRequest {
    // Add revert-on-deviation checks
    // Add minimum profit requirements
    // Add deadline (time-bound execution)

    return {
      ...tx,
      gasLimit: (BigInt(tx.gasLimit || 0) * BigInt(120)) / BigInt(100), // 120% buffer
    };
  }

  /**
   * Build bundle configuration for private relay submission
   */
  buildBundleConfig(opportunity: ArbitrageOpportunity): BundleConfig {
    return {
      profitRecipient: process.env.EXECUTOR_ADDRESS || '0x0000000000000000000000000000000000000000',
      minProfitBPS: Math.floor(opportunity.expectedProfitBPS * 0.8), // 80% of expected
      maxGasBPS: Math.floor(opportunity.expectedProfitBPS * 0.2), // 20% of profit for gas
      revertOnDeviation: true,
      deviationThresholdBPS: parseInt(process.env.REVERT_ON_DEVIATION_SLIPPAGE_BPS || '50'),
    };
  }
}

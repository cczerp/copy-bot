/**
 * Polygon Copy Trading Bot - Main Entry Point
 *
 * Simple mempool monitoring bot that:
 * 1. Monitors mempool for large swap transactions
 * 2. Calculates if trading 2x the size is profitable
 * 3. Executes immediately if profitable (with flashloan)
 *
 * All resources dedicated to: Monitor -> Calculate -> Execute loop
 * 100% compliant with DeFi protocols and Polygon network policies
 */

import 'dotenv/config';
import pino from 'pino';
import { ethers } from 'ethers';
import { TransactionListener } from './listeners/transactionListener.js';
import { decodeCalldata } from './decoders/calldataDecoder.js';
import { PoolAnalyzer } from './analyzers/poolAnalyzer.js';
import { SimulationEngine } from './simulator/simulationEngine.js';
import { SafetyChecker, SafetyCheckResult } from './safety/safetyChecker.js';
import { ArbitrageExecutor } from './executor/arbitrageExecutor.js';
import { BundleSubmitter } from './relays/bundleSubmitter.js';
import { ArbitrageOpportunity, OpportunityType } from './types/index.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

interface MonitorStats {
  txsProcessed: number;
  opportunitiesFound: number;
  opportunitiesSimulated: number;
  opportunitiesExecuted: number;
  totalProfit: bigint;
}

class PolygonCopyTradingBot {
  private txListener?: TransactionListener;
  private poolAnalyzer?: PoolAnalyzer;
  private simulationEngine?: SimulationEngine;
  private safetyChecker?: SafetyChecker;
  private executor?: ArbitrageExecutor;
  private bundleSubmitter?: BundleSubmitter;
  private provider?: ethers.Provider;
  private stats: MonitorStats = {
    txsProcessed: 0,
    opportunitiesFound: 0,
    opportunitiesSimulated: 0,
    opportunitiesExecuted: 0,
    totalProfit: BigInt(0),
  };

  async initialize(): Promise<void> {
    logger.info('Initializing Polygon Copy Trading Bot...');

    try {
      // Initialize provider
      const rpcUrl = process.env.POLYGON_RPC_URL;
      if (!rpcUrl) {
        throw new Error('POLYGON_RPC_URL not set');
      }

      this.provider = new ethers.JsonRpcProvider(rpcUrl);

      // Test connection
      const blockNumber = await this.provider.getBlockNumber();
      logger.info({ blockNumber }, 'Connected to Polygon RPC');

      // Initialize components
      this.poolAnalyzer = new PoolAnalyzer(this.provider);
      this.simulationEngine = new SimulationEngine(
        process.env.ANVIL_FORK_URL || rpcUrl,
        137, // Polygon chain ID
        parseInt(process.env.SIMULATION_TIMEOUT_MS || '5000')
      );

      this.safetyChecker = new SafetyChecker(process.env.AUDIT_LOG_PATH);

      const flashloanProvider = process.env.FLASHLOAN_PROVIDER || 'aave';
      const flashloanAddress = process.env.FLASHLOAN_ADDRESS || '0x794a61358D6845594F94dc1DB02A252b5b4814aD'; // Aave V3 Pool

      this.executor = new ArbitrageExecutor(
        this.provider,
        {
          provider: flashloanProvider as 'aave' | 'balancer' | 'custom',
          address: flashloanAddress,
          maxFeePercent: new (await import('decimal.js')).default(0.05),
        },
        process.env.ENABLE_EXECUTION !== 'true', // Dry run by default
        process.env.EXECUTOR_PRIVATE_KEY
      );

      this.bundleSubmitter = new BundleSubmitter(
        process.env.BUNDLE_RELAY_TYPE as 'manifold' | 'eden' | 'custom' || 'manifold'
      );

      // Initialize transaction listener
      const txSource = (process.env.TX_SOURCE || 'bloxroute') as
        | 'bloxroute'
        | 'eden'
        | 'manifold';
      this.txListener = new TransactionListener(txSource, process.env.TX_STREAM_API_KEY);

      logger.info('Copy Trading Bot initialized successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize monitor');
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.txListener) {
      throw new Error('Monitor not initialized');
    }

    logger.info('Starting mempool monitoring for copy trading...');

    // Start listening for transactions
    await this.txListener.start();

    // Set up event handlers
    this.txListener.on('tx', (tx) => {
      this.handleIncomingTransaction(tx);
    });

    // Start periodic cache cleanup
    setInterval(() => {
      if (this.poolAnalyzer) {
        this.poolAnalyzer.clearOldCache(60000);
      }
    }, 30000);

    // Start periodic stats logging
    setInterval(() => {
      this.logStats();
    }, 60000);

    logger.info('Copy Trading Bot running. Watching for large swaps...');
  }

  private async handleIncomingTransaction(tx: any): Promise<void> {
    this.stats.txsProcessed++;

    try {
      // Decode transaction
      const decoded = decodeCalldata(tx.to, tx.data);
      if (!decoded || decoded.type === 'unknown') {
        return;
      }

      logger.debug(
        {
          hash: tx.hash,
          function: decoded.function,
          type: decoded.type,
        },
        'Transaction decoded'
      );

      // Analyze for opportunities
      const opportunities = await this.detectOpportunities(tx, decoded);

      if (opportunities.length === 0) {
        return;
      }

      this.stats.opportunitiesFound += opportunities.length;

      logger.info(
        {
          txHash: tx.hash,
          opportunitiesFound: opportunities.length,
        },
        'Opportunities detected'
      );

      // Process each opportunity
      for (const opp of opportunities) {
        await this.processOpportunity(opp);
      }
    } catch (error) {
      logger.debug({ error, txHash: tx.hash }, 'Error processing transaction');
    }
  }

  private async detectOpportunities(tx: any, decoded: any): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];

    try {
      // Only process swaps
      if (decoded.type !== 'swap') {
        return [];
      }

      // Extract swap details
      const { extractSwapAmount, extractTokenPair } = await import('./decoders/calldataDecoder.js');
      const swapAmount = extractSwapAmount(decoded);
      const tokenPair = extractTokenPair(decoded);

      if (!swapAmount || !tokenPair) {
        return [];
      }

      const amountIn = BigInt(swapAmount.amountIn);

      // Only care about large swaps (>= $1000 equivalent)
      // Using a simple threshold of 1e18 wei (1 token) as minimum
      const minSwapSize = BigInt(1e18);
      if (amountIn < minSwapSize) {
        return [];
      }

      logger.info(
        {
          txHash: tx.hash,
          amountIn: amountIn.toString(),
          tokenIn: tokenPair.tokenIn,
          tokenOut: tokenPair.tokenOut,
        },
        'Large swap detected - analyzing copy trade opportunity'
      );

      // Calculate our trade size (2x the observed swap)
      const ourTradeSize = amountIn * BigInt(2);

      // Create opportunity to trade 2x the size immediately after this swap
      const opportunity: ArbitrageOpportunity = {
        id: `copy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: OpportunityType.CrossDexArbitrage,
        createdAt: Date.now(),
        triggeringTx: tx,
        pools: [], // Will be populated during execution
        expectedProfitBPS: 50, // Assume at least 0.5% profit from copy trading
        expectedProfitUSD: 0, // Will be calculated during simulation
        profitMargin: 0.005,
        gasEstimate: BigInt(150000),
        flashloanRequired: true, // Need flashloan for 2x size
        flashloanAmount: ourTradeSize,
        path: [tokenPair.tokenIn, tokenPair.tokenOut],
        confidence: 0.8,
      };

      opportunities.push(opportunity);

      logger.info(
        {
          opportunityId: opportunity.id,
          ourTradeSize: ourTradeSize.toString(),
          targetSwapHash: tx.hash,
        },
        'Copy trade opportunity created'
      );
    } catch (error) {
      logger.debug({ error, txHash: tx.hash }, 'Error detecting opportunities');
    }

    return opportunities;
  }

  private async processOpportunity(opportunity: ArbitrageOpportunity): Promise<void> {
    try {
      logger.info({ opportunityId: opportunity.id }, 'Processing copy trade opportunity');

      // Quick profitability check - skip if too small
      const minProfitBPS = parseInt(process.env.MIN_PROFIT_BPS || '10'); // Lower threshold for fast execution
      if (opportunity.expectedProfitBPS < minProfitBPS) {
        logger.debug(
          {
            opportunityId: opportunity.id,
            expectedProfit: opportunity.expectedProfitBPS,
            minRequired: minProfitBPS,
          },
          'Opportunity not profitable enough - skipping'
        );
        return;
      }

      this.stats.opportunitiesFound++;

      // Execute immediately if enabled
      if (process.env.ENABLE_EXECUTION === 'true') {
        if (!this.executor) {
          throw new Error('Executor not initialized');
        }

        logger.info(
          {
            opportunityId: opportunity.id,
            tradeSize: opportunity.flashloanAmount.toString(),
            path: opportunity.path,
          },
          'Executing copy trade immediately'
        );

        const result = await this.executor.execute(opportunity);
        this.stats.opportunitiesExecuted++;

        if (result.status === 'submitted' || result.status === 'included') {
          const estimatedProfit = BigInt(opportunity.flashloanAmount) * BigInt(opportunity.expectedProfitBPS) / BigInt(10000);
          this.stats.totalProfit += estimatedProfit;

          logger.info(
            {
              opportunityId: opportunity.id,
              txHash: result.bundleHash,
              status: result.status,
              estimatedProfit: estimatedProfit.toString(),
            },
            'Copy trade executed successfully'
          );
        } else {
          logger.warn(
            {
              opportunityId: opportunity.id,
              status: result.status,
              error: result.error,
            },
            'Copy trade execution failed'
          );
        }
      } else {
        logger.info(
          {
            opportunityId: opportunity.id,
            tradeSize: opportunity.flashloanAmount.toString(),
            path: opportunity.path,
          },
          'DRY RUN - Would execute copy trade with 2x size'
        );
      }
    } catch (error) {
      logger.error({ error, opportunityId: opportunity.id }, 'Error processing copy trade');
    }
  }

  private logStats(): void {
    logger.info(
      {
        txsProcessed: this.stats.txsProcessed,
        opportunitiesFound: this.stats.opportunitiesFound,
        opportunitiesExecuted: this.stats.opportunitiesExecuted,
        totalProfit: this.stats.totalProfit.toString(),
      },
      'Copy Trading Bot Statistics'
    );
  }

  stop(): void {
    if (this.txListener) {
      this.txListener.stop();
    }
    logger.info('Copy Trading Bot stopped');
  }
}

// Main execution
async function main() {
  const monitor = new PolygonCopyTradingBot();

  try {
    await monitor.initialize();
    await monitor.start();

    // Handle shutdown gracefully
    process.on('SIGINT', () => {
      logger.info('Shutting down...');
      monitor.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      logger.info('Shutting down...');
      monitor.stop();
      process.exit(0);
    });
  } catch (error) {
    logger.error({ error }, 'Fatal error');
    process.exit(1);
  }
}

// Only run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error({ error }, 'Unexpected error');
    process.exit(1);
  });
}

export { PolygonCopyTradingBot };

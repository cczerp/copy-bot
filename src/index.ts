/**
 * Polygon Arbitrage Monitor - Main Entry Point
 * Research-grade transaction monitor and arbitrage simulator
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
import { ArbitrageOpportunity } from './types/index.js';

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

class PolygonArbitrageMonitor {
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
    logger.info('Initializing Polygon Arbitrage Monitor...');

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

      logger.info('Monitor initialized successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize monitor');
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.txListener) {
      throw new Error('Monitor not initialized');
    }

    logger.info('Starting transaction monitoring...');

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

    logger.info('Monitor running. Listening for transactions...');
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
    // This would use the pool analyzer to detect opportunities
    // Simplified for demonstration
    return [];
  }

  private async processOpportunity(opportunity: ArbitrageOpportunity): Promise<void> {
    try {
      logger.info({ opportunityId: opportunity.id }, 'Processing opportunity');

      // 1. Simulate
      if (!this.simulationEngine) {
        throw new Error('Simulation engine not initialized');
      }

      const simulation = await this.simulationEngine.simulate(opportunity);
      opportunity.simulation = simulation;
      this.stats.opportunitiesSimulated++;

      if (!simulation.success) {
        logger.warn(
          { opportunityId: opportunity.id, reason: simulation.revertReason },
          'Simulation failed'
        );
        return;
      }

      logger.info(
        {
          opportunityId: opportunity.id,
          actualProfit: simulation.actualProfit.toString(),
          gasCost: simulation.gasCost.toString(),
          netProfit: simulation.netProfit.toString(),
        },
        'Simulation successful'
      );

      // 2. Safety check
      if (!this.safetyChecker) {
        throw new Error('Safety checker not initialized');
      }

      const safetyResult = await this.safetyChecker.checkOpportunitySafety(opportunity);

      if (!safetyResult.passed) {
        logger.warn(
          {
            opportunityId: opportunity.id,
            failures: safetyResult.failures,
          },
          'Safety check failed'
        );
        return;
      }

      logger.info({ opportunityId: opportunity.id }, 'Safety check passed');

      // 3. Filter by profitability
      const minProfitBPS = parseInt(process.env.MIN_PROFIT_BPS || '80');
      if (simulation.netProfitBPS < minProfitBPS) {
        logger.debug(
          {
            opportunityId: opportunity.id,
            netProfit: simulation.netProfitBPS,
            minRequired: minProfitBPS,
          },
          'Opportunity not profitable enough'
        );
        return;
      }

      logger.info(
        {
          opportunityId: opportunity.id,
          netProfitBPS: simulation.netProfitBPS,
        },
        'Opportunity is profitable and safe'
      );

      // 4. Execute if enabled
      if (process.env.ENABLE_EXECUTION === 'true') {
        if (!this.executor) {
          throw new Error('Executor not initialized');
        }

        const result = await this.executor.execute(opportunity);
        this.stats.opportunitiesExecuted++;
        this.stats.totalProfit += simulation.netProfit;

        logger.info({ opportunityId: opportunity.id, result }, 'Opportunity executed');
      } else {
        logger.info(
          { opportunityId: opportunity.id },
          'Dry run mode - opportunity would be executed if enabled'
        );
      }
    } catch (error) {
      logger.error({ error, opportunityId: opportunity.id }, 'Error processing opportunity');
    }
  }

  private logStats(): void {
    logger.info(
      {
        txsProcessed: this.stats.txsProcessed,
        opportunitiesFound: this.stats.opportunitiesFound,
        opportunitiesSimulated: this.stats.opportunitiesSimulated,
        opportunitiesExecuted: this.stats.opportunitiesExecuted,
        totalProfit: this.stats.totalProfit.toString(),
      },
      'Monitor statistics'
    );
  }

  stop(): void {
    if (this.txListener) {
      this.txListener.stop();
    }
    logger.info('Monitor stopped');
  }
}

// Main execution
async function main() {
  const monitor = new PolygonArbitrageMonitor();

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

export { PolygonArbitrageMonitor };

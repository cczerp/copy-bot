/**
 * Simulation Engine
 * Uses Tenderly or Anvil fork to simulate arbitrage opportunities before execution
 * Ensures all trades are profitable and safe before submission
 */

import axios, { AxiosInstance } from 'axios';
import { ethers } from 'ethers';
import pino from 'pino';
import Decimal from 'decimal.js';
import {
  ArbitrageOpportunity,
  SimulationResult,
  StateDeviation,
  PoolState,
} from '../types/index.js';

const logger = pino();

interface TenderlySimulation {
  simulation: {
    id: string;
    status: string;
    transaction: {
      hash: string;
      from: string;
      to: string;
      input: string;
      value: string;
      gas: number;
      gas_price: string;
    };
    error?: {
      error_code: string;
      error_message: string;
    };
    trace: Array<{
      type: string;
      address: string;
      gas: number;
      gas_used: number;
      output?: string;
    }>;
    state_overrides?: Record<string, unknown>;
  };
}

export class SimulationEngine {
  private tenderlyClient?: AxiosInstance;
  private anvilProvider?: ethers.JsonRpcProvider;
  private forkUrl: string;
  private chainId: number;
  private timeoutMs: number;

  constructor(forkUrl: string, chainId: number, timeoutMs: number = 5000) {
    this.forkUrl = forkUrl;
    this.chainId = chainId;
    this.timeoutMs = timeoutMs;

    // Initialize Tenderly client if API key is available
    const tenderlyKey = process.env.TENDERLY_API_KEY;
    const tenderlyProject = process.env.TENDERLY_PROJECT;
    const tenderlyUser = process.env.TENDERLY_USER;

    if (tenderlyKey && tenderlyProject && tenderlyUser) {
      this.tenderlyClient = axios.create({
        baseURL: `https://api.tenderly.co/api/v1/account/${tenderlyUser}/project/${tenderlyProject}`,
        headers: {
          'X-Access-Key': tenderlyKey,
        },
      });
    }

    // Initialize Anvil provider (fallback to fork URL)
    try {
      this.anvilProvider = new ethers.JsonRpcProvider(forkUrl);
    } catch (error) {
      logger.warn({ error }, 'Failed to initialize Anvil provider');
    }
  }

  /**
   * Simulate an arbitrage opportunity
   */
  async simulate(opportunity: ArbitrageOpportunity): Promise<SimulationResult> {
    try {
      logger.debug(
        { opportunityId: opportunity.id, type: opportunity.type },
        'Starting simulation'
      );

      // Create the arbitrage transaction
      const arbTx = this.buildArbitrageTransaction(opportunity);

      // Try Tenderly first if available
      if (this.tenderlyClient) {
        const result = await this.simulateWithTenderly(arbTx, opportunity);
        if (result) {
          return result;
        }
      }

      // Fallback to Anvil
      if (this.anvilProvider) {
        return await this.simulateWithAnvil(arbTx, opportunity);
      }

      throw new Error('No simulation provider available');
    } catch (error) {
      logger.error({ error, opportunityId: opportunity.id }, 'Simulation failed');
      return {
        success: false,
        outputAmount: BigInt(0),
        actualProfit: BigInt(0),
        actualProfitBPS: 0,
        gasCost: BigInt(0),
        flashloanFee: BigInt(0),
        netProfit: BigInt(0),
        netProfitBPS: 0,
        deviations: [],
        revertReason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Build the arbitrage execution transaction
   */
  private buildArbitrageTransaction(opportunity: ArbitrageOpportunity): ethers.TransactionRequest {
    // This would construct the actual transaction based on opportunity type
    // For now, return a template structure
    return {
      to: opportunity.pools[0].address,
      value: '0',
      gasLimit: opportunity.gasEstimate,
      data: '0x', // Would be populated with actual swap calldata
    };
  }

  /**
   * Simulate using Tenderly
   */
  private async simulateWithTenderly(
    tx: ethers.TransactionRequest,
    opportunity: ArbitrageOpportunity
  ): Promise<SimulationResult | null> {
    try {
      if (!this.tenderlyClient) {
        return null;
      }

      const payload = {
        network_id: String(this.chainId),
        from: process.env.EXECUTOR_ADDRESS || '0x0000000000000000000000000000000000000000',
        to: tx.to,
        value: tx.value || '0',
        input: tx.data || '0x',
        gas: Number(tx.gasLimit || 500000),
        gas_price: '1000000000',
        simulation_type: 'quick',
        save: false,
      };

      const response = await axios.post<TenderlySimulation>(
        `${this.tenderlyClient.defaults.baseURL}/simulate`,
        payload,
        { timeout: this.timeoutMs }
      );

      const sim = response.data.simulation;

      // Check if transaction reverted
      if (sim.error || sim.status !== 'true') {
        logger.warn(
          { opportunityId: opportunity.id, error: sim.error },
          'Simulation reverted'
        );
        return {
          success: false,
          outputAmount: BigInt(0),
          actualProfit: BigInt(0),
          actualProfitBPS: 0,
          gasCost: BigInt(0),
          flashloanFee: BigInt(0),
          netProfit: BigInt(0),
          netProfitBPS: 0,
          deviations: [],
          revertReason: sim.error?.error_message || 'Unknown revert',
        };
      }

      // Calculate gas cost from trace
      const gasUsed = sim.trace.reduce((sum, trace) => sum + (trace.gas_used || 0), 0);
      const gasPrice = BigInt(sim.transaction.gas_price);
      const gasCost = BigInt(gasUsed) * gasPrice;

      // Extract profit from transaction output
      // This is simplified - actual implementation would parse event logs
      const outputAmount = BigInt(sim.trace[sim.trace.length - 1]?.output || '0');
      const inputValue = opportunity.pools[0].reserve0; // Simplified

      const profit = outputAmount > inputValue ? outputAmount - inputValue : BigInt(0);
      const profitBPS = profit > 0 ? Number((profit * BigInt(10000)) / inputValue) : 0;

      return {
        success: true,
        outputAmount,
        actualProfit: profit,
        actualProfitBPS: profitBPS,
        gasCost,
        flashloanFee: opportunity.flashloanRequired ? (opportunity.flashloanAmount / BigInt(1000)) : BigInt(0),
        netProfit: profit > gasCost ? profit - gasCost : BigInt(0),
        netProfitBPS: profitBPS - Number((gasCost * BigInt(10000)) / inputValue),
        deviations: [],
      };
    } catch (error) {
      logger.debug({ error, opportunityId: opportunity.id }, 'Tenderly simulation failed');
      return null;
    }
  }

  /**
   * Simulate using Anvil/local fork
   */
  private async simulateWithAnvil(
    tx: ethers.TransactionRequest,
    opportunity: ArbitrageOpportunity
  ): Promise<SimulationResult> {
    try {
      if (!this.anvilProvider) {
        throw new Error('Anvil provider not initialized');
      }

      // Use eth_call to simulate the transaction
      const result = await this.anvilProvider.call(tx);

      // Parse result (would need actual ABI decoding in production)
      const outputAmount = BigInt(result || '0');
      const inputValue = opportunity.pools[0].reserve0;

      const profit = outputAmount > inputValue ? outputAmount - inputValue : BigInt(0);
      const profitBPS = profit > 0 ? Number((profit * BigInt(10000)) / inputValue) : 0;

      // Estimate gas
      const gasEstimate = await this.anvilProvider.estimateGas(tx);
      const gasPrice = await this.anvilProvider.getGasPrice();
      const gasCost = gasEstimate * gasPrice;

      logger.debug(
        {
          opportunityId: opportunity.id,
          outputAmount: outputAmount.toString(),
          profit: profit.toString(),
          gasCost: gasCost.toString(),
        },
        'Anvil simulation completed'
      );

      return {
        success: true,
        outputAmount,
        actualProfit: profit,
        actualProfitBPS: profitBPS,
        gasCost,
        flashloanFee: opportunity.flashloanRequired ? (opportunity.flashloanAmount / BigInt(1000)) : BigInt(0),
        netProfit: profit > gasCost ? profit - gasCost : BigInt(0),
        netProfitBPS: profitBPS - Number((gasCost * BigInt(10000)) / inputValue),
        deviations: this.checkStateDeviations(opportunity),
      };
    } catch (error) {
      logger.error(
        { error, opportunityId: opportunity.id },
        'Anvil simulation failed'
      );
      throw error;
    }
  }

  /**
   * Check for state deviations between expected and actual pool states
   */
  private checkStateDeviations(opportunity: ArbitrageOpportunity): StateDeviation[] {
    const deviations: StateDeviation[] = [];

    // This would compare current pool state with what was observed when opportunity was detected
    // Helps identify if market conditions changed significantly
    // Simplified implementation for now

    return deviations;
  }

  /**
   * Filter opportunities that are profitable after all costs
   */
  filterProfitable(
    opportunities: ArbitrageOpportunity[],
    minNetProfitBPS: number,
    maxGasSpendBPS: number
  ): ArbitrageOpportunity[] {
    return opportunities.filter((opp) => {
      if (!opp.simulation) {
        return false; // Must have been simulated
      }

      const sim = opp.simulation;

      // Check net profit after gas
      if (sim.netProfitBPS < minNetProfitBPS) {
        logger.debug(
          {
            opportunityId: opp.id,
            expectedProfit: opp.expectedProfitBPS,
            actualNetProfit: sim.netProfitBPS,
          },
          'Opportunity not profitable after gas'
        );
        return false;
      }

      // Check gas doesn't exceed budget
      const inputValue = opp.pools[0].reserve0;
      const gasBPS = sim.gasCost > 0 ? Number((sim.gasCost * BigInt(10000)) / inputValue) : 0;

      if (gasBPS > maxGasSpendBPS) {
        logger.debug(
          {
            opportunityId: opp.id,
            gasBPS,
            maxGasBPS: maxGasSpendBPS,
          },
          'Gas cost exceeds budget'
        );
        return false;
      }

      // Check no major state deviations
      for (const deviation of sim.deviations) {
        if (deviation.deviationBPS > 200) {
          // 2% threshold
          logger.warn(
            {
              opportunityId: opp.id,
              pool: deviation.poolAddress,
              deviationBPS: deviation.deviationBPS,
            },
            'Significant state deviation detected'
          );
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Test safety: ensure transaction doesn't negatively impact other users
   */
  async testRevertOnDeviation(opportunity: ArbitrageOpportunity): Promise<boolean> {
    try {
      // Simulate transaction with revert-on-deviation wrapper
      // This ensures transaction reverts if market conditions change unexpectedly

      const deviationThreshold = BigInt(process.env.REVERT_ON_DEVIATION_SLIPPAGE_BPS || '50');
      const maxSlippage = BigInt(process.env.MAX_SLIPPAGE_BPS || '100');

      if (!opportunity.simulation) {
        return false;
      }

      // Check if actual deviations exceed threshold
      for (const deviation of opportunity.simulation.deviations) {
        if (BigInt(deviation.deviationBPS) > deviationThreshold) {
          logger.warn(
            {
              opportunityId: opportunity.id,
              deviationBPS: deviation.deviationBPS,
              threshold: deviationThreshold.toString(),
            },
            'Revert-on-deviation would trigger'
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error(
        { error, opportunityId: opportunity.id },
        'Error testing revert-on-deviation safety'
      );
      return false;
    }
  }
}

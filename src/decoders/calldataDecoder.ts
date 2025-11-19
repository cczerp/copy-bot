/**
 * Calldata Decoder
 * Decodes transaction calldata to identify DeFi operations
 * Uses ABI analysis and function signature matching
 */

import pino from 'pino';
import Decimal from 'decimal.js';

const logger = pino();

export interface DecodedCall {
  to: string;
  function: string;
  args: Record<string, unknown>;
  type: 'swap' | 'liquidity' | 'flash_loan' | 'governance' | 'unknown';
}

// Known function signatures (selector: function signature)
const FUNCTION_SIGNATURES: Record<string, { name: string; type: string }> = {
  // Uniswap V2/Algebra swap functions
  '0x38ed1739': { name: 'swapExactTokensForTokens', type: 'swap' },
  '0x8803dbee': { name: 'swapTokensForExactTokens', type: 'swap' },
  '0x1f00ca16': { name: 'exactInputSingle', type: 'swap' },
  '0x414bf389': { name: 'exactOutputSingle', type: 'swap' },
  '0xc04b8d59': { name: 'swap', type: 'swap' }, // Balancer
  '0x00878796': { name: 'swap', type: 'swap' }, // Curve
  // Liquidity functions
  '0xe8e33700': { name: 'addLiquidity', type: 'liquidity' },
  '0x5b0d5984': { name: 'addLiquidityETH', type: 'liquidity' },
  '0x83800a8e': { name: 'addLiquidityOneToken', type: 'liquidity' },
  '0x2e1a7d4d': { name: 'withdraw', type: 'liquidity' },
  '0x5b8c41e6': { name: 'mint', type: 'liquidity' }, // Uniswap V3 mint position
  '0x0c49ccbe': { name: 'decreaseLiquidity', type: 'liquidity' }, // Uniswap V3
  // Flash loan functions
  '0xab9c4b5d': { name: 'flashLoan', type: 'flash_loan' },
  '0x23e30c8b': { name: 'flashLoan', type: 'flash_loan' },
  '0xd14d7cc1': { name: 'flashLoan', type: 'flash_loan' }, // Balancer
};

/**
 * Extract function selector from calldata
 */
export function getFunctionSelector(data: string): string {
  if (data.length < 10) {
    return '';
  }
  return data.slice(0, 10);
}

/**
 * Decode calldata parameters based on function signature
 */
export function decodeCalldata(to: string, data: string): DecodedCall | null {
  try {
    const selector = getFunctionSelector(data);
    const signature = FUNCTION_SIGNATURES[selector];

    if (!signature) {
      return {
        to,
        function: 'unknown',
        args: {},
        type: 'unknown',
      };
    }

    const decodedArgs = decodeParameters(selector, data);

    return {
      to,
      function: signature.name,
      args: decodedArgs,
      type: signature.type as 'swap' | 'liquidity' | 'flash_loan' | 'governance' | 'unknown',
    };
  } catch (error) {
    logger.debug({ error, to, data }, 'Failed to decode calldata');
    return null;
  }
}

/**
 * Decode function parameters based on known ABI signatures
 */
function decodeParameters(selector: string, data: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  try {
    // Remove function selector (first 10 characters including 0x)
    const params = data.slice(10);

    switch (selector) {
      case '0x38ed1739': // swapExactTokensForTokens
        args.amountIn = `0x${params.slice(0, 64)}`;
        args.amountOutMin = `0x${params.slice(64, 128)}`;
        args.path_offset = `0x${params.slice(128, 192)}`;
        args.to = `0x${params.slice(192 + 24, 192 + 64)}`;
        args.deadline = `0x${params.slice(192 + 64, 192 + 128)}`;
        break;

      case '0x1f00ca16': // exactInputSingle (Uniswap V3)
        args.tokenIn = `0x${params.slice(24, 64)}`;
        args.tokenOut = `0x${params.slice(88, 128)}`;
        args.fee = `0x${params.slice(128, 192)}`;
        args.recipient = `0x${params.slice(216, 256)}`;
        args.deadline = `0x${params.slice(256, 320)}`;
        args.amountIn = `0x${params.slice(320, 384)}`;
        args.amountOutMinimum = `0x${params.slice(384, 448)}`;
        break;

      case '0xc04b8d59': // Balancer swap
        args.poolId = `0x${params.slice(0, 64)}`;
        args.tokenIn = `0x${params.slice(64 + 24, 128 + 24)}`;
        args.tokenOut = `0x${params.slice(128 + 24, 192 + 24)}`;
        args.amount = `0x${params.slice(192, 256)}`;
        break;

      case '0x5b0d5984': // addLiquidityETH
        args.token = `0x${params.slice(24, 64)}`;
        args.amountTokenDesired = `0x${params.slice(64, 128)}`;
        args.amountTokenMin = `0x${params.slice(128, 192)}`;
        args.amountETHMin = `0x${params.slice(192, 256)}`;
        args.to = `0x${params.slice(256 + 24, 320 + 24)}`;
        args.deadline = `0x${params.slice(320, 384)}`;
        break;

      case '0xab9c4b5d': // Aave flashLoan
      case '0x23e30c8b': // Different Aave version
        args.receiver = `0x${params.slice(24, 64)}`;
        args.token = `0x${params.slice(64 + 24, 128 + 24)}`;
        args.amount = `0x${params.slice(128, 192)}`;
        break;

      case '0xd14d7cc1': // Balancer flashLoan
        args.receiver = `0x${params.slice(24, 64)}`;
        args.tokens_offset = `0x${params.slice(64, 128)}`;
        args.amounts_offset = `0x${params.slice(128, 192)}`;
        break;

      default:
        // Generic parameter extraction
        for (let i = 0; i < Math.min(params.length / 64, 10); i++) {
          args[`param${i}`] = `0x${params.slice(i * 64, (i + 1) * 64)}`;
        }
    }
  } catch (error) {
    logger.debug({ error, selector }, 'Error decoding parameters');
  }

  return args;
}

/**
 * Parse token pair from swap transaction
 */
export function extractTokenPair(
  decoded: DecodedCall
): { tokenIn: string; tokenOut: string } | null {
  try {
    let tokenIn = '';
    let tokenOut = '';

    // Extract based on function type
    if (decoded.type === 'swap') {
      // Try to extract from common parameter names
      if (decoded.args.tokenIn) {
        tokenIn = decoded.args.tokenIn as string;
      }
      if (decoded.args.tokenOut) {
        tokenOut = decoded.args.tokenOut as string;
      }
      if (decoded.args.token) {
        tokenIn = decoded.args.token as string;
      }

      // If tokenOut not found, look at path array
      if (!tokenOut && decoded.args.path) {
        const path = decoded.args.path as string[];
        if (path.length >= 2) {
          tokenIn = path[0];
          tokenOut = path[path.length - 1];
        }
      }

      if (tokenIn && tokenOut) {
        return {
          tokenIn: tokenIn.toLowerCase(),
          tokenOut: tokenOut.toLowerCase(),
        };
      }
    }
  } catch (error) {
    logger.debug({ error, decoded }, 'Error extracting token pair');
  }

  return null;
}

/**
 * Extract swap amount from decoded calldata
 */
export function extractSwapAmount(
  decoded: DecodedCall
): { amountIn: string; minAmountOut: string } | null {
  try {
    if (decoded.type !== 'swap') {
      return null;
    }

    let amountIn = '';
    let minAmountOut = '';

    if (decoded.args.amountIn) {
      amountIn = decoded.args.amountIn as string;
    }
    if (decoded.args.amount) {
      amountIn = decoded.args.amount as string;
    }

    if (decoded.args.amountOutMinimum) {
      minAmountOut = decoded.args.amountOutMinimum as string;
    }
    if (decoded.args.amountOutMin) {
      minAmountOut = decoded.args.amountOutMin as string;
    }

    if (amountIn) {
      return {
        amountIn,
        minAmountOut: minAmountOut || '0',
      };
    }
  } catch (error) {
    logger.debug({ error, decoded }, 'Error extracting swap amount');
  }

  return null;
}

/**
 * Estimate gas impact of a transaction
 */
export function estimateGasImpact(
  data: string,
  gasLimit: string
): { callDataBytes: number; estimatedCost: Decimal } {
  try {
    // Count non-zero bytes in calldata (4 gas each) and zero bytes (16 gas each)
    const callDataBytes = (data.length - 2) / 2;
    let gasCost = 0;

    for (let i = 2; i < data.length; i += 2) {
      const byte = data.slice(i, i + 2);
      if (byte === '00') {
        gasCost += 4;
      } else {
        gasCost += 16;
      }
    }

    return {
      callDataBytes,
      estimatedCost: new Decimal(gasCost),
    };
  } catch (error) {
    logger.debug({ error }, 'Error estimating gas impact');
    return {
      callDataBytes: 0,
      estimatedCost: new Decimal(0),
    };
  }
}

/**
 * Check if transaction is likely a sandwich/MEV attempt
 * (For monitoring purposes only - helps identify potential market impact)
 */
export function flagPotentialMEV(
  decoded: DecodedCall,
  calldataSize: number
): boolean {
  // Flag suspicious patterns:
  // 1. Very high slippage tolerance
  // 2. Complex multi-hop swaps in single transaction
  // 3. Nested flash loans with callbacks
  // 4. Unusual parameter combinations

  if (decoded.type === 'swap') {
    // Check for extreme slippage (potential sandwich indicator)
    if (decoded.args.amountOutMin === '0' || decoded.args.amountOutMin === '0x0') {
      return true; // No slippage protection
    }
  }

  // Flag if calldata is unusually large (complex contract interaction)
  if (calldataSize > 10000) {
    return true;
  }

  return false;
}

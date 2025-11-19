/**
 * Transaction Listener Module
 * Connects to private transaction streams (bloXroute, Eden, Manifold)
 * All monitoring is read-only and observational
 */

import WebSocket from 'ws';
import pino from 'pino';
import { PendingTx } from '../types/index.js';
import { EventEmitter } from 'events';

const logger = pino();

export class TransactionListener extends EventEmitter {
  private ws?: WebSocket;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // ms
  private source: 'bloxroute' | 'eden' | 'manifold';
  private apiKey?: string;

  constructor(source: 'bloxroute' | 'eden' | 'manifold', apiKey?: string) {
    super();
    this.source = source;
    this.apiKey = apiKey;
  }

  async start(): Promise<void> {
    const url = this.getStreamUrl();
    logger.info({ source: this.source, url }, 'Connecting to transaction stream');

    try {
      this.ws = new WebSocket(url, {
        headers: this.getHeaders(),
      });

      this.ws.on('open', () => {
        logger.info({ source: this.source }, 'Connected to transaction stream');
        this.reconnectAttempts = 0;

        // Send subscription message based on source
        this.subscribe();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error) => {
        logger.error({ error, source: this.source }, 'WebSocket error');
      });

      this.ws.on('close', () => {
        logger.warn({ source: this.source }, 'Disconnected from transaction stream');
        this.attemptReconnect();
      });
    } catch (error) {
      logger.error({ error, source: this.source }, 'Failed to start listener');
      this.attemptReconnect();
    }
  }

  private getStreamUrl(): string {
    switch (this.source) {
      case 'bloxroute':
        return process.env.BLOXROUTE_STREAM_URL || 'wss://eth-mainnet.txpool.bloXroute.com/';
      case 'eden':
        return process.env.EDEN_ENDPOINT || 'https://api.edennetwork.io/transactions';
      case 'manifold':
        return process.env.MANIFOLD_STREAM_URL || 'wss://api.manifold.finance';
      default:
        throw new Error(`Unknown transaction source: ${this.source}`);
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Polygon-Arbitrage-Monitor/1.0',
    };

    if (this.source === 'bloxroute' && this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    if (this.source === 'eden' && this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const subscriptionMsg = this.getSubscriptionMessage();
    this.ws.send(JSON.stringify(subscriptionMsg));
    logger.debug({ source: this.source }, 'Subscribed to transaction stream');
  }

  private getSubscriptionMessage(): Record<string, unknown> {
    switch (this.source) {
      case 'bloxroute':
        return {
          jsonrpc: '2.0',
          method: 'subscribe',
          params: ['newTxs', { include: ['callData', 'from', 'nonce', 'gasPrice', 'gas'] }],
          id: 1,
        };
      case 'manifold':
        return {
          action: 'subscribe',
          filter: {
            chainId: 137, // Polygon
            callData: true,
          },
        };
      case 'eden':
        return {
          method: 'subscribe',
          params: {
            to: 'all', // Monitor all transactions
            includeCalldata: true,
          },
        };
      default:
        return {};
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      // Parse transaction based on source
      const tx = this.parseTx(message);
      if (tx) {
        this.emit('tx', tx);
      }
    } catch (error) {
      logger.debug({ error }, 'Failed to parse transaction message');
    }
  }

  private parseTx(message: Record<string, unknown>): PendingTx | null {
    try {
      if (this.source === 'bloxroute') {
        return this.parseBloxrouteTx(message);
      } else if (this.source === 'eden') {
        return this.parseEdenTx(message);
      } else if (this.source === 'manifold') {
        return this.parseManifoldTx(message);
      }
    } catch (error) {
      logger.debug({ error, message }, 'Error parsing transaction');
    }

    return null;
  }

  private parseBloxrouteTx(msg: Record<string, unknown>): PendingTx | null {
    const params = msg.params as Record<string, unknown> | undefined;
    if (!params || !('result' in params)) {
      return null;
    }

    const result = params.result as Record<string, string>;
    if (!result.hash || !result.from || !result.data) {
      return null;
    }

    return {
      hash: result.hash,
      from: result.from,
      to: result.to,
      value: result.value || '0',
      data: result.data,
      gasPrice: result.gasPrice || '0',
      gasLimit: result.gas || '0',
      nonce: parseInt(result.nonce || '0', 16),
      timestamp: Date.now(),
      source: 'bloxroute',
    };
  }

  private parseEdenTx(msg: Record<string, unknown>): PendingTx | null {
    const hash = msg.hash as string | undefined;
    const from = msg.from as string | undefined;
    const data = msg.data as string | undefined;

    if (!hash || !from || !data) {
      return null;
    }

    return {
      hash,
      from,
      to: msg.to as string | undefined,
      value: (msg.value as string) || '0',
      data,
      gasPrice: (msg.gasPrice as string) || '0',
      gasLimit: (msg.gas as string) || '0',
      nonce: (msg.nonce as number) || 0,
      timestamp: Date.now(),
      source: 'eden',
    };
  }

  private parseManifoldTx(msg: Record<string, unknown>): PendingTx | null {
    const tx = msg.transaction as Record<string, string> | undefined;
    if (!tx || !tx.hash || !tx.from || !tx.data) {
      return null;
    }

    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value || '0',
      data: tx.data,
      gasPrice: tx.gasPrice || '0',
      gasLimit: tx.gas || '0',
      nonce: parseInt(tx.nonce || '0', 16),
      timestamp: Date.now(),
      source: 'manifold',
    };
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error({ source: this.source }, 'Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    logger.info({ delay, attempt: this.reconnectAttempts }, 'Attempting to reconnect');

    setTimeout(() => {
      this.start();
    }, delay);
  }

  stop(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }
}

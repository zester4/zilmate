import { tool } from 'ai';
import { z } from 'zod';
import yahooFinance from 'yahoo-finance2';
import { emitProgress } from '../runtime/progress.js';
import { requestConfirmation } from '../runtime/confirm.js';
import { workspaceLayout } from '../workspace/paths.js';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export interface LedgerBudget {
  id: string;
  agentName: string;
  requestedAmount: number;
  approvedAmount: number;
  spent: number;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: string;
}

export interface LedgerCard {
  id: string;
  agentName: string;
  cardNumber: string;
  expiry: string;
  cvv: string;
  limit: number;
  spent: number;
  merchantRestriction: string;
  status: 'active' | 'suspended' | 'cancelled';
  timestamp: string;
}

export interface TreasuryLedger {
  treasury: {
    totalCap: number;
    allocated: number;
    available: number;
  };
  budgets: LedgerBudget[];
  virtualCards: LedgerCard[];
}

const DEFAULT_LEDGER: TreasuryLedger = {
  treasury: {
    totalCap: 50000,
    allocated: 0,
    available: 50000
  },
  budgets: [],
  virtualCards: []
};

function getLedgerPath(): string {
  const layout = workspaceLayout();
  const dir = layout.config;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'treasury-ledger.json');
}

function readLedger(): TreasuryLedger {
  const filePath = getLedgerPath();
  if (!existsSync(filePath)) {
    return DEFAULT_LEDGER;
  }
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return DEFAULT_LEDGER;
  }
}

function writeLedger(ledger: TreasuryLedger) {
  const filePath = getLedgerPath();
  writeFileSync(filePath, JSON.stringify(ledger, null, 2), 'utf8');
}

export const financeTools = {
  getTickerQuote: tool({
    description: 'Get live stock/crypto ticker quotes, price, change, and market cap using Yahoo Finance.',
    inputSchema: z.object({
      symbol: z.string().describe('Ticker symbol, e.g. AAPL, BTC-USD, TSLA.'),
    }),
    execute: async ({ symbol }) => {
      emitProgress({ type: 'tool:start', label: 'Fetching ticker quote', detail: symbol });
      try {
        const quote = await yahooFinance.quote(symbol);
        emitProgress({ type: 'tool:end', label: 'Ticker quote retrieved' });
        return quote as any;
      } catch (error) {
        emitProgress({ type: 'tool:error', label: 'Ticker quote failed', detail: String(error) });
        throw error;
      }
    },
  }),

  getHistoricalData: tool({
    description: 'Get historical price data for a ticker over a period (daily, weekly, monthly).',
    inputSchema: z.object({
      symbol: z.string().describe('Ticker symbol.'),
      period1: z.string().describe('Start date (YYYY-MM-DD).'),
      period2: z.string().optional().describe('End date (YYYY-MM-DD), default is today.'),
      interval: z.enum(['1d', '1wk', '1mo']).optional().default('1d'),
    }),
    execute: async ({ symbol, period1, period2, interval }) => {
      emitProgress({ type: 'tool:start', label: 'Fetching historical data', detail: symbol });
      try {
        const history = await yahooFinance.historical(symbol, {
          period1,
          period2: period2 || new Date().toISOString().split('T')[0],
          interval: interval as any,
        });
        emitProgress({ type: 'tool:end', label: 'Historical data retrieved' });
        return history as any;
      } catch (error) {
        emitProgress({ type: 'tool:error', label: 'Historical data failed', detail: String(error) });
        throw error;
      }
    },
  }),

  searchCompany: tool({
    description: 'Search for ticker symbols and company information on Yahoo Finance.',
    inputSchema: z.object({
      query: z.string().describe('Company name or search term.'),
    }),
    execute: async ({ query }) => {
      emitProgress({ type: 'tool:start', label: 'Searching company', detail: query });
      try {
        const result = await yahooFinance.search(query);
        emitProgress({ type: 'tool:end', label: 'Company search complete' });
        return result as any;
      } catch (error) {
        emitProgress({ type: 'tool:error', label: 'Company search failed', detail: String(error) });
        throw error;
      }
    },
  }),

  getTickerSummary: tool({
    description: 'Get a comprehensive summary of a ticker including fundamentals, asset profile, and price history.',
    inputSchema: z.object({
      symbol: z.string().describe('Ticker symbol.'),
    }),
    execute: async ({ symbol }) => {
      emitProgress({ type: 'tool:start', label: 'Fetching ticker summary', detail: symbol });
      try {
        const summary = await yahooFinance.quoteSummary(symbol, {
          modules: ['price', 'summaryDetail', 'assetProfile', 'financialData'],
        });
        emitProgress({ type: 'tool:end', label: 'Ticker summary retrieved' });
        return summary as any;
      } catch (error) {
        emitProgress({ type: 'tool:error', label: 'Ticker summary failed', detail: String(error) });
        throw error;
      }
    },
  }),

  getTreasuryBalance: tool({
    description: 'Retrieve the current virtual treasury state, including budget allocations, total capacity, remaining available funds, and issued virtual cards.',
    inputSchema: z.object({}),
    execute: async () => {
      emitProgress({ type: 'tool:start', label: 'Retrieving treasury balance' });
      try {
        const ledger = readLedger();
        emitProgress({ type: 'tool:end', label: 'Treasury balance retrieved' });
        return ledger;
      } catch (error) {
        emitProgress({ type: 'tool:error', label: 'Treasury balance retrieval failed', detail: String(error) });
        throw error;
      }
    }
  }),

  requestAgentBudget: tool({
    description: 'Request a budget token allocation for an agent with a purpose. Auto-approves if under total capacity limits.',
    inputSchema: z.object({
      agentName: z.string().describe('The name of the agent requesting the budget (e.g. "appBuilder", "qaEngineer").'),
      amount: z.number().positive().describe('The requested budget amount in virtual tokens/credits.'),
      description: z.string().describe('Detailed description of why the budget is needed.'),
    }),
    execute: async ({ agentName, amount, description }) => {
      emitProgress({ type: 'tool:start', label: 'Processing budget request', detail: `${agentName}: ${amount}` });
      try {
        const ledger = readLedger();
        
        // Auto-approve if total allocated + requested amount <= totalCap
        const canApprove = ledger.treasury.allocated + amount <= ledger.treasury.totalCap;
        const status = canApprove ? 'approved' : 'pending';
        const approvedAmount = canApprove ? amount : 0;

        const budgetId = `bud_${Math.random().toString(36).substring(2, 9)}`;
        const newBudget: LedgerBudget = {
          id: budgetId,
          agentName,
          requestedAmount: amount,
          approvedAmount,
          spent: 0,
          description,
          status,
          timestamp: new Date().toISOString()
        };

        ledger.budgets.push(newBudget);
        if (canApprove) {
          ledger.treasury.allocated += amount;
          ledger.treasury.available -= amount;
        }

        writeLedger(ledger);
        
        emitProgress({ 
          type: 'tool:end', 
          label: canApprove ? 'Budget auto-approved' : 'Budget pending review',
          detail: `ID: ${budgetId}` 
        });
        
        return {
          success: true,
          budgetId,
          status,
          approvedAmount,
          remainingCapacity: ledger.treasury.available
        };
      } catch (error) {
        emitProgress({ type: 'tool:error', label: 'Budget request failed', detail: String(error) });
        throw error;
      }
    }
  }),

  issueVirtualCard: tool({
    description: 'Issue a temporary restricted sandboxed virtual card. HIGH SECURITY: requires developer confirmation approval.',
    inputSchema: z.object({
      agentName: z.string().describe('The name of the agent receiving the card.'),
      limit: z.number().positive().describe('The maximum spending limit on this virtual card.'),
      merchantRestriction: z.string().describe('The merchant or platform restriction (e.g. "Vercel / OpenAI / AWS").'),
    }),
    execute: async ({ agentName, limit, merchantRestriction }) => {
      // 1. Request developer confirmation to safeguard virtual card issuance
      const approved = await requestConfirmation({
        toolkitSlug: 'ZILMATE',
        toolSlug: 'FINANCE',
        action: 'Issue virtual card',
        access: 'Write',
        targetTools: ['ZILMATE_FINANCE'],
        details: [
          `Agent: ${agentName}`,
          `Limit: $${limit}`,
          `Restriction: ${merchantRestriction}`
        ],
        summary: `Issue virtual card of $${limit} for ${agentName} restricted to ${merchantRestriction}`,
      });

      if (!approved) {
        throw new Error('Blocked virtual card issuance. Ask the user to approve this card creation.');
      }

      emitProgress({ type: 'tool:start', label: 'Issuing virtual card', detail: `${agentName}: $${limit}` });
      try {
        const ledger = readLedger();

        // Check if there is enough approved budget for this agent to cover the limit
        const agentApprovedBudget = ledger.budgets
          .filter(b => b.agentName === agentName && b.status === 'approved')
          .reduce((sum, b) => sum + b.approvedAmount - b.spent, 0);

        if (agentApprovedBudget < limit) {
          throw new Error(`Insufficient approved budget for agent "${agentName}". Approved balance remaining: $${agentApprovedBudget}. Please request additional budget first.`);
        }

        // Generate card credentials
        const cardId = `card_${Math.random().toString(36).substring(2, 9)}`;
        // Generate a mock 16-digit card number
        const cardNumber = `4111${Math.floor(100000000000 + Math.random() * 900000000000)}`;
        // Expiry date (e.g. 5 years from now)
        const expiry = '12/31';
        // CVV (3 digits)
        const cvv = String(Math.floor(100 + Math.random() * 900));

        const newCard: LedgerCard = {
          id: cardId,
          agentName,
          cardNumber,
          expiry,
          cvv,
          limit,
          spent: 0,
          merchantRestriction,
          status: 'active',
          timestamp: new Date().toISOString()
        };

        ledger.virtualCards.push(newCard);
        
        // Deduct from the agent's approved budget (mark as spent/committed)
        let remainingToDeduct = limit;
        for (const budget of ledger.budgets) {
          if (budget.agentName === agentName && budget.status === 'approved') {
            const availableInBudget = budget.approvedAmount - budget.spent;
            if (availableInBudget > 0) {
              const deduct = Math.min(remainingToDeduct, availableInBudget);
              budget.spent += deduct;
              remainingToDeduct -= deduct;
              if (remainingToDeduct <= 0) break;
            }
          }
        }

        writeLedger(ledger);

        emitProgress({ type: 'tool:end', label: 'Virtual card issued successfully', detail: `ID: ${cardId}` });
        
        return {
          success: true,
          cardId,
          cardNumber,
          expiry,
          cvv,
          limit,
          merchantRestriction,
          status: 'active'
        };
      } catch (error) {
        emitProgress({ type: 'tool:error', label: 'Virtual card issuance failed', detail: String(error) });
        throw error;
      }
    }
  }),
};

export interface ActiveTrade {
  id: string;
  symbol: string;
  quantity: number;
  direction: "BUY" | "SELL";
  entryPrice: number;
  stopPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  mifidDecisionMaker: string;
  mifidExecutionTrader: string;
  timestamp: string;
  
  // Tactical fields
  initialQuantity?: number;
  initialStop?: number;
  targetPrice?: number;
  barsHeld?: number;
  tranche1ScaledOut?: boolean;
  breakevenApplied?: boolean;
  scaleOutProfit?: number;
  efficiencyRatio?: number;
}

export interface HistoricalLog {
  id: string;
  symbol: string;
  quantity: number;
  direction: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  realizedPnL: number;
  commission: number;
  efficiencyRatio: number;
  timestamp: string;
}

export interface SystemSettings {
  ibkrAccountNumber: string;
  ibkrPort: number;
  ibkrClientId: number;
  mifid2DecisionMaker: string;
  mifid2ExecutionTrader: string;
  referenceEquity: number;
  netLiquidation: number;
  maintenanceMargin: number;
  routerLocked: boolean;
  marketTime: string;
  marketPhase: "CALIBRATION" | "EXECUTION" | "FLUSH" | "SYNC" | "POST-MARKET";
  virtualCapitalCeiling: number;
  dailyCapitalCeiling: number;
  dailyMaxLossCutoff: number;
  fractionalTradingEnabled: boolean;
  intradayFlatteningEnabled: boolean;
  intradayFlattenTimeEST: string;
  intradayFlattenTimeCET: string;
  killSwitchEngaged: boolean;
  tradingMode: "PAPER" | "LIVE";
  marketScope: "ALL" | "US" | "EUROPE";
  gatewayConnectionActive: boolean;
  dailyDrawdownLimitPercent: number;
  dailyDrawdownLimitCash: number;
  stopAtrMultiplier: number;
  partialProfit: boolean;
  breakevenLock: boolean;
  maxHoldBars: number;
  ofiFilter: boolean;
  adaptiveStop: boolean;
  geminiApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  nvidiaApiKey: string;
  customAiApiKey: string;
  customAiBaseUrl: string;
  customAiModelName: string;
  selectedAiProvider: "gemini-flash" | "gemini-pro" | "openai-4o" | "openai-4o-mini" | "anthropic-sonnet" | "anthropic-haiku" | "nvidia-llama-405" | "nvidia-llama-70" | "nvidia-nemotron" | "custom" | "auto";
  openFdaApiKey: string;
  fredApiKey: string;
  patentsApiKey: string;
  secUserAgent: string;
}

export interface DepthItem {
  price: number;
  size: number;
  impliedOfi: number;
}

export interface Level2Book {
  symbol: string;
  bids: DepthItem[];
  asks: DepthItem[];
  lastOfi: number;
  lastPrice: number;
  primaryExchange: string;
}

export interface ExecutionRecord {
  id: string;
  timestamp: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  orderType: string;
  status: "FILLED" | "PENDING" | "CANCELLED" | "REJECTED";
  arrivalPrice: number;
  fillPrice: number;
  slippageBps: number;
  commission: number;
  currency: string;
}

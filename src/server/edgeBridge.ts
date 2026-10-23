import net from "net";

/**
 * AlphaEngine Direct TCP Socket Bridge (Control Plane Client)
 * Replaces deprecated Firestore polling tunnel with direct TCP socket communication
 * between Google Cloud Run (port 3000) and the Frankfurt GCE Edge Node.
 */

export interface EdgeCommandPayload {
  action: "PING" | "SUBMIT_ORDER" | "EMERGENCY_FLUSH" | "UPDATE_SETTINGS" | "GET_TELEMETRY" | "DISPATCH_IBKR" | "GET_QUOTE" | "GET_HISTORICAL_BARS" | "GET_FUNDAMENTALS" | "TRIGGER_GATEWAY_LOGIN";
  token?: string;
  timestamp?: number;
  method?: string;
  args?: Record<string, any>;
  symbol?: string;
  [key: string]: any;
}

export class EdgeBridgeClient {
  private host: string;
  private port: number;
  private authToken: string;

  constructor() {
    this.host = process.env.EDGE_NODE_HOST || process.env.EDGE_NODE_IP || "127.0.0.1";
    this.port = Number(process.env.EDGE_TCP_PORT) || 4005;
    this.authToken = process.env.EDGE_AUTH_TOKEN || "ALPHA_EDGE_SECRET_2026";
  }

  public getHost(): string {
    return process.env.EDGE_NODE_HOST || process.env.EDGE_NODE_IP || this.host;
  }

  public getPort(): number {
    return Number(process.env.EDGE_TCP_PORT) || this.port;
  }

  /**
   * Sends a single newline-delimited JSON command over a raw TCP socket and awaits the JSON response.
   */
  public async sendCommand(payload: EdgeCommandPayload, timeoutMs: number = 3000): Promise<any> {
    const targetHost = this.getHost();
    const targetPort = this.getPort();

    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let responseData = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(new Error(`Edge TCP Bridge timeout after ${timeoutMs}ms connecting to ${targetHost}:${targetPort}`));
        }
      }, timeoutMs);

      socket.connect(targetPort, targetHost, () => {
        const fullPayload = {
          ...payload,
          token: this.authToken,
          timestamp: Date.now() / 1000,
        };
        socket.write(JSON.stringify(fullPayload) + "\n");
      });

      socket.on("data", (chunk) => {
        responseData += chunk.toString("utf-8");
        if (responseData.includes("\n")) {
          const lines = responseData.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0) {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                socket.end();
                try {
                  const parsed = JSON.parse(trimmed);
                  resolve(parsed);
                } catch (parseErr) {
                  reject(new Error(`Edge TCP Bridge received invalid JSON: ${trimmed}`));
                }
              }
              break;
            }
          }
        }
      });

      socket.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          reject(err);
        }
      });

      socket.on("close", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("Edge TCP Bridge connection closed prematurely"));
        }
      });
    });
  }

  /**
   * Measures true round-trip TCP latency in milliseconds.
   */
  public async measureLatency(): Promise<number> {
    const t0 = performance.now();
    try {
      await this.sendCommand({ action: "PING" }, 1500);
      const t1 = performance.now();
      return Math.round((t1 - t0) * 10) / 10;
    } catch (e) {
      // In local dev without edge daemon, return fallback or 0
      return 0.0;
    }
  }

  /**
   * Submits a live or paper order directly to the Frankfurt edge execution daemon.
   */
  public async submitOrder(order: {
    symbol: string;
    direction: "BUY" | "SELL";
    entryPrice: number;
    stopPrice: number;
    quantity: number;
  }): Promise<any> {
    return this.sendCommand({
      action: "SUBMIT_ORDER",
      order,
    });
  }

  /**
   * Triggers an emergency portfolio liquidation directly on the Frankfurt edge node.
   */
  public async triggerEmergencyFlush(): Promise<any> {
    return this.sendCommand({
      action: "EMERGENCY_FLUSH",
    });
  }

  /**
   * Synchronizes updated risk parameters and trading mode (PAPER/LIVE) to edge daemon.
   */
  public async syncSettings(settings: any): Promise<any> {
    return this.sendCommand({
      action: "UPDATE_SETTINGS",
      settings,
    });
  }

  /**
   * Dispatches any official IBKR inquiry or command directly to the edge daemon.
   */
  public async dispatchIbkr(method: string, args: Record<string, any> = {}, timeoutMs: number = 4000): Promise<any> {
    return this.sendCommand({
      action: "DISPATCH_IBKR",
      method,
      args
    }, timeoutMs);
  }

  /**
   * Queries official closing price, NBBO, and 5-day candlestick history from IBKR.
   */
  public async getMarketQuote(symbol: string, timeoutMs: number = 4000): Promise<any> {
    return this.sendCommand({
      action: "GET_QUOTE",
      symbol,
    }, timeoutMs);
  }

  /**
   * Dispatches an on-demand IPC trigger to the Frankfurt edge node gateway autologin daemon.
   */
  public async triggerGatewayLogin(timeoutMs: number = 3000): Promise<any> {
    return this.sendCommand({
      action: "TRIGGER_GATEWAY_LOGIN",
    }, timeoutMs);
  }
}

export const edgeBridge = new EdgeBridgeClient();

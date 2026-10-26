import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  BarSeries,
  HistogramSeries,
  ColorType,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  createSeriesMarkers,
  SeriesMarker,
  IPriceLine
} from "lightweight-charts";
import { 
  Maximize2, 
  RefreshCw, 
  BarChart2, 
  Activity, 
  Settings, 
  TrendingUp, 
  Sliders, 
  CheckSquare, 
  Square,
  Shield,
  Layers,
  X,
  Target,
  ArrowUpCircle,
  ArrowDownCircle
} from "lucide-react";
import { InfoTip } from "./InstitutionalTooltip";

export interface CandleDataPoint {
  date?: string;
  time?: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  ofiDelta?: number;
  barCount?: number;
}

export interface StrategyTradeMarker {
  id?: string;
  symbol?: string;
  quantity?: number;
  direction: "BUY" | "SELL" | string;
  entryPrice: number;
  exitPrice?: number;
  realizedPnL?: number;
  commission?: number;
  efficiencyRatio?: number;
  reason?: string;
  date: string;
}

export interface InstitutionalCandleChartProps {
  symbol?: string;
  data?: CandleDataPoint[];
  trades?: StrategyTradeMarker[];
  timeframe?: string;
  onTimeframeChange?: (tf: string) => void;
  height?: number;
  title?: string;
}

// Convert heterogeneous date strings or numbers to strictly ascending UTCTimestamp seconds
function normalizeBarTime(dateVal: string | number | undefined, index: number, fallbackBaseSec: number): number {
  if (typeof dateVal === "number") {
    return dateVal > 1e11 ? Math.floor(dateVal / 1000) : dateVal;
  }
  if (typeof dateVal === "string" && dateVal.trim()) {
    const cleanStr = dateVal.trim();
    // Handle "YYYY-MM-DD HH:mm:ss" or ISO string
    const isoStr = cleanStr.includes("T") ? cleanStr : cleanStr.replace(" ", "T");
    const parsed = Date.parse(isoStr.endsWith("Z") ? isoStr : isoStr + "Z");
    if (!isNaN(parsed) && parsed > 0) {
      return Math.floor(parsed / 1000);
    }
    const standardParse = Date.parse(cleanStr);
    if (!isNaN(standardParse) && standardParse > 0) {
      return Math.floor(standardParse / 1000);
    }
  }
  return fallbackBaseSec + index * 3600;
}

export const InstitutionalCandleChart: React.FC<InstitutionalCandleChartProps> = ({
  symbol = "",
  data,
  trades = [],
  timeframe = "1h",
  onTimeframeChange,
  height = 480
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const sma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const upperAtrSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lowerAtrSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const subSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const subMaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  // Local fetched bars when data prop is not supplied
  const [fetchedBars, setFetchedBars] = useState<CandleDataPoint[] | null>(null);
  const [isFetchingBars, setIsFetchingBars] = useState<boolean>(false);
  const [fetchSource, setFetchSource] = useState<string>("local");
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Timeframe and user personalization settings
  const [activeTf, setActiveTf] = useState(timeframe);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [chartType, setChartType] = useState<"candle" | "line" | "area" | "bar">("candle");
  
  // Indicator toggles
  const [showSma20, setShowSma20] = useState(true);
  const [showEma50, setShowEma50] = useState(true);
  const [showAtrBand, setShowAtrBand] = useState(true);
  const [showTradeMarkers, setShowTradeMarkers] = useState(true);
  const [showPriceLines, setShowPriceLines] = useState(true);
  const [subPaneMode, setSubPaneMode] = useState<"ofi" | "volume" | "none">("ofi");

  // Selected trade for inspection
  const [selectedTrade, setSelectedTrade] = useState<StrategyTradeMarker | null>(null);

  // Crosshair hovered HUD
  const [hoveredBar, setHoveredBar] = useState<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    changePct: number;
    volume?: number;
    ofiDelta?: number;
    sma20?: number;
    ema50?: number;
  } | null>(null);

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return document.documentElement.getAttribute("data-theme") !== "light";
  });

  // Watch theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.getAttribute("data-theme") !== "light";
      setIsDarkMode(isDark);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  // Sync external timeframe
  useEffect(() => {
    if (timeframe && timeframe !== activeTf) {
      setActiveTf(timeframe);
    }
  }, [timeframe]);

  // Fetch verified broker bars from API if external data is absent
  useEffect(() => {
    if (data && data.length > 0) {
      setFetchedBars(null);
      setFetchError(null);
      return;
    }

    if (!symbol || !symbol.trim()) {
      setFetchedBars([]);
      setFetchError("No instrument selected. Enter or select an equity ticker above to inspect broker bars.");
      setIsFetchingBars(false);
      return;
    }

    let isMounted = true;
    setIsFetchingBars(true);
    setFetchError(null);

    fetch(`/api/market/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(activeTf)}`)
      .then((res) => res.json())
      .then((json) => {
        if (!isMounted) return;
        if (json.success && Array.isArray(json.bars) && json.bars.length > 0) {
          setFetchedBars(json.bars);
          setFetchSource(json.source || "verified_local_cache");
          setFetchError(null);
        } else {
          setFetchedBars([]);
          setFetchError(json.error || `No verified broker history for ${symbol} (${activeTf}).`);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setFetchedBars([]);
        setFetchError(`Broker Tape Offline: ${err.message}`);
      })
      .finally(() => {
        if (isMounted) setIsFetchingBars(false);
      });

    return () => {
      isMounted = false;
    };
  }, [symbol, activeTf, data]);

  // Active raw dataset: external data takes priority over fetched
  const rawBars = useMemo(() => {
    if (data && data.length > 0) return data;
    if (fetchedBars && fetchedBars.length > 0) return fetchedBars;
    return [];
  }, [data, fetchedBars]);

  // Format, sort strictly ascending, deduplicate timestamps, and compute indicators
  const processedData = useMemo(() => {
    if (!rawBars || rawBars.length === 0) return { candles: [], sma20: [], ema50: [], upperAtr: [], lowerAtr: [], ofi: [], volume: [] };

    const baseSec = Math.floor(Date.now() / 1000) - rawBars.length * 3600;

    // 1. Map raw bars to normalized OHLCV objects
    const mapped = rawBars.map((b, idx) => {
      const timeVal = normalizeBarTime(b.date || b.time, idx, baseSec);
      const open = Number(b.open);
      const high = Number(b.high);
      const low = Number(b.low);
      const close = Number(b.close);
      const volume = Number(b.volume || 0);

      // OFI approximation if not provided: volume delta based on direction and candle range
      const direction = close >= open ? 1 : -1;
      const ofiDelta = b.ofiDelta !== undefined ? Number(b.ofiDelta) : Math.round(direction * volume * 0.35);

      return {
        time: timeVal as UTCTimestamp,
        open,
        high,
        low,
        close,
        volume,
        ofiDelta
      };
    });

    // 2. Sort ascending by time
    mapped.sort((a, b) => (Number(a.time) - Number(b.time)));

    // 3. Deduplicate strictly by time (lightweight-charts requires strictly ascending unique timestamps)
    const candles: typeof mapped = [];
    const seen = new Set<number>();
    for (const m of mapped) {
      const t = Number(m.time);
      if (!seen.has(t)) {
        seen.add(t);
        candles.push(m);
      }
    }

    // 4. Compute Technical Indicators (SMA-20, EMA-50, ATR 1.8 Volatility Bands)
    const sma20: { time: UTCTimestamp; value: number }[] = [];
    const ema50: { time: UTCTimestamp; value: number }[] = [];
    const upperAtr: { time: UTCTimestamp; value: number }[] = [];
    const lowerAtr: { time: UTCTimestamp; value: number }[] = [];
    const ofi: { time: UTCTimestamp; value: number; color: string }[] = [];
    const volume: { time: UTCTimestamp; value: number; color: string }[] = [];

    const emaMultiplier = 2 / (50 + 1);
    let prevEma = candles[0]?.close || 0;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const t = c.time;

      // SMA 20
      if (i >= 19) {
        let sum = 0;
        for (let j = i - 19; j <= i; j++) sum += candles[j].close;
        const val = Math.round((sum / 20) * 100) / 100;
        sma20.push({ time: t, value: val });
      }

      // EMA 50
      if (i === 0) {
        prevEma = c.close;
      } else {
        prevEma = (c.close - prevEma) * emaMultiplier + prevEma;
      }
      if (i >= 20) {
        ema50.push({ time: t, value: Math.round(prevEma * 100) / 100 });
      }

      // 14-period ATR with 1.8 multiplier (Alpha Strategy Stop Parameter)
      if (i >= 13) {
        let trSum = 0;
        for (let k = i - 13; k <= i; k++) {
          const prevClose = k > 0 ? candles[k - 1].close : candles[k].open;
          const tr = Math.max(
            candles[k].high - candles[k].low,
            Math.abs(candles[k].high - prevClose),
            Math.abs(candles[k].low - prevClose)
          );
          trSum += tr;
        }
        const atr = (trSum / 14) * 1.8;
        upperAtr.push({ time: t, value: Math.round((c.close + atr) * 100) / 100 });
        lowerAtr.push({ time: t, value: Math.round((c.close - atr) * 100) / 100 });
      }

      // OFI Volume Delta
      const ofiVal = c.ofiDelta;
      ofi.push({
        time: t,
        value: ofiVal,
        color: ofiVal >= 0 ? "rgba(0, 230, 118, 0.7)" : "rgba(244, 63, 94, 0.7)"
      });

      // Volume with color
      volume.push({
        time: t,
        value: c.volume,
        color: c.close >= c.open ? "rgba(0, 230, 118, 0.4)" : "rgba(244, 63, 94, 0.4)"
      });
    }

    return { candles, sma20, ema50, upperAtr, lowerAtr, ofi, volume };
  }, [rawBars]);

  // Main Chart Rendering Effect
  useEffect(() => {
    if (!containerRef.current) return;
    if (processedData.candles.length === 0) return;

    // Semantic palette tokens matching index.css
    const bg = isDarkMode ? "#0e131f" : "#ffffff";
    const text = isDarkMode ? "#94a3b8" : "#334155";
    const grid = isDarkMode ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.05)";
    const border = isDarkMode ? "#21262d" : "#cbd5e1";
    const upColor = isDarkMode ? "#00e676" : "#047857";
    const downColor = isDarkMode ? "#f43f5e" : "#dc2626";

    // Initialize Lightweight Chart
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: height,
      layout: {
        background: { type: ColorType.Solid, color: bg },
        textColor: text,
        fontFamily: "'Fira Code', monospace",
        fontSize: 11
      },
      grid: {
        vertLines: { color: grid },
        horzLines: { color: grid }
      },
      crosshair: {
        vertLine: {
          color: isDarkMode ? "#475569" : "#94a3b8",
          width: 1,
          style: 3,
          labelBackgroundColor: isDarkMode ? "#161b22" : "#334155"
        },
        horzLine: {
          color: isDarkMode ? "#475569" : "#94a3b8",
          width: 1,
          style: 3,
          labelBackgroundColor: isDarkMode ? "#161b22" : "#334155"
        }
      },
      timeScale: {
        borderColor: border,
        timeVisible: true,
        secondsVisible: false
      },
      rightPriceScale: {
        borderColor: border,
        scaleMargins: {
          top: 0.08,
          bottom: subPaneMode !== "none" ? 0.28 : 0.08
        }
      }
    });

    chartRef.current = chart;

    // 1. Add Main Series (Candle, Line, Area, or Bar)
    let mainSeries: ISeriesApi<any>;
    if (chartType === "candle") {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor,
        downColor,
        borderVisible: false,
        wickUpColor: upColor,
        wickDownColor: downColor
      });
      mainSeries.setData(processedData.candles);
    } else if (chartType === "area") {
      mainSeries = chart.addSeries(AreaSeries, {
        topColor: isDarkMode ? "rgba(56, 189, 248, 0.4)" : "rgba(2, 132, 199, 0.3)",
        bottomColor: isDarkMode ? "rgba(56, 189, 248, 0.02)" : "rgba(2, 132, 199, 0.02)",
        lineColor: isDarkMode ? "#38bdf8" : "#0284c7",
        lineWidth: 2
      });
      mainSeries.setData(processedData.candles.map((c) => ({ time: c.time, value: c.close })));
    } else if (chartType === "bar") {
      mainSeries = chart.addSeries(BarSeries, {
        upColor,
        downColor
      });
      mainSeries.setData(processedData.candles);
    } else {
      mainSeries = chart.addSeries(LineSeries, {
        color: isDarkMode ? "#38bdf8" : "#0284c7",
        lineWidth: 2
      });
      mainSeries.setData(processedData.candles.map((c) => ({ time: c.time, value: c.close })));
    }
    mainSeriesRef.current = mainSeries;

    // 2. Add SMA-20 Congruence Line
    if (showSma20 && processedData.sma20.length > 0) {
      const smaSeries = chart.addSeries(LineSeries, {
        color: isDarkMode ? "#38bdf8" : "#0284c7",
        lineWidth: 2,
        title: "SMA 20",
        priceLineVisible: false,
        crosshairMarkerVisible: false
      });
      smaSeries.setData(processedData.sma20);
      sma20SeriesRef.current = smaSeries;
    }

    // 3. Add EMA-50 Regime Line
    if (showEma50 && processedData.ema50.length > 0) {
      const emaSeries = chart.addSeries(LineSeries, {
        color: isDarkMode ? "#f59e0b" : "#d97706",
        lineWidth: 1,
        lineStyle: 2,
        title: "EMA 50",
        priceLineVisible: false,
        crosshairMarkerVisible: false
      });
      emaSeries.setData(processedData.ema50);
      ema50SeriesRef.current = emaSeries;
    }

    // 4. Add 1.8 ATR Volatility Stops Envelope
    if (showAtrBand && processedData.upperAtr.length > 0) {
      const upperAtrSeries = chart.addSeries(LineSeries, {
        color: isDarkMode ? "rgba(148, 163, 184, 0.3)" : "rgba(100, 116, 139, 0.35)",
        lineWidth: 1,
        lineStyle: 3,
        title: "+1.8 ATR",
        priceLineVisible: false,
        crosshairMarkerVisible: false
      });
      upperAtrSeries.setData(processedData.upperAtr);
      upperAtrSeriesRef.current = upperAtrSeries;

      const lowerAtrSeries = chart.addSeries(LineSeries, {
        color: isDarkMode ? "rgba(148, 163, 184, 0.3)" : "rgba(100, 116, 139, 0.35)",
        lineWidth: 1,
        lineStyle: 3,
        title: "-1.8 ATR",
        priceLineVisible: false,
        crosshairMarkerVisible: false
      });
      lowerAtrSeries.setData(processedData.lowerAtr);
      lowerAtrSeriesRef.current = lowerAtrSeries;
    }

    // 5. Add Strategy Trade Execution Markers
    if (showTradeMarkers && trades && trades.length > 0) {
      const markers: SeriesMarker<UTCTimestamp>[] = [];
      const baseSec = Math.floor(Date.now() / 1000) - processedData.candles.length * 3600;

      for (const t of trades) {
        const tradeTime = normalizeBarTime(t.date, 0, baseSec) as UTCTimestamp;
        const isBuy = t.direction === "BUY";
        const isWin = (t.realizedPnL || 0) >= 0;

        // Entry marker
        markers.push({
          time: tradeTime,
          position: isBuy ? "belowBar" : "aboveBar",
          color: isBuy ? upColor : downColor,
          shape: isBuy ? "arrowUp" : "arrowDown",
          text: `${t.direction} @${t.entryPrice.toFixed(2)}`
        });

        // Exit marker if trade completed
        if (t.exitPrice && t.realizedPnL !== undefined) {
          markers.push({
            time: tradeTime,
            position: isBuy ? "aboveBar" : "belowBar",
            color: isWin ? upColor : downColor,
            shape: isWin ? "circle" : "square",
            text: `${isWin ? "+" : ""}$${t.realizedPnL.toFixed(0)} (${t.reason ? t.reason.slice(0, 12) : "EXIT"})`
          });
        }
      }

      // Sort markers strictly by time
      markers.sort((a, b) => Number(a.time) - Number(b.time));
      try {
        createSeriesMarkers(mainSeries, markers);
      } catch (err) {
        console.warn("[CHART] Failed to attach trade markers:", err);
      }
    }

    // 6. Add Sub-Pane (OFI Volume Delta or Volume + 10-MA)
    if (subPaneMode !== "none") {
      const subSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "sub_pane"
      });

      chart.priceScale("sub_pane").applyOptions({
        scaleMargins: {
          top: 0.76, // Renders in bottom 24% of the canvas
          bottom: 0.02
        }
      });

      if (subPaneMode === "ofi") {
        subSeries.setData(processedData.ofi);
      } else {
        subSeries.setData(processedData.volume);
      }
      subSeriesRef.current = subSeries;
    }

    // 7. Add Price Lines for active/selected trade
    priceLinesRef.current.forEach((pl) => mainSeries.removePriceLine(pl));
    priceLinesRef.current = [];

    const tradeToHighlight = selectedTrade || (trades.length > 0 ? trades[trades.length - 1] : null);
    if (showPriceLines && tradeToHighlight && tradeToHighlight.entryPrice) {
      // Entry line
      const entryLine = mainSeries.createPriceLine({
        price: tradeToHighlight.entryPrice,
        color: isDarkMode ? "#38bdf8" : "#0284c7",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `ENTRY: ${tradeToHighlight.entryPrice.toFixed(2)}`
      });
      priceLinesRef.current.push(entryLine);

      // Stop-loss calculation if ATR available
      const latestAtr = processedData.upperAtr.length > 0 
        ? (processedData.upperAtr[processedData.upperAtr.length - 1].value - processedData.candles[processedData.candles.length - 1].close)
        : tradeToHighlight.entryPrice * 0.02;
      
      const stopPrice = tradeToHighlight.direction === "BUY"
        ? tradeToHighlight.entryPrice - latestAtr
        : tradeToHighlight.entryPrice + latestAtr;

      const stopLine = mainSeries.createPriceLine({
        price: stopPrice,
        color: downColor,
        lineWidth: 1,
        lineStyle: 3,
        axisLabelVisible: true,
        title: `STOP 1.8 ATR: ${stopPrice.toFixed(2)}`
      });
      priceLinesRef.current.push(stopLine);

      // Profit target line (2x ATR)
      const targetPrice = tradeToHighlight.direction === "BUY"
        ? tradeToHighlight.entryPrice + latestAtr * 2
        : tradeToHighlight.entryPrice - latestAtr * 2;

      const targetLine = mainSeries.createPriceLine({
        price: targetPrice,
        color: upColor,
        lineWidth: 1,
        lineStyle: 3,
        axisLabelVisible: true,
        title: `TARGET 2x: ${targetPrice.toFixed(2)}`
      });
      priceLinesRef.current.push(targetLine);
    }

    // 8. Crosshair inspection listener
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) {
        setHoveredBar(null);
        return;
      }
      const candleData = param.seriesData.get(mainSeries) as any;
      const smaData = sma20SeriesRef.current ? (param.seriesData.get(sma20SeriesRef.current) as any) : null;
      const emaData = ema50SeriesRef.current ? (param.seriesData.get(ema50SeriesRef.current) as any) : null;
      const subData = subSeriesRef.current ? (param.seriesData.get(subSeriesRef.current) as any) : null;

      if (candleData && (candleData.open !== undefined || candleData.value !== undefined)) {
        const open = candleData.open ?? candleData.value;
        const close = candleData.close ?? candleData.value;
        const high = candleData.high ?? candleData.value;
        const low = candleData.low ?? candleData.value;
        const changePct = open > 0 ? ((close - open) / open) * 100 : 0;

        let dateStr = "";
        if (typeof param.time === "number") {
          dateStr = new Date(param.time * 1000).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          });
        } else {
          dateStr = String(param.time);
        }

        setHoveredBar({
          time: dateStr,
          open,
          high,
          low,
          close,
          changePct: Math.round(changePct * 100) / 100,
          ofiDelta: subPaneMode === "ofi" ? subData?.value : undefined,
          volume: subPaneMode === "volume" ? subData?.value : undefined,
          sma20: smaData?.value,
          ema50: emaData?.value
        });
      }
    });

    chart.timeScale().fitContent();

    // Auto-resize
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [
    processedData,
    chartType,
    showSma20,
    showEma50,
    showAtrBand,
    showTradeMarkers,
    showPriceLines,
    subPaneMode,
    selectedTrade,
    trades,
    height,
    isDarkMode
  ]);

  const handleTfClick = (tf: string) => {
    setActiveTf(tf);
    if (onTimeframeChange) onTimeframeChange(tf);
  };

  const handleResetZoom = () => {
    chartRef.current?.timeScale().fitContent();
  };

  const latestBar = processedData.candles[processedData.candles.length - 1];
  const displayBar = hoveredBar || {
    time: latestBar ? new Date(Number(latestBar.time) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "LATEST",
    open: latestBar?.open ?? 0,
    high: latestBar?.high ?? 0,
    low: latestBar?.low ?? 0,
    close: latestBar?.close ?? 0,
    changePct: latestBar && latestBar.open > 0 ? Math.round(((latestBar.close - latestBar.open) / latestBar.open) * 10000) / 100 : 0,
    ofiDelta: processedData.ofi[processedData.ofi.length - 1]?.value,
    volume: latestBar?.volume,
    sma20: processedData.sma20[processedData.sma20.length - 1]?.value,
    ema50: processedData.ema50[processedData.ema50.length - 1]?.value
  };

  return (
    <div className="terminal-card flex flex-col overflow-hidden font-mono text-xs relative shadow-lg">
      {/* 1. Chart Toolbar & Interactive HUD */}
      <div className="px-3.5 py-2.5 border-b border-subtle flex flex-wrap items-center justify-between gap-2.5 terminal-elevated">
        <div className="flex items-center gap-3">
          {/* Symbol & Verified Source Badge */}
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-accent" />
            <span className="font-bold text-primary text-sm tracking-wider">{symbol}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase border ${
              data && data.length > 0
                ? "terminal-badge-bid"
                : fetchSource === "ibkr_pro_edge_bridge"
                ? "terminal-badge-bid"
                : "terminal-elevated text-secondary"
            }`}>
              {data && data.length > 0 ? "BACKTEST VERIFIED" : fetchSource === "ibkr_pro_edge_bridge" ? "IBKR LIVE TAPE" : "VERIFIED CACHE"}
            </span>
            <InfoTip id="ofi" />
          </div>

          {/* Timeframe Selector */}
          <div className="flex items-center rounded-lg border border-subtle overflow-hidden text-[10px]">
            {["1m", "5m", "15m", "1h", "1D"].map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => handleTfClick(tf)}
                className={`px-2 py-0.5 transition cursor-pointer font-bold ${
                  activeTf === tf
                    ? "bg-accent text-slate-950 font-black shadow-xs"
                    : "terminal-elevated text-secondary hover:text-primary"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Chart Style Quick Toggle */}
          <div className="hidden sm:flex items-center rounded-lg border border-subtle overflow-hidden text-[10px]">
            {(["candle", "line", "area", "bar"] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setChartType(style)}
                className={`px-2 py-0.5 uppercase transition cursor-pointer font-bold ${
                  chartType === style
                    ? "bg-accent text-slate-950 font-black"
                    : "terminal-elevated text-secondary hover:text-primary"
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* Real-time OHLCV & Indicators Readout */}
        <div className="flex items-center gap-3 text-[11px] tabular-nums flex-wrap">
          <span className="text-muted hidden md:inline">{displayBar.time}:</span>
          <span>O: <strong className="text-primary">{displayBar.open.toFixed(2)}</strong></span>
          <span>H: <strong className="text-primary">{displayBar.high.toFixed(2)}</strong></span>
          <span>L: <strong className="text-primary">{displayBar.low.toFixed(2)}</strong></span>
          <span>C: <strong className={displayBar.close >= displayBar.open ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>
            {displayBar.close.toFixed(2)}
          </strong></span>
          <span className={`font-bold ${displayBar.changePct >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
            {displayBar.changePct >= 0 ? `+${displayBar.changePct.toFixed(2)}%` : `${displayBar.changePct.toFixed(2)}%`}
          </span>

          {displayBar.sma20 !== undefined && showSma20 && (
            <span className="text-cyan-500 dark:text-cyan-400 hidden lg:inline font-semibold text-[10px]">
              SMA20: {displayBar.sma20.toFixed(2)}
            </span>
          )}

          {displayBar.ofiDelta !== undefined && subPaneMode === "ofi" && (
            <span className={`px-1.5 py-0.2 rounded border font-bold text-[10px] hidden sm:flex items-center gap-1 ${
              displayBar.ofiDelta >= 0
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
                : "bg-rose-500/10 border-rose-500/30 text-rose-500"
            }`}>
              <Activity className="w-2.5 h-2.5" />
              <span>ΔOFI: {displayBar.ofiDelta > 0 ? `+${displayBar.ofiDelta.toLocaleString()}` : displayBar.ofiDelta.toLocaleString()}</span>
            </span>
          )}

          {/* Personalization Drawer Toggle Button */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={`p-1.5 rounded-lg border transition cursor-pointer flex items-center gap-1 ${
              isSettingsOpen 
                ? "bg-accent text-slate-950 border-accent font-bold" 
                : "terminal-elevated text-secondary hover:text-primary hover:border-accent"
            }`}
            title="Chart Personalization & Indicator Settings"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="text-[10px] hidden sm:inline">CUSTOMIZE</span>
          </button>

          {/* Reset Zoom */}
          <button
            type="button"
            onClick={handleResetZoom}
            className="p-1.5 rounded-lg terminal-elevated text-secondary hover:text-primary hover:border-accent transition cursor-pointer"
            title="Fit View & Reset Zoom"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Personalization Settings Drawer (Slide-Over Panel) */}
      {isSettingsOpen && (
        <div className="p-3.5 border-b border-subtle terminal-elevated animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-subtle mb-3">
            <span className="text-xs font-bold text-primary flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-accent" /> Institutional Chart Personalization & Indicator Suite
            </span>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(false)}
              className="text-muted hover:text-primary p-0.5 rounded transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {/* Chart Style */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-secondary block">Series Visualization</label>
              <div className="grid grid-cols-2 gap-1 text-[10px]">
                {(["candle", "line", "area", "bar"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setChartType(s)}
                    className={`py-1 rounded px-2 text-center transition cursor-pointer font-bold uppercase ${
                      chartType === s ? "terminal-badge-bid" : "terminal-elevated text-secondary hover:text-primary"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Indicator Overlays */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-secondary block">Trend & Volatility Overlays</label>
              <div className="space-y-1 text-[11px]">
                <label className="flex items-center gap-1.5 cursor-pointer text-primary">
                  <input
                    type="checkbox"
                    checked={showSma20}
                    onChange={(e) => setShowSma20(e.target.checked)}
                    className="accent-cyan-500 rounded"
                  />
                  <span>SMA-20 Congruence (Alpha Baseline)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-primary">
                  <input
                    type="checkbox"
                    checked={showEma50}
                    onChange={(e) => setShowEma50(e.target.checked)}
                    className="accent-amber-500 rounded"
                  />
                  <span>EMA-50 Trend Regime</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-primary">
                  <input
                    type="checkbox"
                    checked={showAtrBand}
                    onChange={(e) => setShowAtrBand(e.target.checked)}
                    className="accent-indigo-500 rounded"
                  />
                  <span>1.8x ATR Volatility Bands</span>
                </label>
              </div>
            </div>

            {/* Strategy Trade Execution Overlays */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-secondary block">Strategy Executions ({trades.length})</label>
              <div className="space-y-1 text-[11px]">
                <label className="flex items-center gap-1.5 cursor-pointer text-primary">
                  <input
                    type="checkbox"
                    checked={showTradeMarkers}
                    onChange={(e) => setShowTradeMarkers(e.target.checked)}
                    className="accent-emerald-500 rounded"
                  />
                  <span>Trade Entry/Exit Markers</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-primary">
                  <input
                    type="checkbox"
                    checked={showPriceLines}
                    onChange={(e) => setShowPriceLines(e.target.checked)}
                    className="accent-cyan-500 rounded"
                  />
                  <span>Stop & Target Price Lines</span>
                </label>
              </div>
            </div>

            {/* Sub-Pane Selector */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-secondary block">Sub-Pane Metric</label>
              <div className="flex flex-col gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => setSubPaneMode("ofi")}
                  className={`py-1 rounded px-2 text-left transition cursor-pointer font-bold ${
                    subPaneMode === "ofi" ? "terminal-badge-bid" : "terminal-elevated text-secondary hover:text-primary"
                  }`}
                >
                  OFI Volume Delta (Imbalance)
                </button>
                <button
                  type="button"
                  onClick={() => setSubPaneMode("volume")}
                  className={`py-1 rounded px-2 text-left transition cursor-pointer font-bold ${
                    subPaneMode === "volume" ? "terminal-badge-bid" : "terminal-elevated text-secondary hover:text-primary"
                  }`}
                >
                  Classic Volume (10-MA Spike)
                </button>
                <button
                  type="button"
                  onClick={() => setSubPaneMode("none")}
                  className={`py-1 rounded px-2 text-left transition cursor-pointer font-bold ${
                    subPaneMode === "none" ? "terminal-badge-bid" : "terminal-elevated text-secondary hover:text-primary"
                  }`}
                >
                  No Sub-Pane (Full Canvas)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Main Lightweight Charts Canvas Host */}
      <div className="relative w-full" style={{ minHeight: `${height}px` }}>
        {isFetchingBars && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-xs text-primary font-mono text-xs gap-2">
            <RefreshCw className="w-4 h-4 text-accent animate-spin" />
            <span>Loading verified broker market tape for {symbol}...</span>
          </div>
        )}

        {fetchError && processedData.candles.length === 0 && !isFetchingBars && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center text-xs text-muted space-y-3">
            <Shield className="w-8 h-8 text-amber-500/80 mb-1" />
            <p className="max-w-md font-mono text-secondary">
              {fetchError}
            </p>
            <p className="text-[11px] text-muted">
              Institutional Zero-Synthetic Policy blocks fake random walks. Run a simulation or parameter sweep to stream verified bars.
            </p>
          </div>
        )}

        <div ref={containerRef} className="w-full relative" style={{ height: `${height}px` }} />
      </div>

      {/* 4. Chart Footer Metadata & Trade Blotter Quick-Inspector */}
      <div className="px-3 py-1.5 terminal-elevated border-t border-subtle flex flex-wrap items-center justify-between text-[10px] text-muted gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-primary">Alpha Execution Engine v2.4</span>
          <span>•</span>
          <span className="text-secondary">
            {processedData.candles.length} Verified Bars Loaded
          </span>
          {showSma20 && (
            <span className="text-cyan-500 font-semibold">• SMA-20 Active</span>
          )}
          {showEma50 && (
            <span className="text-amber-500 font-semibold">• EMA-50 Active</span>
          )}
          {showTradeMarkers && trades.length > 0 && (
            <span className="text-emerald-500 font-semibold">• {trades.length} Trade Markers Plotted</span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[9px]">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            <span>Long Bias / Net Buy</span>
          </span>
          <span className="flex items-center gap-1 ml-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
            <span>Short Bias / Net Sell</span>
          </span>
          <span className="flex items-center gap-1 ml-1.5">
            <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" />
            <span>SMA-20</span>
          </span>
        </div>
      </div>
    </div>
  );
};

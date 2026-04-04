"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type Time,
  ColorType,
  LineStyle,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
} from "lightweight-charts";
import { ema, rsi, bollingerBands } from "@/lib/strategy/indicators";

type Interval = "1m" | "5m" | "15m" | "1h" | "4h";

interface CandlestickChartProps {
  symbol: string;
  label: string;
  onClose: () => void;
}

interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const INTERVALS: { value: Interval; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "4h", label: "4h" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySeries = ISeriesApi<any>;

export default function CandlestickChart({ symbol, label, onClose }: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<AnySeries | null>(null);
  const volumeSeriesRef = useRef<AnySeries | null>(null);
  const ema9SeriesRef = useRef<AnySeries | null>(null);
  const ema21SeriesRef = useRef<AnySeries | null>(null);
  const bbUpperRef = useRef<AnySeries | null>(null);
  const bbLowerRef = useRef<AnySeries | null>(null);
  const bbMiddleRef = useRef<AnySeries | null>(null);
  const rsiSeriesRef = useRef<AnySeries | null>(null);

  const [interval, setInterval_] = useState<Interval>("1m");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAndRender = useCallback(async (iv: Interval) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/xtb/klines?symbol=${symbol}&interval=${iv}&limit=500`);
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Chyba nacitani dat");
        setLoading(false);
        return;
      }

      const klines: KlineData[] = data.klines;
      if (!klines || klines.length === 0) {
        setError("Zadna data");
        setLoading(false);
        return;
      }

      // Candlestick data
      const candles: CandlestickData<Time>[] = klines.map((k) => ({
        time: k.time as Time,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
      }));

      // Volume
      const volumes: HistogramData<Time>[] = klines.map((k) => ({
        time: k.time as Time,
        value: k.volume,
        color: k.close >= k.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
      }));

      // Indicators
      const closes = klines.map((k) => k.close);

      const ema9 = ema(closes, 9);
      const ema21 = ema(closes, 21);
      const bb = bollingerBands(closes, 20, 2);
      const rsiValues = rsi(closes, 14);

      // Map indicators to chart data (offset by period)
      const ema9Data: LineData<Time>[] = ema9.map((v, i) => ({
        time: klines[i + 9].time as Time,
        value: v,
      }));
      const ema21Data: LineData<Time>[] = ema21.map((v, i) => ({
        time: klines[i + 21].time as Time,
        value: v,
      }));
      const bbUpperData: LineData<Time>[] = bb.upper.map((v, i) => ({
        time: klines[i + 19].time as Time,
        value: v,
      }));
      const bbMiddleData: LineData<Time>[] = bb.middle.map((v, i) => ({
        time: klines[i + 19].time as Time,
        value: v,
      }));
      const bbLowerData: LineData<Time>[] = bb.lower.map((v, i) => ({
        time: klines[i + 19].time as Time,
        value: v,
      }));
      const rsiData: LineData<Time>[] = rsiValues.map((v, i) => ({
        time: klines[i + 15].time as Time,
        value: v,
      }));

      // Set data
      candleSeriesRef.current?.setData(candles);
      volumeSeriesRef.current?.setData(volumes);
      ema9SeriesRef.current?.setData(ema9Data);
      ema21SeriesRef.current?.setData(ema21Data);
      bbUpperRef.current?.setData(bbUpperData);
      bbMiddleRef.current?.setData(bbMiddleData);
      bbLowerRef.current?.setData(bbLowerData);
      rsiSeriesRef.current?.setData(rsiData);

      // Fit content
      chartRef.current?.timeScale().fitContent();
      rsiChartRef.current?.timeScale().fitContent();
    } catch {
      setError("Nepodarilo se nacist data");
    }

    setLoading(false);
  }, [symbol]);

  // Create charts
  useEffect(() => {
    if (!chartContainerRef.current || !rsiContainerRef.current) return;

    const chartOptions = {
      layout: {
        background: { type: ColorType.Solid, color: "#1a1d29" },
        textColor: "#71717a",
      },
      grid: {
        vertLines: { color: "#2a2d3a" },
        horzLines: { color: "#2a2d3a" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#2a2d3a" },
      timeScale: {
        borderColor: "#2a2d3a",
        timeVisible: true,
        secondsVisible: false,
      },
    };

    // Main chart
    const chart = createChart(chartContainerRef.current, {
      ...chartOptions,
      width: chartContainerRef.current.clientWidth,
      height: 400,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    const ema9Series = chart.addSeries(LineSeries, {
      color: "#3b82f6",
      lineWidth: 1,
      title: "EMA9",
    });
    const ema21Series = chart.addSeries(LineSeries, {
      color: "#f59e0b",
      lineWidth: 1,
      title: "EMA21",
    });
    const bbUpper = chart.addSeries(LineSeries, {
      color: "rgba(139,92,246,0.5)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: "BB Upper",
    });
    const bbMiddle = chart.addSeries(LineSeries, {
      color: "rgba(139,92,246,0.3)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
    });
    const bbLower = chart.addSeries(LineSeries, {
      color: "rgba(139,92,246,0.5)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: "BB Lower",
    });

    // RSI sub-chart
    const rsiChart = createChart(rsiContainerRef.current, {
      ...chartOptions,
      width: rsiContainerRef.current.clientWidth,
      height: 120,
    });

    const rsiSeries = rsiChart.addSeries(LineSeries, {
      color: "#a855f7",
      lineWidth: 2,
      title: "RSI(14)",
    });

    // RSI horizontal lines (30, 70)
    rsiSeries.createPriceLine({ price: 70, color: "rgba(239,68,68,0.4)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" });
    rsiSeries.createPriceLine({ price: 30, color: "rgba(34,197,94,0.4)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" });
    rsiSeries.createPriceLine({ price: 50, color: "rgba(113,113,122,0.3)", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });

    // Sync visible range
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) rsiChart.timeScale().setVisibleLogicalRange(range);
    });
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) chart.timeScale().setVisibleLogicalRange(range);
    });

    // Store refs
    chartRef.current = chart;
    rsiChartRef.current = rsiChart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    ema9SeriesRef.current = ema9Series;
    ema21SeriesRef.current = ema21Series;
    bbUpperRef.current = bbUpper;
    bbMiddleRef.current = bbMiddle;
    bbLowerRef.current = bbLower;
    rsiSeriesRef.current = rsiSeries;

    // Resize handler
    const handleResize = () => {
      if (chartContainerRef.current && rsiContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
        rsiChart.applyOptions({ width: rsiContainerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      rsiChart.remove();
    };
  }, []);

  // Fetch data when interval changes
  useEffect(() => {
    fetchAndRender(interval);
  }, [interval, fetchAndRender]);

  // Auto-refresh every 10s for live data
  useEffect(() => {
    const timer = window.setInterval(() => fetchAndRender(interval), 10000);
    return () => window.clearInterval(timer);
  }, [interval, fetchAndRender]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-[var(--card)] rounded-xl border border-[var(--card-border)] w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--card-border)]">
          <div className="flex items-center gap-4">
            <h2 className="font-bold text-lg">{label} <span className="text-[var(--muted)] font-normal text-sm">{symbol}</span></h2>
            <div className="flex gap-1">
              {INTERVALS.map((iv) => (
                <button
                  key={iv.value}
                  onClick={() => setInterval_(iv.value)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    interval === iv.value
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--background)]"
                  }`}
                >
                  {iv.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors text-xl leading-none px-2"
          >
            &times;
          </button>
        </div>

        {/* Legend */}
        <div className="px-4 py-2 flex items-center gap-4 text-xs border-b border-[var(--card-border)]">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> EMA9</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500 inline-block" /> EMA21</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-purple-500 inline-block opacity-50" style={{ borderTop: "1px dashed" }} /> BB(20,2)</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-purple-500 inline-block" /> RSI(14)</span>
        </div>

        {/* Charts */}
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--card)]/80 z-10">
              <div className="text-[var(--muted)] text-sm">Nacitam data...</div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--card)]/80 z-10">
              <div className="text-red-400 text-sm">{error}</div>
            </div>
          )}
          <div ref={chartContainerRef} />
          <div ref={rsiContainerRef} className="border-t border-[var(--card-border)]" />
        </div>
      </div>
    </div>
  );
}

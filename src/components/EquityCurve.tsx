"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type Time,
  ColorType,
  BaselineSeries,
  LineStyle,
} from "lightweight-charts";

interface EquityCurveProps {
  data: { time: number; equity: number }[];
  initialCapital: number;
}

export default function EquityCurve({ data, initialCapital }: EquityCurveProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 300,
      layout: {
        background: { type: ColorType.Solid, color: "#1a1d29" },
        textColor: "#71717a",
      },
      grid: {
        vertLines: { color: "#2a2d3a" },
        horzLines: { color: "#2a2d3a" },
      },
      rightPriceScale: { borderColor: "#2a2d3a" },
      timeScale: {
        borderColor: "#2a2d3a",
        timeVisible: true,
      },
    });

    // Deduplicate times by taking last value per time
    const timeMap = new Map<number, number>();
    for (const d of data) {
      timeMap.set(d.time, d.equity);
    }
    const uniqueData = Array.from(timeMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([time, equity]) => ({
        time: Math.floor(time / 1000) as Time,
        value: equity,
      }));

    // Baseline
    const baselineSeries = chart.addSeries(BaselineSeries, {
      baseValue: { type: "price", price: initialCapital },
      topLineColor: "#22c55e",
      topFillColor1: "rgba(34,197,94,0.15)",
      topFillColor2: "rgba(34,197,94,0.02)",
      bottomLineColor: "#ef4444",
      bottomFillColor1: "rgba(239,68,68,0.02)",
      bottomFillColor2: "rgba(239,68,68,0.15)",
      lineWidth: 2,
    });

    baselineSeries.setData(uniqueData);

    // Horizontal line at initial capital
    baselineSeries.createPriceLine({
      price: initialCapital,
      color: "rgba(113,113,122,0.5)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "Start",
    });

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [data, initialCapital]);

  return <div ref={containerRef} />;
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { EngineState, BotConfig } from "@/types";
import { DEFAULT_CONFIG } from "@/types";
import { loadConfig, saveConfig } from "@/lib/store";

const DEFAULT_STATE: EngineState = {
  status: "stopped",
  openPositions: [],
  todayTrades: [],
  todayPnL: 0,
  signals: [],
};

export function useEngine() {
  const [state, setState] = useState<EngineState>(DEFAULT_STATE);
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [hydrated, setHydrated] = useState(false);
  const [serverHasCredentials, setServerHasCredentials] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Načti config ze SERVERU (source of truth), ne z localStorage
    fetch("/api/xtb/config")
      .then((res) => res.ok ? res.json() : null)
      .then((serverConfig) => {
        if (serverConfig && serverConfig.instruments) {
          setConfig(serverConfig);
          saveConfig(serverConfig); // sync localStorage se serverem
        } else {
          setConfig(loadConfig()); // fallback na localStorage
        }
        setHydrated(true);
      })
      .catch(() => {
        setConfig(loadConfig());
        setHydrated(true);
      });
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/xtb/state");
      if (res.ok) {
        const data = await res.json();
        setState(data.state);
        if (data.hasServerCredentials !== undefined) {
          setServerHasCredentials(data.hasServerCredentials);
        }
        // Sync config ze serveru (server je source of truth)
        if (data.config) {
          setConfig(data.config);
        }
      }
    } catch { /* ok */ }
  }, []);

  useEffect(() => {
    pollRef.current = setInterval(fetchState, 2000);
    fetchState();

    try {
      const es = new EventSource("/api/xtb/stream");
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          setState(data);
        } catch { /* ok */ }
      };
      es.onerror = () => {};
      eventSourceRef.current = es;
    } catch { /* ok */ }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      eventSourceRef.current?.close();
    };
  }, [fetchState]);

  const start = useCallback(async () => {
    saveConfig(config);
    setState((s) => ({ ...s, status: "connecting", error: undefined }));
    try {
      // Posílej jen credentials — server použije vlastní instrumenty/strategy/risk
      const res = await fetch("/api/xtb/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: config.credentials }),
      });
      const data = await res.json();
      if (!data.ok) {
        setState((s) => ({ ...s, status: "error", error: data.error }));
      }
    } catch (err) {
      setState((s) => ({ ...s, status: "error", error: err instanceof Error ? err.message : "Chyba" }));
    }
  }, [config]);

  const stop = useCallback(async () => {
    await fetch("/api/xtb/stop", { method: "POST" });
    setState((s) => ({ ...s, status: "stopped" }));
  }, []);

  const updateConfig = useCallback((updates: Partial<BotConfig>) => {
    setConfig((prev) => {
      const newConfig = { ...prev, ...updates } as BotConfig;
      saveConfig(newConfig);
      fetch("/api/xtb/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      }).catch(() => {});
      return newConfig;
    });
  }, []);

  const toggleBot = useCallback(() => {
    updateConfig({ active: !config.active });
  }, [config.active, updateConfig]);

  const closePosition = useCallback(async (symbol: string, direction: "BUY" | "SELL") => {
    try {
      await fetch("/api/xtb/close-position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, direction }),
      });
    } catch { /* ok */ }
  }, []);

  const closeAll = useCallback(async () => {
    await fetch("/api/xtb/close-all", { method: "POST" });
  }, []);

  // Credentials existují buď v localStorage NEBO na serveru (env vars)
  const hasCredentials = hydrated && (!!config.credentials.apiKey || serverHasCredentials);

  return {
    state,
    config,
    hydrated,
    hasCredentials,
    start,
    stop,
    updateConfig,
    toggleBot,
    closePosition,
    closeAll,
  };
}

/**
 * Telemetry domain of the machine console: system overview, process table
 * and network diagnostics state, each with its own fetch action.
 *
 * Extracted from MachineConsoleDrawer; the main component destructures the
 * return value so its JSX and auto-refresh timer keep their original names.
 */
import { useCallback, useState } from 'react';

import { message as antdMessage } from 'antd';

import {
  getMachineNetwork,
  getMachineOverview,
  getMachineProcesses,
  type NetworkDiagnostics,
  type ProcessInfo,
  type SystemOverview,
} from '@/api/diagnostics';

export function useMachineTelemetry(machineId: string | null) {
  // 1. Overview state
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // 3. Process state
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [procLoading, setProcLoading] = useState(false);

  // 4. Network state
  const [network, setNetwork] = useState<NetworkDiagnostics | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);

  // Fetch Overview
  const fetchOverview = useCallback(async (silent = false) => {
    if (!machineId) return;
    if (!silent) setOverviewLoading(true);
    setOverviewError(null);
    try {
      const data = await getMachineOverview(machineId);
      setOverview(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '获取机器监控信息失败';
      setOverviewError(msg);
    } finally {
      if (!silent) setOverviewLoading(false);
    }
  }, [machineId]);

  // Fetch Processes
  const fetchProcesses = useCallback(async (silent = false) => {
    if (!machineId) return;
    if (!silent) setProcLoading(true);
    try {
      const data = await getMachineProcesses(machineId);
      setProcesses(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误';
      if (!silent) antdMessage.error(`获取进程列表失败: ${msg}`);
    } finally {
      if (!silent) setProcLoading(false);
    }
  }, [machineId]);

  // Fetch Network
  const fetchNetwork = useCallback(async (silent = false) => {
    if (!machineId) return;
    if (!silent) setNetworkLoading(true);
    try {
      const data = await getMachineNetwork(machineId);
      setNetwork(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误';
      if (!silent) antdMessage.error(`获取网络状态失败: ${msg}`);
    } finally {
      if (!silent) setNetworkLoading(false);
    }
  }, [machineId]);

  return {
    overview,
    overviewLoading,
    overviewError,
    fetchOverview,
    processes,
    procLoading,
    fetchProcesses,
    network,
    networkLoading,
    fetchNetwork,
  };
}

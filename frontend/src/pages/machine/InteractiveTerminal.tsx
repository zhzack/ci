import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dropdown,
  Space,
  Tag,
  Tooltip,
  Typography,
  message as antdMessage,
} from 'antd';
import {
  ClearOutlined,
  CloseOutlined,
  CodeOutlined,
  CompassOutlined,
  CopyOutlined,
  DisconnectOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { useThemeStore } from '@/store/theme';
import { useAuthStore } from '@/store/auth';
import type { DirectoryEntry } from '@/api/diagnostics';

interface Props {
  machineId: string | null;
  machineName: string;
  connectionType?: string;
  hostname?: string;
  platform?: string;
  currentCwd: string;
  currentFiles?: DirectoryEntry[];
  onDirectoryChange: (newDir: string) => void;
  pendingCommand?: string | null;
  onClearPendingCommand?: () => void;
}

interface TabSession {
  id: string;
  title: string;
}

const COMMON_COMMANDS_WIN = [
  'dir',
  'Get-Process | select -First 10',
  'Get-Service | select -First 10',
  'ipconfig',
  'systeminfo',
  'netstat -an',
  'git status',
  'cls',
];

const COMMON_COMMANDS_LINUX = [
  'ls -lah',
  'ps aux | head -n 15',
  'top -bn1 | head -n 20',
  'df -h',
  'free -m',
  'ip a',
  'uname -a',
  'git status',
  'clear',
];

const TERMINAL_THEME_DARK = {
  background: '#141414',
  foreground: '#f0f0f0',
  cursor: '#52c41a',
  cursorAccent: '#141414',
  selectionBackground: 'rgba(38, 79, 120, 0.75)',
};

const TERMINAL_THEME_LIGHT = {
  background: '#1e1e1e',
  foreground: '#f0f0f0',
  cursor: '#52c41a',
  cursorAccent: '#1e1e1e',
  selectionBackground: 'rgba(38, 79, 120, 0.75)',
};

const TERMINAL_FONT =
  'Menlo, Monaco, Consolas, "Courier New", monospace';

/** Extract working directory from terminal text prompt (Windows or Linux) */
function extractDirectoryFromPrompt(text: string): string | null {
  // 1. Windows path in prompt: e.g. "C:\Users\zz101>" or "PS G:\code\tools\ci>"
  const winMatch = /([a-zA-Z]:\\[^>\r\n]+)>/g.exec(text);
  if (winMatch?.[1]) {
    return winMatch[1].trim().replace(/\\/g, '/');
  }

  // 2. Linux path in prompt: e.g. "root@server:/var/www/html#" or "user@BLUEGREY:~/ci$"
  const linuxMatch = /:([/~][^#$>\r\n]*)[#$>]/g.exec(text);
  if (linuxMatch?.[1]) {
    return linuxMatch[1].trim();
  }

  return null;
}

const MAX_RECONNECT_ATTEMPTS = 5;

/** Independent PTY session rendered by xterm.js (no React re-render per chunk). */
const SingleTerminalPane = React.memo(function SingleTerminalPane({
  sessionId,
  machineId,
  isWindows,
  isActive,
  onDirectoryDetected,
  onRegisterSender,
  onUnregisterSender,
}: {
  sessionId: string;
  machineId: string;
  isWindows: boolean;
  isActive: boolean;
  onDirectoryDetected?: (dir: string) => void;
  onRegisterSender: (sessionId: string, sender: (cmd: string) => void) => void;
  onUnregisterSender: (sessionId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const connectionSeqRef = useRef(0);
  const disposedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const directoryTimerRef = useRef<number | null>(null);
  const onDirectoryDetectedRef = useRef(onDirectoryDetected);

  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>(
    'connecting',
  );

  const token = useAuthStore((state) => state.token);
  const themeMode = useThemeStore((state) => state.mode);
  const isDark = themeMode === 'dark';

  useEffect(() => {
    onDirectoryDetectedRef.current = onDirectoryDetected;
  }, [onDirectoryDetected]);

  const sendRaw = useCallback((payload: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      antdMessage.warning('终端会话尚未就绪');
    }
  }, []);

  useEffect(() => {
    onRegisterSender(sessionId, sendRaw);
    return () => {
      onUnregisterSender(sessionId);
    };
  }, [sessionId, sendRaw, onRegisterSender, onUnregisterSender]);

  const fitAndResize = useCallback(() => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;
    try {
      fitAddon.fit();
    } catch {
      return;
    }
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }),
      );
    }
  }, []);

  /** Create the xterm instance once; it owns rendering and input handling. */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    disposedRef.current = false;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: TERMINAL_FONT,
      scrollback: 5000,
      convertEol: false,
      theme: isDark ? TERMINAL_THEME_DARK : TERMINAL_THEME_LIGHT,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Every keystroke goes straight to the PTY; xterm encodes control keys,
    // arrows, function keys and paste events for us.
    const dataSubscription = term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Detect the shell prompt's working directory from the rendered buffer.
    const parsedSubscription = term.onWriteParsed(() => {
      if (directoryTimerRef.current !== null) return;
      directoryTimerRef.current = window.setTimeout(() => {
        directoryTimerRef.current = null;
        const callback = onDirectoryDetectedRef.current;
        if (!callback) return;
        const buffer = term.buffer.active;
        const currentLine = buffer.getLine(buffer.baseY + buffer.cursorY);
        const text = currentLine ? currentLine.translateToString(true) : '';
        const detected = extractDirectoryFromPrompt(text);
        if (detected) callback(detected);
      }, 200);
    });

    const observer = new ResizeObserver(() => fitAndResize());
    observer.observe(host);
    const initialFit = window.setTimeout(() => fitAndResize(), 0);

    return () => {
      disposedRef.current = true;
      window.clearTimeout(initialFit);
      if (directoryTimerRef.current !== null) {
        window.clearTimeout(directoryTimerRef.current);
        directoryTimerRef.current = null;
      }
      observer.disconnect();
      dataSubscription.dispose();
      parsedSubscription.dispose();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // The terminal instance itself is created once per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const connectWs = useCallback(() => {
    if (disposedRef.current) return;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const previous = wsRef.current;
    wsRef.current = null;
    if (previous) {
      try {
        previous.close();
      } catch {
        // ignore
      }
    }

    setStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const cols = termRef.current?.cols ?? 120;
    const rows = termRef.current?.rows ?? 32;
    const wsUrl = `${protocol}//${host}/api/machines/${machineId}/terminal/ws?session_id=${sessionId}&cols=${cols}&rows=${rows}&token=${encodeURIComponent(
      token || '',
    )}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    // Only the latest connection may mutate UI state: React StrictMode mounts
    // effects twice in development, and the stale socket's onclose fires
    // *after* the second connection is established. Without this guard the
    // stale event schedules a reconnect that kills the live session,
    // producing an endless connect/disconnect loop.
    const seq = connectionSeqRef.current + 1;
    connectionSeqRef.current = seq;
    const isCurrent = () =>
      connectionSeqRef.current === seq && !disposedRef.current;

    ws.onopen = () => {
      if (!isCurrent()) return;
      reconnectAttemptsRef.current = 0;
      setStatus('connected');
      fitAndResize();
      if (isActive) termRef.current?.focus();
    };

    ws.onmessage = (event) => {
      if (!isCurrent()) return;
      const term = termRef.current;
      if (!term) return;
      if (typeof event.data === 'string') {
        if (event.data.startsWith('{"type":"pong"}')) return;
        const detected = extractDirectoryFromPrompt(event.data);
        if (detected) onDirectoryDetectedRef.current?.(detected);
        term.write(event.data);
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      }
    };

    ws.onclose = () => {
      if (!isCurrent()) return;
      setStatus('disconnected');
      termRef.current?.write(
        '\r\n\x1b[31m[终端连接已断开，正在尝试重连…]\x1b[0m\r\n',
      );
      const attempt = reconnectAttemptsRef.current;
      if (attempt >= MAX_RECONNECT_ATTEMPTS) {
        termRef.current?.write(
          '\x1b[33m[自动重连已达上限，请点击工具栏「重连」]\x1b[0m\r\n',
        );
        return;
      }
      reconnectAttemptsRef.current = attempt + 1;
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connectWs();
      }, delay);
    };

    ws.onerror = () => {
      if (!isCurrent()) return;
      setStatus('disconnected');
    };
  }, [machineId, sessionId, token, isActive, fitAndResize]);

  // One connection per (machine, session); reconnects are scheduled internally.
  useEffect(() => {
    reconnectAttemptsRef.current = 0;
    connectWs();
    return () => {
      disposedRef.current = true;
      // Invalidate the live socket so its pending events (close/error) can no
      // longer schedule reconnects after this effect is torn down.
      connectionSeqRef.current += 1;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, machineId]);

  // Keep the terminal fitted and focused when its tab becomes visible.
  useEffect(() => {
    if (!isActive) return;
    const timer = window.setTimeout(() => {
      fitAndResize();
      const term = termRef.current;
      if (term) {
        // Panes mount inside visibility:hidden containers, so the renderer
        // may have measured zero rows; force a repaint of the whole viewport.
        term.refresh(0, term.rows - 1);
        term.focus();
      }
    }, 40);
    return () => window.clearTimeout(timer);
  }, [isActive, fitAndResize]);

  // Follow the platform light/dark mode.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = isDark ? TERMINAL_THEME_DARK : TERMINAL_THEME_LIGHT;
  }, [isDark]);

  const handleCopy = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    const selection = term.getSelection();
    if (selection) {
      void navigator.clipboard.writeText(selection);
      antdMessage.success('已复制选中文本');
      term.focus();
      return;
    }
    const buffer = term.buffer.active;
    const lines: string[] = [];
    for (let index = 0; index < buffer.length; index += 1) {
      const line = buffer.getLine(index);
      if (line) lines.push(line.translateToString(true));
    }
    void navigator.clipboard.writeText(lines.join('\n'));
    antdMessage.success('已复制全部终端输出');
    term.focus();
  }, []);

  const handleClear = useCallback(() => {
    termRef.current?.clear();
    sendRaw(isWindows ? 'cls\r' : 'clear\r');
    termRef.current?.focus();
  }, [isWindows, sendRaw]);

  const sendKey = useCallback(
    (sequence: string) => {
      sendRaw(sequence);
      termRef.current?.focus();
    },
    [sendRaw],
  );

  return (
    <div
      onClick={() => termRef.current?.focus()}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        visibility: isActive ? 'visible' : 'hidden',
        pointerEvents: isActive ? 'auto' : 'none',
        background: isDark ? '#141414' : '#1e1e1e',
        color: '#f0f0f0',
      }}
    >
      {/* Session Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px 10px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          background: isDark ? '#1f1f1f' : '#252526',
          fontSize: 12,
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        <Space size={8} wrap>
          {status === 'connected' ? (
            <Tag color="success" style={{ margin: 0, fontSize: 11 }}>
              ● PTY 全双工直连 (xterm-256color)
            </Tag>
          ) : status === 'connecting' ? (
            <Tag
              color="processing"
              icon={<SyncOutlined spin />}
              style={{ margin: 0, fontSize: 11 }}
            >
              连接中...
            </Tag>
          ) : (
            <Tag
              color="error"
              icon={<DisconnectOutlined />}
              style={{ margin: 0, fontSize: 11 }}
            >
              已断开（自动重连中）
            </Tag>
          )}

          <Typography.Text style={{ fontSize: 11, color: '#bfbfbf' }}>
            快捷按键:
          </Typography.Text>
          <Button size="small" onClick={() => sendKey('\x03')}>
            Ctrl+C
          </Button>
          <Button size="small" onClick={() => sendKey('\t')}>
            Tab 补全
          </Button>
          <Button size="small" onClick={() => sendKey('\x1b')}>
            Esc
          </Button>
          <Button size="small" onClick={() => sendKey('\x04')}>
            Ctrl+D
          </Button>
          <Button size="small" onClick={() => sendKey('\x1a')}>
            Ctrl+Z
          </Button>
        </Space>

        <Space size={6}>
          <Tooltip title="复制终端内容">
            <Button size="small" icon={<CopyOutlined />} onClick={handleCopy}>
              复制
            </Button>
          </Tooltip>
          <Tooltip title="清屏">
            <Button size="small" icon={<ClearOutlined />} onClick={handleClear}>
              清屏
            </Button>
          </Tooltip>
          <Tooltip title="重新连接 WebSocket">
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => {
                reconnectAttemptsRef.current = 0;
                connectWs();
              }}
            >
              重连
            </Button>
          </Tooltip>
        </Space>
      </div>

      {/* xterm.js viewport */}
      <div
        ref={hostRef}
        style={{
          flex: 1,
          minHeight: 0,
          padding: '6px 8px',
          overflow: 'hidden',
        }}
      />
      <style>{`
        .xterm { height: 100%; }
        .xterm .xterm-viewport { overflow-y: auto; }
      `}</style>
    </div>
  );
});

/** Electerm-Web Style Multi-Tab Terminal Workspace with File Linkage */
export function InteractiveTerminal({
  machineId,
  machineName,
  connectionType = 'agent',
  hostname,
  platform,
  currentCwd,
  currentFiles = [],
  onDirectoryChange,
  pendingCommand,
  onClearPendingCommand,
}: Props): React.JSX.Element {
  const [sessions, setSessions] = useState<TabSession[]>([
    { id: 'sess-1', title: '终端 1' },
  ]);
  const [activeSessionId, setActiveSessionId] = useState<string>('sess-1');
  const [detectedTerminalDir, setDetectedTerminalDir] = useState<string>('');

  const sendersRef = useRef<Map<string, (cmd: string) => void>>(new Map());

  // Execute pending command (e.g. from File Explorer right-click / tree click)
  useEffect(() => {
    if (pendingCommand) {
      const sender = sendersRef.current.get(activeSessionId);
      if (sender) {
        sender(pendingCommand);
        if (onClearPendingCommand) onClearPendingCommand();
      }
    }
  }, [pendingCommand, activeSessionId, onClearPendingCommand]);

  const handleRegisterSender = useCallback((id: string, sender: (cmd: string) => void) => {
    sendersRef.current.set(id, sender);
  }, []);

  const handleUnregisterSender = useCallback((id: string) => {
    sendersRef.current.delete(id);
  }, []);

  const isWindows = useMemo(() => {
    return (
      (platform || '').toLowerCase().includes('win') ||
      connectionType.toLowerCase().includes('win')
    );
  }, [platform, connectionType]);

  const commonCommands = isWindows ? COMMON_COMMANDS_WIN : COMMON_COMMANDS_LINUX;

  const handleAddSession = () => {
    const nextIdx = sessions.length + 1;
    const newId = `sess-${Date.now()}`;
    setSessions((prev) => [...prev, { id: newId, title: `终端 ${nextIdx}` }]);
    setActiveSessionId(newId);
  };

  const handleCloseSession = (targetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessions.length === 1) {
      antdMessage.info('至少保留一个终端会话');
      return;
    }
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== targetId);
      const last = filtered[filtered.length - 1];
      if (activeSessionId === targetId && last) {
        setActiveSessionId(last.id);
      }
      return filtered;
    });
    sendersRef.current.delete(targetId);
  };

  const handleRunQuickCommand = (cmd: string) => {
    const sender = sendersRef.current.get(activeSessionId);
    if (sender) {
      sender(`${cmd}\r`);
    } else {
      antdMessage.warning('当前终端会话未准备好');
    }
  };

  // Linkage 1: Send cd command to active terminal to enter File Explorer's current path
  const handleCdToFileDir = () => {
    if (!currentCwd) return;
    const sender = sendersRef.current.get(activeSessionId);
    if (!sender) {
      antdMessage.warning('当前终端会话未就绪');
      return;
    }
    if (isWindows) {
      const winPath = currentCwd.replace(/\//g, '\\');
      sender(`cd /d "${winPath}"\r`);
    } else {
      sender(`cd "${currentCwd}"\r`);
    }
    antdMessage.success(`已在终端执行进入: ${currentCwd}`);
  };

  // Linkage 2: Sync terminal's detected directory back to Remote File Explorer
  const handleSyncToExplorer = () => {
    const target = detectedTerminalDir || currentCwd;
    if (target) {
      onDirectoryChange(target);
      antdMessage.success(`远程文件管理器已定位到: ${target}`);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Electerm Top Tab Bar & Global Actions */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(0, 0, 0, 0.03)',
          borderBottom: '1px solid rgba(140, 140, 140, 0.18)',
          padding: '4px 8px',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        {/* Multi-Session Tabs */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', overflowX: 'auto' }}>
          {sessions.map((sess) => {
            const isActive = sess.id === activeSessionId;
            return (
              <div
                key={sess.id}
                onClick={() => setActiveSessionId(sess.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  borderRadius: '4px 4px 0 0',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? '#1677ff' : 'rgba(0,0,0,0.05)',
                  color: isActive ? '#ffffff' : 'inherit',
                  border: isActive ? '1px solid #1677ff' : '1px solid rgba(140, 140, 140, 0.15)',
                  transition: 'all 0.15s ease',
                }}
              >
                <CodeOutlined style={{ fontSize: 11 }} />
                <span>{sess.title}</span>
                {sessions.length > 1 && (
                  <CloseOutlined
                    style={{
                      fontSize: 10,
                      marginLeft: 2,
                      opacity: isActive ? 0.9 : 0.5,
                    }}
                    onClick={(e) => handleCloseSession(sess.id, e)}
                  />
                )}
              </div>
            );
          })}
          <Tooltip title="新建独立终端会话">
            <Button
              size="small"
              type="text"
              icon={<PlusOutlined />}
              onClick={handleAddSession}
              style={{ fontSize: 12, padding: '0 6px' }}
            />
          </Tooltip>
        </div>

        {/* Linkage & Quick Actions */}
        <Space size={6} wrap>
          {/* Linkage Button: CD to File Manager Path */}
          <Tooltip title={`在终端中快速进入文件管理当前路径: ${currentCwd}`}>
            <Button
              size="small"
              type="primary"
              ghost
              icon={<RightCircleOutlined />}
              onClick={handleCdToFileDir}
            >
              进入文件目录
            </Button>
          </Tooltip>

          {/* Linkage Button: Sync Terminal Dir to File Manager */}
          {detectedTerminalDir && (
            <Tooltip title={`将文件管理器同步定位到终端当前目录: ${detectedTerminalDir}`}>
              <Button
                size="small"
                icon={<FolderOpenOutlined style={{ color: '#faad14' }} />}
                onClick={handleSyncToExplorer}
              >
                定位到文件
              </Button>
            </Tooltip>
          )}

          {/* Insert File Path Dropdown */}
          {currentFiles.length > 0 && (
            <Dropdown
              menu={{
                items: currentFiles.slice(0, 15).map((f) => ({
                  key: f.path,
                  icon: f.is_dir ? <FolderOpenOutlined /> : <CodeOutlined />,
                  label: <span style={{ fontFamily: 'monospace' }}>{f.name}</span>,
                  onClick: () => {
                    const sender = sendersRef.current.get(activeSessionId);
                    if (sender) sender(`"${f.path}"`);
                  },
                })),
              }}
            >
              <Button size="small" icon={<CompassOutlined />}>
                插入路径
              </Button>
            </Dropdown>
          )}

          {/* Preset Commands Dropdown */}
          <Dropdown
            menu={{
              items: commonCommands.map((cmd) => ({
                key: cmd,
                label: (
                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{cmd}</span>
                ),
                onClick: () => handleRunQuickCommand(cmd),
              })),
            }}
          >
            <Button size="small" icon={<CodeOutlined />}>
              指令库
            </Button>
          </Dropdown>
          <Tag color="geekblue" style={{ margin: 0, fontSize: 11 }}>
            {hostname || machineName}
          </Tag>
        </Space>
      </div>

      {/* Quick Command Chips Toolbar */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          padding: '4px 8px',
          background: 'rgba(0,0,0,0.015)',
          borderBottom: '1px solid rgba(140, 140, 140, 0.1)',
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
          常用指令:
        </Typography.Text>
        {commonCommands.slice(0, 8).map((cmd) => (
          <Tag
            key={cmd}
            style={{
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: 'monospace',
              padding: '1px 6px',
              borderRadius: 3,
            }}
            onClick={() => handleRunQuickCommand(cmd)}
          >
            {cmd}
          </Tag>
        ))}
      </div>

      {/* Terminal Sessions Container - All sessions stay mounted & active! */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {sessions.map((sess) => (
          <SingleTerminalPane
            key={sess.id}
            sessionId={sess.id}
            machineId={machineId || 'master-local'}
            isWindows={isWindows}
            isActive={sess.id === activeSessionId}
            onDirectoryDetected={setDetectedTerminalDir}
            onRegisterSender={handleRegisterSender}
            onUnregisterSender={handleUnregisterSender}
          />
        ))}
      </div>
    </div>
  );
}

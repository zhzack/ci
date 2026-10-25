/* eslint-disable no-control-regex */
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

interface TextSegment {
  text: string;
  color?: string;
  bg?: string;
  bold?: boolean;
}

interface LineData {
  id: string;
  segments: TextSegment[];
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

// ANSI standard 16-color palette
const ANSI_COLORS: Record<number, string> = {
  30: '#000000',
  31: '#ff4d4f',
  32: '#52c41a',
  33: '#faad14',
  34: '#1677ff',
  35: '#722ed1',
  36: '#13c2c2',
  37: '#e0e0e0',
  90: '#8c8c8c',
  91: '#ff7875',
  92: '#73d13d',
  93: '#ffc53d',
  94: '#4096ff',
  95: '#9254de',
  96: '#36cfc9',
  97: '#ffffff',
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: '#000000',
  41: '#820014',
  42: '#135200',
  43: '#874d00',
  44: '#002c8c',
  45: '#22075e',
  46: '#00474f',
  47: '#ffffff',
};

/** High-Performance ANSI & DEC Private Mode Escape Sequence Parser */
function parseAnsiText(raw: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let currentColor: string | undefined = undefined;
  let currentBg: string | undefined = undefined;
  let currentBold = false;

  // Regex matching ANSI/DEC escape sequences (SGR colors, DEC mode ?25h/?25l, OSC, cursor controls)
  const ansiRegex =
    /\x1b\[([0-9;]*)m|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b\[[?=0-9;]*[a-zA-Z~]|\x1b[()][AB012]|\x1b[>=]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ansiRegex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      let chunk = raw.substring(lastIndex, match.index);
      chunk = chunk.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
      if (chunk) {
        segments.push({
          text: chunk,
          color: currentColor,
          bg: currentBg,
          bold: currentBold,
        });
      }
    }

    // Process SGR color codes (\x1b[...m)
    if (match[1] !== undefined) {
      const codes = match[1].split(';').map((c) => parseInt(c, 10) || 0);
      if (codes.length === 0 || (codes.length === 1 && codes[0] === 0)) {
        currentColor = undefined;
        currentBg = undefined;
        currentBold = false;
      } else {
        for (let i = 0; i < codes.length; i++) {
          const code = codes[i];
          if (code === 0) {
            currentColor = undefined;
            currentBg = undefined;
            currentBold = false;
          } else if (code === 1) {
            currentBold = true;
          } else if (code === 22) {
            currentBold = false;
          } else if (code && ANSI_COLORS[code]) {
            currentColor = ANSI_COLORS[code];
          } else if (code && ANSI_BG_COLORS[code]) {
            currentBg = ANSI_BG_COLORS[code];
          } else if (code === 38 && codes[i + 1] === 5 && typeof codes[i + 2] === 'number') {
            const colorIdx = codes[i + 2] ?? 0;
            currentColor = `hsl(${(colorIdx * 137.5) % 360}, 75%, 60%)`;
            i += 2;
          } else if (code === 38 && codes[i + 1] === 2 && typeof codes[i + 4] === 'number') {
            const r = codes[i + 2] ?? 255;
            const g = codes[i + 3] ?? 255;
            const b = codes[i + 4] ?? 255;
            currentColor = `rgb(${r},${g},${b})`;
            i += 4;
          }
        }
      }
    }

    lastIndex = ansiRegex.lastIndex;
  }

  if (lastIndex < raw.length) {
    let chunk = raw.substring(lastIndex);
    chunk = chunk.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    if (chunk) {
      segments.push({
        text: chunk,
        color: currentColor,
        bg: currentBg,
        bold: currentBold,
      });
    }
  }

  return segments;
}

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

/** Independent PTY Terminal Session Component */
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
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [lines, setLines] = useState<LineData[]>([
    {
      id: 'init',
      segments: [
        {
          text: '⚡ 正在建立 Electerm 全双工 PTY 独立会话通道...\n',
          color: '#faad14',
        },
      ],
    },
  ]);

  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [isAutoScroll, setIsAutoScroll] = useState(true);

  const token = useAuthStore((state) => state.token);
  const themeMode = useThemeStore((state) => state.mode);
  const isDark = themeMode === 'dark';

  const sendRaw = useCallback((payload: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(payload);
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

  // Connect WebSocket PTY with dedicated session
  const connectWs = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
    }

    setStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/machines/${machineId}/terminal/ws?session_id=${sessionId}&cols=120&rows=32&token=${encodeURIComponent(
      token || ''
    )}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 32 }));
      if (isActive) {
        inputRef.current?.focus();
      }
    };

    ws.onmessage = (event) => {
      let rawText = '';
      if (typeof event.data === 'string') {
        rawText = event.data;
      } else if (event.data instanceof ArrayBuffer) {
        rawText = new TextDecoder('utf-8').decode(event.data);
      }

      if (!rawText) return;

      // Handle JSON messages (e.g. pong)
      if (rawText.startsWith('{"type":"pong"}')) return;

      // Detect CWD from prompt
      const detected = extractDirectoryFromPrompt(rawText);
      if (detected && onDirectoryDetected) {
        onDirectoryDetected(detected);
      }

      const newSegments = parseAnsiText(rawText);
      const newLine: LineData = {
        id: `line-${Date.now()}-${Math.random()}`,
        segments: newSegments,
      };

      setLines((prev) => {
        const next = prev.length > 1500 ? prev.slice(prev.length - 1200) : prev;
        return [...next, newLine];
      });
    };

    ws.onclose = () => {
      setStatus('disconnected');
      setLines((prev) => [
        ...prev,
        {
          id: `disc-${Date.now()}`,
          segments: [{ text: '\r\n[WebSocket 终端会话已断开]\r\n', color: '#ff4d4f' }],
        },
      ]);
    };

    ws.onerror = () => {
      setStatus('disconnected');
    };
  }, [machineId, sessionId, token, isActive, onDirectoryDetected]);

  // Connect once on mount, clean on unmount
  useEffect(() => {
    connectWs();
    return () => {
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, machineId]); // only reconnect if session or machine identity changes!

  // Auto focus when activated
  useEffect(() => {
    if (isActive) {
      inputRef.current?.focus();
    }
  }, [isActive]);

  // Auto-scroll
  useEffect(() => {
    if (isAutoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, isAutoScroll]);

  const handleContainerClick = () => {
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        sendRaw('\x03');
        return;
      }
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        sendRaw('\x04');
        return;
      }
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        sendRaw('\x1a');
        return;
      }
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        setLines([]);
        sendRaw(isWindows ? 'cls\r' : 'clear\r');
        return;
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      sendRaw('\t');
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      sendRaw('\r');
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      sendRaw(isWindows ? '\x08' : '\x7f');
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      sendRaw('\x1b[3~');
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      sendRaw('\x1b[A');
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sendRaw('\x1b[B');
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      sendRaw('\x1b[C');
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      sendRaw('\x1b[D');
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      sendRaw('\x1b');
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      sendRaw(e.key);
    }
  };

  const handleClear = () => {
    setLines([]);
    sendRaw(isWindows ? 'cls\r' : 'clear\r');
  };

  const handleCopy = () => {
    const sel = window.getSelection()?.toString();
    if (sel) {
      void navigator.clipboard.writeText(sel);
      antdMessage.success('已复制选中文本');
    } else {
      const fullText = lines
        .map((l) => l.segments.map((s) => s.text).join(''))
        .join('');
      void navigator.clipboard.writeText(fullText);
      antdMessage.success('已复制全部终端输出');
    }
  };

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      style={{
        display: isActive ? 'flex' : 'none',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: isDark ? '#141414' : '#1e1e1e',
        color: '#f0f0f0',
        fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
        position: 'relative',
      }}
    >
      {/* Hidden input to capture physical keyboard keystrokes */}
      <input
        ref={inputRef}
        type="text"
        onKeyDown={handleKeyDown}
        style={{
          position: 'absolute',
          top: -9999,
          left: -9999,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />

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
            <Tag color="processing" icon={<SyncOutlined spin />} style={{ margin: 0, fontSize: 11 }}>
              连接中...
            </Tag>
          ) : (
            <Tag color="error" icon={<DisconnectOutlined />} style={{ margin: 0, fontSize: 11 }}>
              已断开
            </Tag>
          )}

          <Typography.Text style={{ fontSize: 11, color: '#bfbfbf' }}>
            快捷按键:
          </Typography.Text>
          <Button size="small" onClick={() => sendRaw('\x03')}>
            Ctrl+C
          </Button>
          <Button size="small" onClick={() => sendRaw('\t')}>
            Tab 补全
          </Button>
          <Button size="small" onClick={() => sendRaw('\x1b')}>
            Esc
          </Button>
          <Button size="small" onClick={() => sendRaw('\x04')}>
            Ctrl+D
          </Button>
          <Button size="small" onClick={() => sendRaw('\x1a')}>
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
            <Button size="small" icon={<ReloadOutlined />} onClick={connectWs}>
              重连
            </Button>
          </Tooltip>
        </Space>
      </div>

      {/* Terminal Viewport */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const target = e.currentTarget;
          const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 40;
          setIsAutoScroll(isAtBottom);
        }}
        style={{
          flex: 1,
          padding: '8px 12px',
          overflowY: 'auto',
          lineHeight: '1.45',
          fontSize: 13,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          cursor: 'text',
        }}
      >
        {lines.map((line) => (
          <span key={line.id}>
            {line.segments.map((seg, sIdx) => (
              <span
                key={sIdx}
                style={{
                  color: seg.color || '#f0f0f0',
                  backgroundColor: seg.bg,
                  fontWeight: seg.bold ? 700 : 400,
                }}
              >
                {seg.text}
              </span>
            ))}
          </span>
        ))}
        {/* Blinking Cursor */}
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 15,
            background: '#52c41a',
            verticalAlign: 'middle',
            animation: 'cursor-blink 1s step-start infinite',
            marginLeft: 2,
          }}
        />
      </div>

      <style>{`
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
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

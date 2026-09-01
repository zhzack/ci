import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  Input,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message as antdMessage,
  type InputRef,
} from 'antd';
import {
  BulbOutlined,
  ClearOutlined,
  CodeOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { execMachineCommand, type DirectoryEntry } from '@/api/diagnostics';
import { useThemeStore } from '@/store/theme';

interface TerminalSession {
  id: string;
  title: string;
  cwd: string;
  history: string[];
  historyIndex: number;
  lines: Array<{
    type: 'prompt' | 'stdout' | 'stderr' | 'system' | 'completion';
    text: string;
    cwd?: string;
    exitCode?: number;
    durationMs?: number;
  }>;
}

interface Props {
  machineId: string | null;
  machineName: string;
  connectionType?: string;
  hostname?: string;
  platform?: string;
  currentCwd: string;
  currentFiles?: DirectoryEntry[];
  onDirectoryChange: (newDir: string) => void;
}

const COMMON_COMMANDS = [
  'ls',
  'ls -lah',
  'cd',
  'pwd',
  'cat',
  'mkdir',
  'rm',
  'rm -rf',
  'cp',
  'mv',
  'touch',
  'grep',
  'tail -f',
  'head',
  'chmod',
  'chown',
  'ps',
  'top',
  'df -h',
  'free -m',
  'uptime',
  'uname -a',
  'systemctl',
  'journalctl',
  'docker',
  'docker ps',
  'docker logs',
  'python',
  'python3',
  'pip',
  'pip list',
  'git status',
  'git log',
  'nvidia-smi',
  'curl',
  'wget',
  'tar',
  'zip',
  'unzip',
  'clear',
  'echo',
];

export function InteractiveTerminal({
  machineId,
  machineName,
  connectionType = 'agent',
  hostname,
  platform,
  currentCwd,
  currentFiles = [],
  onDirectoryChange,
}: Props): React.JSX.Element {
  const globalMode = useThemeStore((state) => state.mode);
  const [localTheme, setLocalTheme] = useState<'light' | 'dark' | 'auto'>('auto');

  const effectiveMode = localTheme === 'auto' ? globalMode : localTheme;
  const isDark = effectiveMode === 'dark';

  const [sessions, setSessions] = useState<TerminalSession[]>([
    {
      id: 'term-1',
      title: '终端 1',
      cwd: currentCwd || '/',
      history: [],
      historyIndex: -1,
      lines: [
        {
          type: 'system',
          text:
            machineId === 'master-local' || connectionType === 'builtin'
              ? `⚡ [${machineName}] (模式: 👑 MASTER 本地内置)。已建立本地交互终端。`
              : connectionType === 'ssh'
              ? `⚡ [${machineName}] (主机: ${hostname || 'SSH 远端'} | 模式: 🌐 SSH 直连 | 系统: ${platform || 'Windows/Linux'})。已建立 SSH 原生交互会话，支持命令实时执行、Tab 补全与目录联动。`
              : `⚡ [${machineName}] (主机: ${hostname || '已就绪'} | 模式: 🤖 AGENT 轮询 | 系统: ${platform || 'Windows/Linux'})。此节点已建立心跳通信，已支持全自动流水线任务执行！如需在 Web 页面直接开启原生全双工交互终端与 SFTP 盘符管理，请在机器配置中切换为【SSH 直连模式】。`,
        },
      ],
    },
  ]);
  const [activeTabKey, setActiveTabKey] = useState<string>('term-1');
  const [inputVal, setInputVal] = useState('');
  const [executing, setExecuting] = useState(false);

  const termBottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<InputRef | null>(null);

  const activeSession = sessions.find((s) => s.id === activeTabKey) || sessions[0];

  // Auto scroll to bottom when lines change
  useEffect(() => {
    termBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.lines]);

  const handleAddTab = () => {
    const newId = `term-${Date.now()}`;
    const newSession: TerminalSession = {
      id: newId,
      title: `终端 ${sessions.length + 1}`,
      cwd: activeSession ? activeSession.cwd : currentCwd || '/',
      history: [],
      historyIndex: -1,
      lines: [
        {
          type: 'system',
          text: `⚡ 新建终端会话 [${machineName}]。当前目录: ${activeSession ? activeSession.cwd : '/'}`,
        },
      ],
    };
    setSessions([...sessions, newSession]);
    setActiveTabKey(newId);
  };

  const handleRemoveTab = (targetKey: string) => {
    if (sessions.length <= 1) {
      antdMessage.info('至少保留一个终端会话');
      return;
    }
    const filtered = sessions.filter((s) => s.id !== targetKey);
    setSessions(filtered);
    if (activeTabKey === targetKey && filtered.length > 0) {
      const fallback = filtered[filtered.length - 1];
      if (fallback) setActiveTabKey(fallback.id);
    }
  };

  const handleExecute = async (overrideCmd?: string) => {
    const rawCmd = (overrideCmd ?? inputVal).trim();
    if (!rawCmd || !machineId || executing) return;

    if (rawCmd === 'clear' || rawCmd === 'cls') {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeTabKey
            ? {
                ...s,
                lines: [],
                history: [rawCmd, ...s.history.filter((h) => h !== rawCmd)],
                historyIndex: -1,
              }
            : s
        )
      );
      setInputVal('');
      return;
    }

    setExecuting(true);
    const cmdToRun = rawCmd;
    const currentSessionCwd = activeSession?.cwd || currentCwd || '/';

    // Append prompt line
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeTabKey
          ? {
              ...s,
              lines: [
                ...s.lines,
                { type: 'prompt', text: cmdToRun, cwd: currentSessionCwd },
              ],
              history: [cmdToRun, ...s.history.filter((h) => h !== cmdToRun)],
              historyIndex: -1,
            }
          : s
      )
    );
    setInputVal('');

    try {
      const result = await execMachineCommand(machineId, {
        command: cmdToRun,
        working_dir: currentSessionCwd,
      });

      const newLines: TerminalSession['lines'] = [];
      if (result.stdout) {
        newLines.push({ type: 'stdout', text: result.stdout });
      }
      if (result.stderr) {
        newLines.push({ type: 'stderr', text: result.stderr });
      }
      if (!result.stdout && !result.stderr) {
        newLines.push({
          type: 'system',
          text: `[执行完毕，退出状态码: ${result.exit_code}，耗时: ${result.duration_ms}ms]`,
          exitCode: result.exit_code,
          durationMs: result.duration_ms,
        });
      }

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === activeTabKey) {
            const nextCwd = result.new_working_dir || s.cwd;
            return {
              ...s,
              cwd: nextCwd,
              lines: [...s.lines, ...newLines],
            };
          }
          return s;
        })
      );

      // Trigger bidirectional sync to file explorer
      if (result.new_working_dir && result.new_working_dir !== currentSessionCwd) {
        onDirectoryChange(result.new_working_dir);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '未知错误';
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeTabKey
            ? {
                ...s,
                lines: [
                  ...s.lines,
                  { type: 'stderr', text: `执行异常: ${message}` },
                ],
              }
            : s
        )
      );
    } finally {
      setExecuting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  // Tab auto-completion logic
  const handleTabCompletion = () => {
    const text = inputVal;
    if (!text) {
      // Show general command suggestions
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeTabKey
            ? {
                ...s,
                lines: [
                  ...s.lines,
                  {
                    type: 'completion',
                    text: `💡 常用命令: ${COMMON_COMMANDS.slice(0, 12).join('   ')}`,
                  },
                ],
              }
            : s
        )
      );
      return;
    }

    const parts = text.split(' ');
    const lastWord = parts[parts.length - 1] || '';

    // If typing first command
    if (parts.length === 1) {
      const matchedCmds = COMMON_COMMANDS.filter((c) =>
        c.startsWith(lastWord.toLowerCase())
      );
      if (matchedCmds.length === 1 && matchedCmds[0]) {
        setInputVal(matchedCmds[0] + ' ');
      } else if (matchedCmds.length > 1) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeTabKey
              ? {
                  ...s,
                  lines: [
                    ...s.lines,
                    {
                      type: 'completion',
                      text: matchedCmds.join('    '),
                    },
                  ],
                }
              : s
          )
        );
      }
      return;
    }

    // If typing file/directory path argument
    const fileCandidates = currentFiles.map((f) =>
      f.is_dir ? `${f.name}/` : f.name
    );
    const matchedFiles = fileCandidates.filter((fn) =>
      fn.toLowerCase().startsWith(lastWord.toLowerCase())
    );

    if (matchedFiles.length === 1 && matchedFiles[0]) {
      parts[parts.length - 1] = matchedFiles[0];
      setInputVal(parts.join(' '));
    } else if (matchedFiles.length > 1) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeTabKey
            ? {
                ...s,
                lines: [
                  ...s.lines,
                  {
                    type: 'completion',
                    text: matchedFiles.join('    '),
                  },
                ],
              }
            : s
        )
      );
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      handleTabCompletion();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!activeSession || activeSession.history.length === 0) return;
      const nextIdx = Math.min(
        activeSession.historyIndex + 1,
        activeSession.history.length - 1
      );
      setSessions((prev) =>
        prev.map((s) => (s.id === activeTabKey ? { ...s, historyIndex: nextIdx } : s))
      );
      setInputVal(activeSession.history[nextIdx] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!activeSession) return;
      const nextIdx = Math.max(activeSession.historyIndex - 1, -1);
      setSessions((prev) =>
        prev.map((s) => (s.id === activeTabKey ? { ...s, historyIndex: nextIdx } : s))
      );
      setInputVal(nextIdx === -1 ? '' : activeSession.history[nextIdx] || '');
    }
  };

  const handleClearCurrent = () => {
    setSessions((prev) =>
      prev.map((s) => (s.id === activeTabKey ? { ...s, lines: [] } : s))
    );
  };

  // Dynamic Theme Colors
  const themeStyles = {
    cardBg: isDark ? '#141414' : '#ffffff',
    tabBarBg: isDark ? '#1f1f1f' : '#f1f5f9',
    termBg: isDark ? '#0d1117' : '#f8fafc',
    termBorder: isDark ? '#30363d' : '#e2e8f0',
    termText: isDark ? '#e6edf3' : '#1e293b',
    userHostColor: isDark ? '#7ee787' : '#0284c7',
    cwdColor: isDark ? '#79c0ff' : '#0891b2',
    promptCmdColor: isDark ? '#ffffff' : '#0f172a',
    stderrColor: isDark ? '#ffa198' : '#e11d48',
    systemColor: isDark ? '#8b949e' : '#64748b',
    completionColor: isDark ? '#e3b341' : '#d97706',
    footerBg: isDark ? '#161b22' : '#f1f5f9',
    tagBg: isDark ? undefined : '#e2e8f0',
    tagColor: isDark ? undefined : '#334155',
  };

  return (
    <Card
      size="small"
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <CodeOutlined style={{ color: '#52c41a' }} />
            <Typography.Text strong>在线原生终端 (Native Shell Console)</Typography.Text>
            <Tag color={isDark ? 'purple' : 'blue'} style={{ fontSize: 11 }}>
              Tab 补全已启用
            </Tag>
          </Space>
          <Space size={8}>
            <Tooltip title={`当前主题: ${isDark ? '暗黑模式 (Dark)' : '明亮模式 (Light)'}，点击切换`}>
              <Button
                size="small"
                icon={<BulbOutlined />}
                onClick={() => setLocalTheme(isDark ? 'light' : 'dark')}
              >
                {isDark ? '暗色' : '亮色'}
              </Button>
            </Tooltip>
            <Button size="small" icon={<PlusOutlined />} onClick={handleAddTab}>
              新建会话
            </Button>
            <Button size="small" icon={<ClearOutlined />} onClick={handleClearCurrent}>
              清屏
            </Button>
          </Space>
        </div>
      }
      style={{
        borderRadius: 8,
        overflow: 'hidden',
        background: themeStyles.cardBg,
        border: `1px solid ${themeStyles.termBorder}`,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
      bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', flex: 1 }}
    >
      <Tabs
        type="editable-card"
        activeKey={activeTabKey}
        onChange={setActiveTabKey}
        onEdit={(key, action) => {
          if (action === 'add') handleAddTab();
          else if (typeof key === 'string') handleRemoveTab(key);
        }}
        tabBarStyle={{
          margin: 0,
          padding: '4px 8px',
          background: themeStyles.tabBarBg,
          borderBottom: `1px solid ${themeStyles.termBorder}`,
        }}
        items={sessions.map((s) => ({
          key: s.id,
          label: (
            <Space size={4}>
              <span>{s.title}</span>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                ({s.cwd.split('/').pop() || '/'})
              </Typography.Text>
            </Space>
          ),
        }))}
      />

      {/* Terminal Viewport */}
      <div
        style={{
          background: themeStyles.termBg,
          color: themeStyles.termText,
          padding: '12px 16px',
          fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
          fontSize: 13,
          minHeight: 220,
          flex: 1,
          overflowY: 'auto',
          lineHeight: 1.5,
          borderBottom: `1px solid ${themeStyles.termBorder}`,
        }}
      >
        {activeSession?.lines.map((line, idx) => {
          if (line.type === 'prompt') {
            return (
              <div key={idx} style={{ margin: '6px 0 2px 0' }}>
                <span style={{ color: themeStyles.userHostColor, fontWeight: 'bold' }}>
                  root@{machineName}
                </span>
                <span style={{ color: themeStyles.cwdColor }}>
                  :{line.cwd || activeSession.cwd}${' '}
                </span>
                <span style={{ color: themeStyles.promptCmdColor, fontWeight: 600 }}>
                  {line.text}
                </span>
              </div>
            );
          }
          if (line.type === 'stderr') {
            return (
              <pre
                key={idx}
                style={{
                  margin: 0,
                  color: themeStyles.stderrColor,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {line.text}
              </pre>
            );
          }
          if (line.type === 'completion') {
            return (
              <div
                key={idx}
                style={{
                  color: themeStyles.completionColor,
                  fontSize: 12,
                  margin: '4px 0',
                  padding: '2px 6px',
                  background: isDark ? '#2d2200' : '#fef3c7',
                  borderRadius: 4,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {line.text}
              </div>
            );
          }
          if (line.type === 'system') {
            return (
              <div
                key={idx}
                style={{ color: themeStyles.systemColor, fontSize: 12, margin: '2px 0' }}
              >
                {line.text}
              </div>
            );
          }
          return (
            <pre
              key={idx}
              style={{
                margin: 0,
                color: themeStyles.termText,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {line.text}
            </pre>
          );
        })}

        {/* Live Input Line */}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
          <span
            style={{
              color: themeStyles.userHostColor,
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
            }}
          >
            root@{machineName}
          </span>
          <span style={{ color: themeStyles.cwdColor, whiteSpace: 'nowrap' }}>
            :{activeSession?.cwd}${' '}
          </span>
          <Input
            ref={inputRef}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onPressEnter={() => handleExecute()}
            onKeyDown={handleKeyDown}
            disabled={executing}
            placeholder={
              executing
                ? '命令正在执行中...'
                : '输入命令（Enter 运行，Tab 补全，↑/↓ 历史）'
            }
            bordered={false}
            style={{
              flex: 1,
              padding: '0 8px',
              color: themeStyles.promptCmdColor,
              fontFamily: 'inherit',
              fontSize: 'inherit',
              background: 'transparent',
            }}
          />
        </div>
        <div ref={termBottomRef} />
      </div>

      {/* Quick Command Pills */}
      <div
        style={{
          padding: '8px 12px',
          background: themeStyles.footerBg,
        }}
      >
        <Space size={6} wrap align="center">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            快捷指令:
          </Typography.Text>
          {[
            'pwd',
            'ls -lah',
            'cd ..',
            'cd ~',
            'df -h',
            'free -m',
            'top -bn1 | head -n 15',
            'nvidia-smi',
            'docker ps',
          ].map((cmd) => (
            <Tag
              key={cmd}
              color={isDark ? 'geekblue' : undefined}
              style={{
                cursor: 'pointer',
                fontFamily: 'monospace',
                background: themeStyles.tagBg,
                color: themeStyles.tagColor,
              }}
              onClick={() => handleExecute(cmd)}
            >
              {cmd}
            </Tag>
          ))}
        </Space>
      </div>
    </Card>
  );
}

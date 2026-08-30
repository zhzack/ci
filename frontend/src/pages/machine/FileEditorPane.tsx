import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Space,
  Tag,
  Tooltip,
  Typography,
  message as antdMessage,
} from 'antd';
import {
  CheckOutlined,
  DownloadOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  getDownloadFilesUrl,
  readMachineFile,
  saveMachineFile,
  type FileContentResult,
} from '@/api/diagnostics';
import { Loading } from '@/components/Loading';
import { useThemeStore } from '@/store/theme';

interface Props {
  machineId: string;
  filePath: string;
  onSaved?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function FileEditorPane({
  machineId,
  filePath,
  onSaved,
}: Props): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode);
  const isDark = mode === 'dark';

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileData, setFileData] = useState<FileContentResult | null>(null);
  const [content, setContent] = useState('');
  const [initialContent, setInitialContent] = useState('');

  const loadContent = () => {
    if (!machineId || !filePath) return;
    setLoading(true);
    readMachineFile(machineId, filePath)
      .then((res) => {
        setFileData(res);
        setContent(res.content);
        setInitialContent(res.content);
      })
      .catch((err) => {
        setFileData({
          path: filePath,
          content: '',
          size_bytes: 0,
          is_text: false,
          encoding: '',
          error: err?.message || '读取文件失败',
        });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadContent();
  }, [machineId, filePath]);

  const isDirty = content !== initialContent;

  const handleSave = async () => {
    if (!machineId || !filePath || saving) return;
    setSaving(true);
    try {
      await saveMachineFile(machineId, filePath, content);
      setInitialContent(content);
      antdMessage.success(`文件 "${filePath.split('/').pop()}" 保存成功`);
      onSaved?.();
    } catch (err: any) {
      antdMessage.error(`保存失败: ${err?.message || '未知错误'}`);
    } finally {
      setSaving(false);
    }
  };

  // Keyboard shortcut Ctrl+S
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void handleSave();
    }
  };

  const lineCount = content.split('\n').length;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');

  const editorBg = isDark ? '#1e1e1e' : '#f8fafc';
  const editorGutterBg = isDark ? '#252526' : '#f1f5f9';
  const editorGutterColor = isDark ? '#858585' : '#94a3b8';
  const editorTextColor = isDark ? '#d4d4d4' : '#0f172a';
  const editorBorder = isDark ? '#333333' : '#e2e8f0';

  const downloadUrl = getDownloadFilesUrl(machineId, [filePath]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        background: editorBg,
      }}
    >
      {/* Top Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 12px',
          borderBottom: `1px solid ${editorBorder}`,
          background: isDark ? '#181818' : '#ffffff',
        }}
      >
        <Space size={8} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <Typography.Text code style={{ fontSize: 12 }}>
            {filePath}
          </Typography.Text>
          {isDirty && (
            <Tag color="orange" style={{ fontSize: 11 }}>
              未保存 (Ctrl+S)
            </Tag>
          )}
          {fileData && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {formatBytes(fileData.size_bytes)} · {fileData.encoding || 'UTF-8'} · {lineCount} 行
            </Typography.Text>
          )}
        </Space>

        <Space size={6}>
          <Tooltip title="快捷键 Ctrl+S / Cmd+S">
            <Button
              type="primary"
              size="small"
              icon={isDirty ? <SaveOutlined /> : <CheckOutlined />}
              loading={saving}
              disabled={!isDirty}
              onClick={handleSave}
            >
              {isDirty ? '保存修改' : '已保存'}
            </Button>
          </Tooltip>

          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={loadContent}
          >
            重新加载
          </Button>

          <Button
            size="small"
            icon={<DownloadOutlined />}
            href={downloadUrl}
            target="_blank"
          >
            下载
          </Button>
        </Space>
      </div>

      {/* Editor Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {loading ? (
          <div style={{ padding: 40, width: '100%' }}>
            <Loading rows={6} />
          </div>
        ) : fileData?.error ? (
          <div style={{ padding: 16, width: '100%' }}>
            <Alert message="文件读取失败" description={fileData.error} type="error" showIcon />
          </div>
        ) : !fileData?.is_text ? (
          <div style={{ padding: 32, textAlign: 'center', width: '100%' }}>
            <Alert
              message="二进制文件"
              description="该文件为二进制或非文本格式，无法在线编辑，请点击右上角下载查看。"
              type="info"
              showIcon
            />
          </div>
        ) : (
          <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
            {/* Line Numbers Gutter */}
            <div
              style={{
                width: 48,
                background: editorGutterBg,
                color: editorGutterColor,
                fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                fontSize: 13,
                lineHeight: '20px',
                padding: '8px 6px',
                textAlign: 'right',
                userSelect: 'none',
                overflow: 'hidden',
                whiteSpace: 'pre',
                borderRight: `1px solid ${editorBorder}`,
              }}
            >
              {lineNumbers}
            </div>

            {/* Code Textarea */}
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              style={{
                flex: 1,
                height: '100%',
                background: editorBg,
                color: editorTextColor,
                fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                fontSize: 13,
                lineHeight: '20px',
                padding: '8px 12px',
                border: 'none',
                outline: 'none',
                resize: 'none',
                whiteSpace: 'pre',
                overflowWrap: 'normal',
                overflowX: 'auto',
                overflowY: 'auto',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

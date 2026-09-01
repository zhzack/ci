import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import {
  DownloadOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  getDownloadFilesUrl,
  readMachineFile,
  saveMachineFile,
  type FileContentResult,
} from '@/api/diagnostics';
import { Loading } from '@/components/Loading';

interface Props {
  open: boolean;
  machineId: string | null;
  filePath: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

export function FileEditModal({
  open,
  machineId,
  filePath,
  onClose,
  onSaved,
}: Props): React.JSX.Element {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileData, setFileData] = useState<FileContentResult | null>(null);
  const [content, setContent] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (open && machineId && filePath) {
      setLoading(true);
      setFileData(null);
      setContent('');
      readMachineFile(machineId, filePath)
        .then((res) => {
          setFileData(res);
          setContent(res.content);
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
    }
  }, [open, machineId, filePath]);

  const handleSave = async () => {
    if (!machineId || !filePath) return;
    setSaving(true);
    try {
      await saveMachineFile(machineId, filePath, content);
      antdMessage.success(`文件 "${filePath}" 已成功保存回被控机`);
      onSaved?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '未知错误';
      antdMessage.error(`保存失败: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const downloadUrl =
    machineId && filePath ? getDownloadFilesUrl(machineId, [filePath]) : '#';

  return (
    <Modal
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 32 }}>
          <Space>
            <span>文件快速预览与编辑：</span>
            <Typography.Text code style={{ fontSize: 13 }}>
              {filePath}
            </Typography.Text>
          </Space>
          <Space>
            {fileData?.is_text && (
              <Tag color="cyan">
                {fileData.encoding.toUpperCase()} | {Math.round(fileData.size_bytes / 1024)} KB
              </Tag>
            )}
            <Button
              type="text"
              size="small"
              icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={() => setFullscreen(!fullscreen)}
            >
              {fullscreen ? '还原' : '全屏'}
            </Button>
          </Space>
        </div>
      }
      open={open}
      width={fullscreen ? '95vw' : 840}
      style={fullscreen ? { top: 20 } : undefined}
      onCancel={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button icon={<DownloadOutlined />} href={downloadUrl} target="_blank">
            下载该文件
          </Button>
          <Space>
            <Button onClick={onClose}>取消 / 关闭</Button>
            {fileData?.is_text && (
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={saving}
                onClick={handleSave}
              >
                保存修改并写入
              </Button>
            )}
          </Space>
        </div>
      }
      destroyOnClose
    >
      {loading ? (
        <Loading rows={8} />
      ) : fileData?.error ? (
        <Alert
          type="warning"
          showIcon
          message="无法在线编辑"
          description={fileData.error}
          style={{ margin: '20px 0' }}
        />
      ) : (
        <div style={{ marginTop: 8 }}>
          <Input.TextArea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={fullscreen ? 26 : 18}
            style={{
              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
              fontSize: 13,
              lineHeight: 1.5,
              background: '#141414',
              color: '#f0f0f0',
              borderRadius: 6,
            }}
          />
        </div>
      )}
    </Modal>
  );
}

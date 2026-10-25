/**
 * The three file-operation dialogs (create / rename / chmod) of the
 * machine console, extracted verbatim from MachineConsoleDrawer.
 * Rendered at the drawer/tab root so modals overlay the whole surface.
 */
import { Input, Modal, Space, Tag, Typography } from 'antd';

interface ConsoleFileModalsProps {
  createModalVisible: boolean;
  createModalType: 'file' | 'dir';
  createLoading: boolean;
  handleCreateSubmit: () => void;
  setCreateModalVisible: (v: boolean) => void;
  setNewItemName: (v: string) => void;
  currentPath: string;
  newItemName: string;
  renameModalVisible: boolean;
  renameLoading: boolean;
  handleRenameSubmit: () => void;
  setRenameModalVisible: (v: boolean) => void;
  targetRenamePath: string;
  newRenameName: string;
  setNewRenameName: (v: string) => void;
  chmodModalVisible: boolean;
  chmodLoading: boolean;
  handleChmodSubmit: () => void;
  setChmodModalVisible: (v: boolean) => void;
  targetChmodPath: string;
  newChmodMode: string;
  setNewChmodMode: (v: string) => void;
}

export function ConsoleFileModals({
  createModalVisible,
  createModalType,
  createLoading,
  handleCreateSubmit,
  setCreateModalVisible,
  setNewItemName,
  currentPath,
  newItemName,
  renameModalVisible,
  renameLoading,
  handleRenameSubmit,
  setRenameModalVisible,
  targetRenamePath,
  newRenameName,
  setNewRenameName,
  chmodModalVisible,
  chmodLoading,
  handleChmodSubmit,
  setChmodModalVisible,
  targetChmodPath,
  newChmodMode,
  setNewChmodMode,
}: ConsoleFileModalsProps) {
  return (
    <>
      {/* 1. Modal: Create File / Directory */}
      <Modal
        title={createModalType === 'file' ? '新建文件' : '新建文件夹'}
        open={createModalVisible}
        onOk={handleCreateSubmit}
        onCancel={() => {
          setCreateModalVisible(false);
          setNewItemName('');
        }}
        confirmLoading={createLoading}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 12 }}>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              创建位置:
            </Typography.Text>
            <div style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 2 }}>{currentPath}</div>
          </div>
          <div>
            <Typography.Text strong>
              {createModalType === 'file' ? '文件名:' : '文件夹名:'}
            </Typography.Text>
            <Input
              autoFocus
              placeholder={createModalType === 'file' ? '例如: app.py, config.json' : '例如: src, logs'}
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onPressEnter={handleCreateSubmit}
              style={{ marginTop: 6 }}
            />
          </div>
        </Space>
      </Modal>

      {/* 2. Modal: Rename Path */}
      <Modal
        title="重命名"
        open={renameModalVisible}
        onOk={handleRenameSubmit}
        onCancel={() => setRenameModalVisible(false)}
        confirmLoading={renameLoading}
        okText="确定"
        cancelText="取消"
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 12 }}>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              原路径:
            </Typography.Text>
            <div style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 2 }}>
              {targetRenamePath}
            </div>
          </div>
          <div>
            <Typography.Text strong>新名称:</Typography.Text>
            <Input
              autoFocus
              value={newRenameName}
              onChange={(e) => setNewRenameName(e.target.value)}
              onPressEnter={handleRenameSubmit}
              style={{ marginTop: 6 }}
            />
          </div>
        </Space>
      </Modal>

      {/* 3. Modal: Chmod Permissions */}
      <Modal
        title="设置权限 (chmod)"
        open={chmodModalVisible}
        onOk={handleChmodSubmit}
        onCancel={() => setChmodModalVisible(false)}
        confirmLoading={chmodLoading}
        okText="保存权限"
        cancelText="取消"
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 12 }}>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              目标文件/文件夹:
            </Typography.Text>
            <div style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 2 }}>
              {targetChmodPath}
            </div>
          </div>
          <div>
            <Typography.Text strong>八进制权限模式 (POSIX Mode):</Typography.Text>
            <Input
              autoFocus
              value={newChmodMode}
              onChange={(e) => setNewChmodMode(e.target.value)}
              onPressEnter={handleChmodSubmit}
              style={{ marginTop: 6, fontFamily: 'monospace' }}
            />
          </div>
          <Space size={6} wrap>
            <Tag style={{ cursor: 'pointer' }} onClick={() => setNewChmodMode('0755')}>
              0755 (rwxr-xr-x 目录/可执行)
            </Tag>
            <Tag style={{ cursor: 'pointer' }} onClick={() => setNewChmodMode('0644')}>
              0644 (rw-r--r-- 普通文件)
            </Tag>
            <Tag style={{ cursor: 'pointer' }} onClick={() => setNewChmodMode('0777')}>
              0777 (rwxrwxrwx 全权)
            </Tag>
            <Tag style={{ cursor: 'pointer' }} onClick={() => setNewChmodMode('0600')}>
              0600 (rw------- 私有密钥)
            </Tag>
          </Space>
        </Space>
      </Modal>
    </>
  );
}

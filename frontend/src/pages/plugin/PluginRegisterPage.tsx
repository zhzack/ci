import React from "react";
import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message as antdMessage,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  FolderOpenOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { useApiMutation } from '@/hooks/useApiMutation';
import {
  registerPlugin,
  uploadPlugin,
  uploadPluginFolder,
} from '@/api/plugin';
import type { PluginSourceRequest } from '@/types/plugin';

type GitForm = { url: string; branch?: string; tag?: string; revision?: string; commit?: string };
type HttpForm = { url: string };

type FolderEntry = {
  key: string;
  path: string;
  size: number;
};

export default function PluginRegisterPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [gitForm] = Form.useForm<GitForm>();
  const [httpForm] = Form.useForm<HttpForm>();
  const [fileList, setFileList] = useState<File[]>([]);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const registerMutation = useApiMutation(
    {
      mutationFn: (source: PluginSourceRequest) => registerPlugin({ source }),
    },
    [['plugins']],
  );

  const uploadMutation = useApiMutation(
    {
      mutationFn: (file: File) => uploadPlugin(file),
    },
    [['plugins']],
  );

  const uploadFolderMutation = useApiMutation(
    {
      mutationFn: (files: File[]) => uploadPluginFolder(files),
    },
    [['plugins']],
  );

  const handleSubmit = async (kind: 'git' | 'http') => {
    const form = kind === 'git' ? gitForm : httpForm;
    try {
      const values = await form.validateFields();
      const source: PluginSourceRequest =
        kind === 'git'
          ? { type: 'git', ...(values as GitForm) }
          : { type: 'http', url: (values as HttpForm).url };
      await registerMutation.mutateAsync(source);
      navigate('/plugin/list');
    } catch {
      // validation or mutation error already shown
    }
  };

  const handleUpload = async () => {
    if (fileList.length === 0) {
      antdMessage.warning('Please choose a ZIP file first');
      return;
    }
    const file = fileList[0]!;
    try {
      await uploadMutation.mutateAsync(file);
      navigate('/plugin/list');
    } catch {
      // error already shown
    }
  };

  const openFolderPicker = () => {
    folderInputRef.current?.click();
  };

  const handleFolderSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files;
    if (!list || list.length === 0) {
      return;
    }
    const files: File[] = [];
    for (let i = 0; i < list.length; i += 1) {
      const file = list.item(i);
      if (file) {
        files.push(file);
      }
    }
    setFolderFiles(files);
    event.target.value = '';
  };

  const handleFolderUpload = async () => {
    if (folderFiles.length === 0) {
      antdMessage.warning('Please choose a folder first');
      return;
    }
    try {
      await uploadFolderMutation.mutateAsync(folderFiles);
      navigate('/plugin/list');
    } catch {
      // error already shown
    }
  };

  const folderEntries: FolderEntry[] = folderFiles.map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath
      ?? file.name;
    return { key: `${file.name}-${rel}`, path: rel, size: file.size };
  });

  const folderColumns: ColumnsType<FolderEntry> = [
    {
      title: 'Path',
      dataIndex: 'path',
      render: (value: string) => <code style={{ fontSize: 12 }}>{value}</code>,
    },
    {
      title: 'Size',
      dataIndex: 'size',
      render: (value: number) => `${(value / 1024).toFixed(2)} KiB`,
    },
  ];

  return (
    <>
      <PageHeader
        title="Register plugin"
        description="Add a plugin from Git, HTTP, ZIP, or folder. The plugin.yaml must declare a runtime type (shell, python, node, executable, docker)."
      />
      <div className="app-content-card">
        <Alert
          type="info"
          showIcon
          message="Supported runtime types"
          description={
            <Space wrap>
              <Tag color="blue">shell</Tag>
              <Tag color="green">python</Tag>
              <Tag color="orange">node</Tag>
              <Tag color="purple">executable</Tag>
              <Tag color="cyan">docker</Tag>
            </Space>
          }
          style={{ marginBottom: 16 }}
        />
        <Tabs
          defaultActiveKey="git"
          items={[
            {
              key: 'git',
              label: 'Git',
              children: (
                <Form layout="vertical" form={gitForm} style={{ maxWidth: 560 }}>
                  <Form.Item
                    name="url"
                    label="Git URL"
                    rules={[{ required: true, message: 'Repository URL is required' }]}
                  >
                    <Input placeholder="https://example.com/team/plugin.git" />
                  </Form.Item>
                  <Form.Item name="branch" label="Branch">
                    <Input placeholder="main" />
                  </Form.Item>
                  <Form.Item name="tag" label="Tag">
                    <Input placeholder="v1.0.0" />
                  </Form.Item>
                  <Form.Item name="revision" label="Revision">
                    <Input placeholder="(optional) e.g. main or feature/foo" />
                  </Form.Item>
                  <Form.Item name="commit" label="Commit">
                    <Input placeholder="(optional) commit hash to check out" />
                  </Form.Item>
                  <Button
                    type="primary"
                    loading={registerMutation.isPending}
                    onClick={() => handleSubmit('git')}
                  >
                    Register from Git
                  </Button>
                </Form>
              ),
            },
            {
              key: 'http',
              label: 'HTTP',
              children: (
                <Form layout="vertical" form={httpForm} style={{ maxWidth: 560 }}>
                  <Form.Item
                    name="url"
                    label="Download URL"
                    rules={[{ required: true, message: 'ZIP URL is required' }]}
                  >
                    <Input placeholder="https://example.com/plugins/hello-1.0.0.zip" />
                  </Form.Item>
                  <Typography.Paragraph type="secondary">
                    Archives are extracted with size and path protections applied.
                  </Typography.Paragraph>
                  <Button
                    type="primary"
                    loading={registerMutation.isPending}
                    onClick={() => handleSubmit('http')}
                  >
                    Register from HTTP
                  </Button>
                </Form>
              ),
            },
            {
              key: 'zip',
              label: 'Upload ZIP',
              children: (
                <div>
                  <Upload.Dragger
                    multiple={false}
                    beforeUpload={(file) => {
                      setFileList([file]);
                      return false;
                    }}
                    fileList={fileList.map((file) => ({ uid: file.name, name: file.name, status: 'done' }))}
                    onRemove={() => setFileList([])}
                    accept=".zip"
                  >
                    <p className="ant-upload-drag-icon">
                      <InboxOutlined />
                    </p>
                    <p className="ant-upload-text">Click or drag a ZIP file to upload</p>
                    <p className="ant-upload-hint">The archive must contain plugin.yaml at its root.</p>
                  </Upload.Dragger>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginTop: 16 }}
                    message="Only register plugins from sources you trust. The server runs them as shell scripts."
                  />
                  <Button
                    type="primary"
                    style={{ marginTop: 16 }}
                    loading={uploadMutation.isPending}
                    onClick={handleUpload}
                    disabled={fileList.length === 0}
                  >
                    Upload and register
                  </Button>
                </div>
              ),
            },
            {
              key: 'folder',
              label: 'Upload folder',
              children: (
                <div>
                  <input
                    ref={folderInputRef}
                    type="file"
                    multiple
                    // @ts-expect-error - non-standard attribute supported by Chromium/Firefox
                    webkitdirectory="true"
                    directory=""
                    style={{ display: 'none' }}
                    onChange={handleFolderSelected}
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={openFolderPicker}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openFolderPicker();
                      }
                    }}
                    style={{
                      padding: '40px 16px',
                      borderRadius: 8,
                      border: '2px dashed #d9d9d9',
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: '#fafafa',
                      transition: 'border-color 0.2s',
                    }}
                    onMouseEnter={(event) => {
                      (event.currentTarget as HTMLDivElement).style.borderColor = '#1677ff';
                    }}
                    onMouseLeave={(event) => {
                      (event.currentTarget as HTMLDivElement).style.borderColor = '#d9d9d9';
                    }}
                  >
                    <p style={{ fontSize: 48, color: '#1677ff', marginBottom: 8 }}>
                      <FolderOpenOutlined />
                    </p>
                    <p style={{ fontSize: 16 }}>Click to pick a plugin folder</p>
                    <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>
                      The folder must contain plugin.yaml at its root. File paths are preserved.
                    </p>
                  </div>

                  {folderFiles.length > 0 ? (
                    <>
                      <Space style={{ marginTop: 16, marginBottom: 8 }}>
                        <Tag color="blue">{folderFiles.length} files</Tag>
                        <Button
                          size="small"
                          icon={<DeleteOutlined />}
                          onClick={() => setFolderFiles([])}
                        >
                          Clear
                        </Button>
                      </Space>
                      <Table
                        rowKey="key"
                        size="small"
                        pagination={false}
                        columns={folderColumns}
                        dataSource={folderEntries}
                        scroll={{ y: 240 }}
                      />
                    </>
                  ) : null}

                  <Alert
                    type="info"
                    showIcon
                    style={{ marginTop: 16 }}
                    message="Folder contents are packaged on the server, then run through the same ZIP protections."
                  />
                  <Button
                    type="primary"
                    style={{ marginTop: 16 }}
                    loading={uploadFolderMutation.isPending}
                    onClick={handleFolderUpload}
                    disabled={folderFiles.length === 0}
                  >
                    Upload folder and register
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>
    </>
  );
}

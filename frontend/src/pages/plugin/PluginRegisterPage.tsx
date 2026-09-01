import React, { useRef, useState } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Form,
  Input,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message as antdMessage,
  theme as antdTheme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BranchesOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { useApiMutation } from '@/hooks/useApiMutation';
import {
  detectGitBranches,
  registerPlugin,
  uploadPlugin,
  uploadPluginFolder,
} from '@/api/plugin';
import { matchCredentials } from '@/api/credentials';
import { CredentialSelect } from '@/components/credential/CredentialSelect';
import type { PluginSourceRequest } from '@/types/plugin';

type GitForm = {
  url: string;
  credential_id?: string;
  branch?: string;
  tag?: string;
  revision?: string;
  commit?: string;
};
type HttpForm = { url: string; credential_id?: string };

type FolderEntry = {
  key: string;
  path: string;
  size: number;
};

export default function PluginRegisterPage(): React.JSX.Element {
  const { token } = antdTheme.useToken();
  const navigate = useNavigate();
  const [gitForm] = Form.useForm<GitForm>();
  const [httpForm] = Form.useForm<HttpForm>();
  const [fileList, setFileList] = useState<File[]>([]);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // Branch probe states
  const [isProbing, setIsProbing] = useState(false);
  const [detectedBranches, setDetectedBranches] = useState<string[]>([]);
  const [detectedTags, setDetectedTags] = useState<string[]>([]);

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

  const handleProbeBranches = async () => {
    const url = gitForm.getFieldValue('url')?.trim();
    if (!url) {
      antdMessage.warning('请先输入 Git 仓库 URL');
      return;
    }
    const credId = gitForm.getFieldValue('credential_id');
    setIsProbing(true);
    try {
      const res = await detectGitBranches(url, credId);
      setDetectedBranches(res.branches || []);
      setDetectedTags(res.tags || []);
      if (res.default_branch && !gitForm.getFieldValue('branch')) {
        gitForm.setFieldsValue({ branch: res.default_branch });
      }
      antdMessage.success(
        `成功探测到 ${res.branches.length} 个远程分支，${res.tags.length} 个标签`
      );
    } catch {
      antdMessage.error('无法连接或探测远程 Git 仓库，请检查 URL 或凭据配置');
    } finally {
      setIsProbing(false);
    }
  };

  const handleSubmit = async (kind: 'git' | 'http') => {
    if (kind === 'git') {
      try {
        const values = await gitForm.validateFields();
        const source: PluginSourceRequest = {
          type: 'git',
          url: values.url,
          branch: values.branch,
          tag: values.tag,
          revision: values.revision,
          commit: values.commit,
          credential_id: values.credential_id || undefined,
        };
        await registerMutation.mutateAsync(source);
        navigate('/plugin/list');
      } catch {
        // validation or mutation error already shown
      }
    } else {
      try {
        const values = await httpForm.validateFields();
        const source: PluginSourceRequest = {
          type: 'http',
          url: values.url,
          credential_id: values.credential_id || undefined,
        };
        await registerMutation.mutateAsync(source);
        navigate('/plugin/list');
      } catch {
        // validation or mutation error already shown
      }
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
              label: 'Git (私有/公开仓库)',
              children: (
                <Form layout="vertical" form={gitForm} style={{ maxWidth: 640 }}>
                  <Form.Item
                    name="url"
                    label="Git 仓库 URL"
                    rules={[{ required: true, message: '请输入 Git 仓库地址' }]}
                    tooltip="支持 HTTPS (如 https://github.com/org/repo.git) 或 SSH (如 git@github.com:org/repo.git)"
                  >
                    <Input
                      placeholder="https://gitee.com/org/my-plugin.git 或 git@github.com:org/repo.git"
                      onChange={(e) => {
                        const val = e.target.value?.trim();
                        if (val && !gitForm.getFieldValue('credential_id')) {
                          matchCredentials(val)
                            .then((matched) => {
                              const first = matched[0];
                              if (first && !gitForm.getFieldValue('credential_id')) {
                                gitForm.setFieldsValue({ credential_id: first.id });
                                antdMessage.info(`💡 已根据仓库域名自动匹配并选中凭据：${first.name}`);
                              }
                            })
                            .catch(() => {});
                        }
                      }}
                      addonAfter={
                        <Tooltip title="使用关联凭据快速探测远程仓库的分支与标签">
                          <Button
                            type="link"
                            size="small"
                            loading={isProbing}
                            icon={<SearchOutlined />}
                            onClick={handleProbeBranches}
                          >
                            探测分支
                          </Button>
                        </Tooltip>
                      }
                    />
                  </Form.Item>

                  <Form.Item
                    name="credential_id"
                    label="关联访问凭证 (Credential)"
                    tooltip="私有仓库必填。支持 Username/Password、Personal Access Token 或 SSH 私钥"
                  >
                    <CredentialSelect
                      placeholder="无需凭证 / 公开仓库 (Public)"
                      filterTypes={['username_password', 'secret_text', 'ssh_key']}
                      suggestedUrl={Form.useWatch('url', gitForm)}
                      onChange={(val) => {
                        gitForm.setFieldsValue({ credential_id: val });
                        if (gitForm.getFieldValue('url')) {
                          handleProbeBranches();
                        }
                      }}
                    />
                  </Form.Item>

                  <Form.Item
                    name="branch"
                    label={
                      <Space size={6}>
                        <span>目标分支 (Branch)</span>
                        {detectedBranches.length > 0 && (
                          <Tag color="success" style={{ fontSize: 11 }}>
                            已探测到 {detectedBranches.length} 个分支
                          </Tag>
                        )}
                      </Space>
                    }
                  >
                    <AutoComplete
                      placeholder="例如: main, master, release/v1.0"
                      options={detectedBranches.map((b) => ({
                        value: b,
                        label: (
                          <Space size={4}>
                            <BranchesOutlined style={{ color: token.colorPrimary }} />
                            <span>{b}</span>
                          </Space>
                        ),
                      }))}
                      filterOption={(inputValue, option) =>
                        String(option?.value || '').toLowerCase().includes(inputValue.toLowerCase())
                      }
                    />
                  </Form.Item>

                  {detectedTags.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>
                        快捷填入探测到的标签 Tag:
                      </Typography.Text>
                      <Space size={4} wrap>
                        {detectedTags.slice(0, 8).map((t) => (
                          <Tag
                            key={t}
                            color="blue"
                            style={{ cursor: 'pointer' }}
                            onClick={() => gitForm.setFieldsValue({ tag: t, branch: '' })}
                          >
                            {t}
                          </Tag>
                        ))}
                      </Space>
                    </div>
                  )}

                  <Form.Item name="tag" label="标签 (Tag，可选)">
                    <Input placeholder="例如: v1.0.0" />
                  </Form.Item>
                  <Form.Item name="revision" label="指定 Revision (可选)">
                    <Input placeholder="分支或 Tag 的别名" />
                  </Form.Item>
                  <Form.Item name="commit" label="指定 Commit Hash (可选)">
                    <Input placeholder="例如: a1b2c3d4" />
                  </Form.Item>

                  <Button
                    type="primary"
                    loading={registerMutation.isPending}
                    onClick={() => handleSubmit('git')}
                  >
                    安全拉取并注册插件 (Register from Git)
                  </Button>
                </Form>
              ),
            },
            {
              key: 'http',
              label: 'HTTP ZIP 链接',
              children: (
                <Form layout="vertical" form={httpForm} style={{ maxWidth: 640 }}>
                  <Form.Item
                    name="url"
                    label="插件压缩包下载 URL"
                    rules={[{ required: true, message: '请输入 HTTP/HTTPS 下载地址' }]}
                  >
                    <Input
                      placeholder="https://nexus.corp.internal/repository/plugins/hello-1.0.0.zip"
                      onChange={(e) => {
                        const val = e.target.value?.trim();
                        if (val && !httpForm.getFieldValue('credential_id')) {
                          matchCredentials(val)
                            .then((matched) => {
                              const first = matched[0];
                              if (first && !httpForm.getFieldValue('credential_id')) {
                                httpForm.setFieldsValue({ credential_id: first.id });
                                antdMessage.info(`💡 已根据下载域名自动匹配并选中凭据：${first.name}`);
                              }
                            })
                            .catch(() => {});
                        }
                      }}
                    />
                  </Form.Item>

                  <Form.Item
                    name="credential_id"
                    label="关联下载凭证 (可选)"
                    tooltip="若文件服务器需要 Basic Auth 账号密码或 Bearer Token 认证，请选择对应凭证"
                  >
                    <CredentialSelect
                      placeholder="无需认证 / 公开链接"
                      filterTypes={['username_password', 'secret_text']}
                      suggestedUrl={Form.useWatch('url', httpForm)}
                      onChange={(val) => {
                        httpForm.setFieldsValue({ credential_id: val });
                      }}
                    />
                  </Form.Item>

                  <Typography.Paragraph type="secondary">
                    后端将使用安全加密连接及凭据流式下载并自动校验解压。
                  </Typography.Paragraph>
                  <Button
                    type="primary"
                    loading={registerMutation.isPending}
                    onClick={() => handleSubmit('http')}
                  >
                    下载并注册插件 (Register from HTTP)
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
                    <p className="ant-upload-text">Click or drag a plugin ZIP here to upload</p>
                    <p className="ant-upload-hint">The archive must contain a plugin.yaml file.</p>
                  </Upload.Dragger>
                  <Button
                    type="primary"
                    style={{ marginTop: 16 }}
                    loading={uploadMutation.isPending}
                    onClick={handleUpload}
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
                    style={{ display: 'none' }}
                    onChange={handleFolderSelected}
                    {...({ webkitdirectory: '', directory: '', multiple: true } as unknown as Record<string, string>)}
                  />
                  <div
                    onClick={openFolderPicker}
                    style={{
                      border: `1px dashed ${token.colorBorder}`,
                      borderRadius: token.borderRadiusLG,
                      padding: '24px 16px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: token.colorFillAlter,
                      marginBottom: 16,
                    }}
                  >
                    <p style={{ fontSize: 32, margin: '0 0 8px', color: token.colorPrimary }}>
                      <FolderOpenOutlined />
                    </p>
                    <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 500 }}>
                      Click to choose a folder
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: token.colorTextSecondary }}>
                      All files in the folder (including plugin.yaml) will be uploaded together.
                    </p>
                  </div>

                  {folderFiles.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 8,
                        }}
                      >
                        <Typography.Text strong>
                          Selected: {folderFiles.length} file(s)
                        </Typography.Text>
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => setFolderFiles([])}
                        >
                          Clear
                        </Button>
                      </div>
                      <Table
                        size="small"
                        dataSource={folderEntries}
                        columns={folderColumns}
                        pagination={{ pageSize: 5 }}
                      />
                    </div>
                  )}

                  <Button
                    type="primary"
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

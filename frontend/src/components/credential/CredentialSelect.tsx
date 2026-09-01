import React, { useState } from 'react';
import { Button, Divider, Select, Space, Tag, Tooltip, theme as antdTheme } from 'antd';
import {
  FileProtectOutlined,
  KeyOutlined,
  LockOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import {
  type CredentialItem,
  type CredentialType,
  getCredentials,
} from '@/api/credentials';
import { useApiQuery } from '@/hooks/useApiQuery';
import { QuickCredentialModal } from './QuickCredentialModal';

export interface CredentialSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  filterTypes?: CredentialType[];
  suggestedUrl?: string;
  style?: React.CSSProperties;
  className?: string;
  showQuickCreateButton?: boolean;
}

export function CredentialSelect({
  value,
  onChange,
  placeholder = '无需认证 / 公开访问',
  allowClear = true,
  filterTypes,
  suggestedUrl,
  style,
  className,
  showQuickCreateButton = true,
}: CredentialSelectProps): React.JSX.Element {
  const { token } = antdTheme.useToken();
  const [modalOpen, setModalOpen] = useState(false);
  const { data: credentials = [], isLoading } = useApiQuery<CredentialItem[]>(
    ['credentials'],
    getCredentials
  );

  const safeCredentials = Array.isArray(credentials) ? credentials : [];
  const filteredList = filterTypes && filterTypes.length > 0
    ? safeCredentials.filter((c) => filterTypes.includes(c.type))
    : safeCredentials;

  const renderCredentialIcon = (type: CredentialType) => {
    switch (type) {
      case 'username_password':
        return <KeyOutlined style={{ color: '#1677ff' }} />;
      case 'secret_text':
        return <LockOutlined style={{ color: '#722ed1' }} />;
      case 'ssh_key':
        return <SafetyCertificateOutlined style={{ color: '#fa8c16' }} />;
      case 'secret_file':
        return <FileProtectOutlined style={{ color: '#13c2c2' }} />;
      default:
        return <KeyOutlined />;
    }
  };

  const renderOptionLabel = (c: CredentialItem) => {
    const scopeTag =
      c.scope === 'global' ? (
        <Tag color="green" style={{ margin: 0, fontSize: 11 }}>全局</Tag>
      ) : c.scope === 'team' ? (
        <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>团队</Tag>
      ) : (
        <Tag style={{ margin: 0, fontSize: 11 }}>私有</Tag>
      );

    return (
      <Space size={6} style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space size={6}>
          {renderCredentialIcon(c.type)}
          <span style={{ fontWeight: 500 }}>{c.name}</span>
          {c.data?.username && (
            <span style={{ fontSize: 11, color: token.colorTextSecondary }}>
              ({c.data.username})
            </span>
          )}
        </Space>
        {scopeTag}
      </Space>
    );
  };

  return (
    <>
      <Space.Compact style={{ width: '100%', ...style }} className={className}>
        <Select
          value={value || undefined}
          onChange={(val) => onChange?.(val || '')}
          placeholder={placeholder}
          allowClear={allowClear}
          loading={isLoading}
          style={{ flex: 1 }}
          options={[
            ...(allowClear ? [{ label: placeholder, value: '' }] : []),
            ...filteredList.map((c) => ({
              value: c.id,
              label: renderOptionLabel(c),
            })),
          ]}
          dropdownRender={(menu) => (
            <>
              {menu}
              <Divider style={{ margin: '6px 0' }} />
              <div style={{ padding: '0 8px 4px 8px' }}>
                <Button
                  type="link"
                  icon={<PlusOutlined />}
                  size="small"
                  onClick={() => setModalOpen(true)}
                  style={{ padding: 0, height: 'auto', fontWeight: 500 }}
                >
                  ➕ 快速新建凭据 (Quick Create)...
                </Button>
              </div>
            </>
          )}
        />
        {showQuickCreateButton && (
          <Tooltip title="快速新建安全访问凭证">
            <Button
              icon={<PlusOutlined />}
              onClick={() => setModalOpen(true)}
            />
          </Tooltip>
        )}
      </Space.Compact>

      <QuickCredentialModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        suggestedUrl={suggestedUrl}
        allowedTypes={filterTypes}
        onCreated={(newItem) => {
          onChange?.(newItem.id);
        }}
      />
    </>
  );
}

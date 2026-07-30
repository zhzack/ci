import React from "react";
import { Input, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

type Props = {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
};

export function SearchBar({ value, placeholder, onChange }: Props): React.JSX.Element {
  return (
    <Space>
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder={placeholder ?? 'Search'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ width: 240 }}
      />
    </Space>
  );
}

import React from "react";
import { YamlEditor } from '@/components/YamlEditor';
import { useState } from 'react';
import { Alert, Button, Form, Input, Space, Typography, message as antdMessage } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { useApiMutation } from '@/hooks/useApiMutation';
import { createPipeline } from '@/api/pipeline';

const TEMPLATE = `name: my-pipeline
params:
  greeting: hello
steps:
  - name: hello
    plugin: hello@1.0.0
    with:
      name: "\${{ params.greeting }}"
`;

export default function PipelineCreatePage(): React.JSX.Element {
  const navigate = useNavigate();
  const [definition, setDefinition] = useState(TEMPLATE);
  const [name, setName] = useState('');

  const create = useApiMutation(
    {
      mutationFn: (payload: { definition: string }) => createPipeline(payload),
    },
    [['pipelines']],
  );

  const handleSubmit = async () => {
    if (!name.trim()) {
      antdMessage.warning('Pipeline name is required');
      return;
    }
    if (!definition.includes(`name: ${name.trim()}`)) {
      antdMessage.warning('Pipeline name in the definition must match the Name field');
      return;
    }
    try {
      const record = await create.mutateAsync({ definition });
      navigate(`/pipeline/${record.id}`);
    } catch {
      // already surfaced
    }
  };

  return (
    <>
      <PageHeader
        title="Create pipeline"
        description="Paste a YAML definition. The server validates the DAG before persisting it."
      />
      <div className="app-content-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Alert
          type="info"
          showIcon
          message="The YAML must include name, optional params, and at least one step."
        />
        <Form layout="vertical">
          <Form.Item label="Display name (informational)">
            <Input
              placeholder="Optional, only used for the form"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Form.Item>
          <Form.Item label="Definition (YAML)">
            <YamlEditor
              value={definition}
              onChange={setDefinition}
              height={460}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            Use <code>$&#123;&#123; params.key &#125;&#125;</code>,{' '}
            <code>$&#123;&#123; steps.x.outputs.key &#125;&#125;</code>, and{' '}
            <code>$&#123;&#123; steps.x.artifacts.name.path &#125;&#125;</code> for parameter
            expressions.
          </Typography.Paragraph>
          <Space>
            <Button
              type="primary"
              loading={create.isPending}
              onClick={handleSubmit}
            >
              Save pipeline
            </Button>
            <Button onClick={() => navigate('/pipeline/list')}>Cancel</Button>
          </Space>
        </Form>
      </div>
    </>
  );
}

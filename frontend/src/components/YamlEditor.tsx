/**
 * Shared Monaco-based YAML editor with live syntax validation.
 *
 * Monaco is bundled locally (no runtime CDN dependency) and split into its
 * own cacheable chunk. Validation parses the text with js-yaml on every
 * change and surfaces parse errors as red markers in the gutter.
 */
import { useCallback, useRef } from 'react';
import Editor, { loader, type Monaco } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import yaml from 'js-yaml';

import { useThemeStore } from '@/store/theme';

// Wire the web worker locally; only the base editor worker is needed for
// YAML (tokenization is built into monaco-languages, there is no yaml LSP).
const workerEnv = self as unknown as { MonacoEnvironment?: unknown };
workerEnv.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
loader.config({ monaco });

interface YamlEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: number | string;
  readOnly?: boolean;
}

export function YamlEditor({
  value,
  onChange,
  height = 420,
  readOnly = false,
}: YamlEditorProps): React.JSX.Element {
  const theme = useThemeStore((state) => state.mode);
  const monacoRef = useRef<Monaco | null>(null);
  const modelRef = useRef<monacoEditor.ITextModel | null>(null);

  const validate = useCallback((text: string) => {
    const instance = monacoRef.current;
    const model = modelRef.current;
    if (!instance || !model) return;
    const markers: monacoEditor.IMarker[] = [];
    try {
      yaml.load(text);
    } catch (err) {
      const mark = (err as yaml.YAMLException).mark;
      const line = mark?.line != null ? mark.line + 1 : 1;
      const column = mark?.column != null ? mark.column + 1 : 1;
      const firstLine = String((err as Error).message).split('\n')[0] ?? '';
      markers.push({
        owner: 'mini-pipeline-yaml',
        resource: model.uri,
        message: firstLine === '' ? 'Invalid YAML' : firstLine,
        severity: instance.MarkerSeverity.Error,
        startLineNumber: line,
        startColumn: column,
        endLineNumber: line,
        endColumn: column + 1,
      });
    }
    instance.editor.setModelMarkers(model, 'mini-pipeline-yaml', markers);
  }, []);

  return (
    <div
      style={{
        border: '1px solid rgba(140, 140, 140, 0.35)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      <Editor
        height={height}
        language="yaml"
        theme={theme === 'dark' ? 'vs-dark' : 'vs'}
        value={value}
        onChange={(next) => {
          onChange(next ?? '');
          validate(next ?? '');
        }}
        onMount={(_editor, instance) => {
          monacoRef.current = instance;
          modelRef.current = instance.editor.getModels()[0] ?? null;
          validate(value);
        }}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 12,
          fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          renderWhitespace: 'selection',
          padding: { top: 8 },
        }}
      />
    </div>
  );
}

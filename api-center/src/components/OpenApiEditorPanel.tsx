import Editor from '@monaco-editor/react';
import { Alert, Box, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useRef } from 'react';
import type { OpenApiValidationIssue } from '../utils/openApiValidation';

export interface OpenApiEditorPanelProps {
  value: string;
  loading: boolean;
  dirty: boolean;
  error: string | null;
  validationMessage?: string | null;
  issues?: OpenApiValidationIssue[];
  onChange: (value: string) => void;
}

export function OpenApiEditorPanel({
  value,
  loading,
  dirty,
  error,
  validationMessage,
  issues = [],
  onChange,
}: OpenApiEditorPanelProps) {
  const editorRef = useRef<{
    getModel: () => unknown;
    revealLineInCenter: (lineNumber: number) => void;
    setPosition: (position: { lineNumber: number; column: number }) => void;
    focus: () => void;
  } | null>(null);
  const monacoRef = useRef<{
    editor: {
      setModelMarkers: (model: unknown, owner: string, markers: unknown[]) => void;
    };
  } | null>(null);

  const groupedIssues = useMemo(() => {
    const grouped = new Map<string, OpenApiValidationIssue[]>();
    for (const issue of issues) {
      const key = `${issue.endpointPath} | ${issue.method} | ${issue.responseStatus}`;
      const existing = grouped.get(key) ?? [];
      existing.push(issue);
      grouped.set(key, existing);
    }
    return Array.from(grouped.entries());
  }, [issues]);

  const handleIssueClick = (issue: OpenApiValidationIssue) => {
    if (!editorRef.current || !issue.line) {
      return;
    }
    editorRef.current.revealLineInCenter(issue.line);
    editorRef.current.setPosition({ lineNumber: issue.line, column: issue.column ?? 1 });
    editorRef.current.focus();
  };

  const applyMarkers = () => {
    if (!editorRef.current || !monacoRef.current) {
      return;
    }

    const model = editorRef.current.getModel();
    if (!model) {
      return;
    }

    const markers = issues
      .filter((issue) => typeof issue.line === 'number')
      .map((issue) => ({
        startLineNumber: issue.line ?? 1,
        startColumn: issue.column ?? 1,
        endLineNumber: issue.line ?? 1,
        endColumn: (issue.column ?? 1) + 2,
        message: `${issue.message} Suggested fix: ${issue.suggestion}`,
        severity: issue.severity === 'error' ? 8 : 4,
      }));
    monacoRef.current.editor.setModelMarkers(model, 'openapi-validation', markers);
  };

  useEffect(() => {
    applyMarkers();
  }, [issues]);

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;

  return (
    <Paper
      elevation={0}
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderRadius: 5,
        overflow: 'hidden',
        border: (theme) => `1px solid ${theme.palette.divider}`,
        boxShadow: '0 18px 42px rgba(15, 23, 42, 0.06)',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          px: 2.5,
          py: 2,
          borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
          bgcolor: 'background.paper',
          backgroundImage:
            'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(244,247,251,0.82))',
        }}
      >
        <Typography variant="h5">OpenAPI YAML Editor</Typography>
        <Typography variant="body2" color={dirty ? 'warning.main' : 'text.secondary'}>
          {dirty ? 'Unsaved changes' : 'Saved state'}
        </Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ m: 2, mb: 0 }}>{error}</Alert>}
      {!error && validationMessage && (
        <Alert severity="info" sx={{ m: 2, mb: 0 }}>
          {validationMessage}
        </Alert>
      )}
      {issues.length > 0 && (
        <Alert severity={errorCount > 0 ? 'error' : 'warning'} sx={{ m: 2, mb: 0 }}>
          Validation summary: {errorCount} error(s), {warningCount} warning(s).
        </Alert>
      )}
      {groupedIssues.length > 0 && (
        <Box
          sx={{
            mx: 2,
            mt: 1.5,
            mb: 0,
            border: (theme) => `1px solid ${theme.palette.divider}`,
            borderRadius: 2,
            maxHeight: 220,
            overflow: 'auto',
            p: 1,
          }}
        >
          <Typography variant="subtitle2" sx={{ px: 1, pb: 0.5 }}>
            Validation issues
          </Typography>
          {groupedIssues.map(([group, groupedGroupIssues]) => (
            <Box key={group} sx={{ px: 1, py: 0.75 }}>
              <Typography variant="caption" color="text.secondary">
                {group}
              </Typography>
              {groupedGroupIssues.map((issue) => (
                <Box
                  key={issue.id}
                  role="button"
                  onClick={() => handleIssueClick(issue)}
                  sx={{
                    mt: 0.5,
                    p: 1,
                    borderRadius: 1.5,
                    cursor: issue.line ? 'pointer' : 'default',
                    bgcolor:
                      issue.severity === 'error'
                        ? 'rgba(211, 47, 47, 0.08)'
                        : 'rgba(237, 108, 2, 0.08)',
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    [{issue.severity.toUpperCase()}] {issue.method} {issue.endpointPath} · field: {issue.field}
                  </Typography>
                  <Typography variant="body2">{issue.message}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Suggested fix: {issue.suggestion}
                  </Typography>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )}

      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {loading && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'background.paper',
              zIndex: 1,
            }}
          >
            <CircularProgress />
          </Box>
        )}
        <Editor
          height="100%"
          defaultLanguage="yaml"
          language="yaml"
          value={value}
          onChange={(nextValue) => onChange(nextValue ?? '')}
          onMount={(editor, monaco) => {
            editorRef.current = editor as unknown as typeof editorRef.current;
            monacoRef.current = monaco as unknown as typeof monacoRef.current;
            applyMarkers();
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: 'on',
            automaticLayout: true,
            scrollBeyondLastLine: false,
            tabSize: 2,
          }}
        />
      </Box>
    </Paper>
  );
}

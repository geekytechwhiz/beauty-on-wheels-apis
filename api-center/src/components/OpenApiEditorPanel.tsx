import Editor from '@monaco-editor/react';
import { Alert, Box, CircularProgress, Paper, Stack, Typography } from '@mui/material';

export interface OpenApiEditorPanelProps {
  value: string;
  loading: boolean;
  dirty: boolean;
  error: string | null;
  validationMessage?: string | null;
  onChange: (value: string) => void;
}

export function OpenApiEditorPanel({
  value,
  loading,
  dirty,
  error,
  validationMessage,
  onChange,
}: OpenApiEditorPanelProps) {
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

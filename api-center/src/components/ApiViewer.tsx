import { Suspense, lazy, useMemo, type ReactNode } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  Paper,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import 'swagger-ui-react/swagger-ui.css';

const SwaggerPanel = lazy(() =>
  import('./SwaggerPanel').then((m) => ({ default: m.SwaggerPanel })),
);
const RedocPanel = lazy(() =>
  import('./RedocPanel').then((m) => ({ default: m.RedocPanel })),
);

export type ViewerKind = 'swagger' | 'redoc';

export interface ApiViewerProps {
  viewer: ViewerKind;
  onViewerChange: (v: ViewerKind) => void;
  specUrl?: string;
  spec?: object;
  loading: boolean;
  error: Error | null;
  title: string;
  placeholder?: string;
  actions?: ReactNode;
}

export function ApiViewer({
  viewer,
  onViewerChange,
  specUrl,
  spec,
  loading,
  error,
  title,
  placeholder,
  actions,
}: ApiViewerProps) {
  const stableSpecUrl = useMemo(() => specUrl, [specUrl]);
  const stableSpec = useMemo(() => spec, [spec]);

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
        border: (t) => `1px solid ${t.palette.divider}`,
        boxShadow: '0 18px 42px rgba(15, 23, 42, 0.06)',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
          px: 2.5,
          py: 2,
          borderBottom: (t) => `1px solid ${t.palette.divider}`,
          bgcolor: 'background.paper',
          backgroundImage:
            'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(244,247,251,0.82))',
        }}
      >
        <Typography variant="h5" component="h1">
          {title}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={viewer}
            onChange={(_, v: ViewerKind | null) => v && onViewerChange(v)}
          >
            <ToggleButton value="swagger">Swagger UI</ToggleButton>
            <ToggleButton value="redoc">Redoc</ToggleButton>
          </ToggleButtonGroup>
          {actions}
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'auto' }}>
        {loading && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'background.paper',
              zIndex: 2,
            }}
          >
            <CircularProgress />
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error.message}
          </Alert>
        )}
        {!loading && !error && (stableSpec || stableSpecUrl) && (
          <Suspense
            fallback={
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
              </Box>
            }
          >
            {viewer === 'swagger' ? (
              <SwaggerPanel spec={stableSpec} url={stableSpecUrl} />
            ) : (
              <RedocPanel spec={stableSpec} specUrl={stableSpecUrl} />
            )}
          </Suspense>
        )}
        {!loading && !error && !stableSpec && !stableSpecUrl && placeholder && (
          <Alert severity="info" sx={{ m: 2 }}>
            {placeholder}
          </Alert>
        )}
        {!loading && !error && !stableSpec && !stableSpecUrl && !placeholder && (
          <Typography color="text.secondary" sx={{ p: 3 }}>
            No specification loaded.
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

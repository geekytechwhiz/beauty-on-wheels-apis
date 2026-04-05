import { Suspense, lazy, useMemo } from 'react';
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
  spec: object | undefined;
  loading: boolean;
  error: Error | null;
  title: string;
}

export function ApiViewer({
  viewer,
  onViewerChange,
  spec,
  loading,
  error,
  title,
}: ApiViewerProps) {
  const stableSpec = useMemo(() => spec, [spec]);

  return (
    <Paper
      elevation={0}
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderRadius: 2,
        overflow: 'hidden',
        border: (t) => `1px solid ${t.palette.divider}`,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
          px: 2,
          py: 1.5,
          borderBottom: (t) => `1px solid ${t.palette.divider}`,
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="h6" component="h1">
          {title}
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={viewer}
          onChange={(_, v: ViewerKind | null) => v && onViewerChange(v)}
        >
          <ToggleButton value="swagger">Swagger UI</ToggleButton>
          <ToggleButton value="redoc">Redoc</ToggleButton>
        </ToggleButtonGroup>
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
        {!loading && !error && stableSpec && (
          <Suspense
            fallback={
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
              </Box>
            }
          >
            {viewer === 'swagger' ? (
              <SwaggerPanel spec={stableSpec} />
            ) : (
              <RedocPanel spec={stableSpec} />
            )}
          </Suspense>
        )}
        {!loading && !error && !stableSpec && (
          <Typography color="text.secondary" sx={{ p: 3 }}>
            No specification loaded.
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

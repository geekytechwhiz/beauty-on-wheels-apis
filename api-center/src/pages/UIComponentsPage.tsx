import { useMemo, useRef, useState } from 'react';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

export function UIComponentsPage() {
  const iframeContainerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const storybookUrl = useMemo(
    () => import.meta.env.VITE_STORYBOOK_URL?.trim() ?? '',
    [],
  );

  const handleFullscreenToggle = async () => {
    if (!iframeContainerRef.current) {
      return;
    }

    if (!document.fullscreenElement) {
      await iframeContainerRef.current.requestFullscreen();
      setFullscreen(true);
      return;
    }

    await document.exitFullscreen();
    setFullscreen(false);
  };

  if (!storybookUrl) {
    return (
      <Alert severity="info">
        Set `VITE_STORYBOOK_URL` to connect your Storybook workspace to the Developer Hub.
      </Alert>
    );
  }

  return (
    <Stack spacing={2.5} sx={{ height: '100%' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
      >
        <Box>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
            Embedded design system
          </Typography>
          <Typography variant="h4" sx={{ mb: 0.75 }}>
            UI Components
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 720 }}>
            Browse the shared component library directly from Storybook.
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button
            variant="outlined"
            startIcon={fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            onClick={() => void handleFullscreenToggle()}
          >
            {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </Button>
          <Button
            variant="contained"
            startIcon={<OpenInNewIcon />}
            component="a"
            href={storybookUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Storybook
          </Button>
        </Stack>
      </Stack>

      <Paper
        ref={iframeContainerRef}
        elevation={0}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
          borderRadius: 5,
          border: (theme) => `1px solid ${theme.palette.divider}`,
          boxShadow: '0 18px 42px rgba(15, 23, 42, 0.06)',
        }}
      >
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
        <Box
          component="iframe"
          title="Storybook"
          src={storybookUrl}
          onLoad={() => setLoading(false)}
          sx={{ width: '100%', height: '100%', border: 0, minHeight: '70vh' }}
        />
      </Paper>
    </Stack>
  );
}

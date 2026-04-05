import { useState } from 'react';
import {
  AppBar,
  Box,
  Chip,
  CssBaseline,
  IconButton,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import AddIcon from '@mui/icons-material/Add';
import { useQuery } from '@tanstack/react-query';
import {
  fetchHealth,
  fetchMergedSpec,
  fetchServiceSpec,
  fetchServices,
  getApiBase,
} from './api';
import { ApiViewer, type ViewerKind } from './components/ApiViewer';
import { RegisterServiceDialog } from './components/RegisterServiceDialog';
import { Sidebar } from './components/Sidebar';

const DRAWER_WIDTH = 280;

export default function App() {
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerKind>('swagger');

  const apiBase = getApiBase();

  const healthQuery = useQuery({
    queryKey: ['health', apiBase],
    queryFn: fetchHealth,
    refetchInterval: 60_000,
    retry: 1,
  });

  const servicesQuery = useQuery({
    queryKey: ['services', apiBase],
    queryFn: fetchServices,
  });

  const specQuery = useQuery({
    queryKey: ['spec', apiBase, selectedService ?? 'merged'],
    queryFn: () =>
      selectedService === null
        ? fetchMergedSpec()
        : fetchServiceSpec(selectedService),
  });

  const title =
    selectedService === null
      ? 'All services (merged)'
      : `Service: ${selectedService}`;

  const healthOk = healthQuery.data?.status === 'ok';
  const healthLabel =
    healthQuery.isLoading ? 'Health…' : healthOk ? 'API OK' : 'API unreachable';

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        sx={{
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { md: `${DRAWER_WIDTH}px` },
        }}
      >
        <Toolbar>
          {!isMdUp && (
            <IconButton
              color="inherit"
              edge="start"
              onClick={() => setMobileOpen(true)}
              sx={{ mr: 2 }}
              aria-label="open menu"
            >
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            API Aggregator
          </Typography>
          <Tooltip title={`Base: ${apiBase}`}>
            <Chip
              size="small"
              label={healthLabel}
              color={healthQuery.isLoading ? 'default' : healthOk ? 'success' : 'error'}
              sx={{ mr: 1 }}
            />
          </Tooltip>
          <Tooltip title="Register a service (POST /services)">
            <IconButton
              color="inherit"
              aria-label="register service"
              onClick={() => setRegisterOpen(true)}
            >
              <AddIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Sidebar
        services={servicesQuery.data ?? []}
        loading={servicesQuery.isLoading}
        error={servicesQuery.error as Error | null}
        selectedService={selectedService}
        onSelect={setSelectedService}
        drawerWidth={DRAWER_WIDTH}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 2,
          pt: { xs: 10, sm: 10 },
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <ApiViewer
          viewer={viewer}
          onViewerChange={setViewer}
          spec={specQuery.data as object | undefined}
          loading={specQuery.isLoading}
          error={specQuery.error as Error | null}
          title={title}
        />
      </Box>

      <RegisterServiceDialog open={registerOpen} onClose={() => setRegisterOpen(false)} />
    </Box>
  );
}

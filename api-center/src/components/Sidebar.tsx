import {
  Box,
  CircularProgress,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { serviceListSecondary, type ServiceRegistryEntry } from '../api';

export interface SidebarProps {
  services: ServiceRegistryEntry[];
  loading: boolean;
  error: Error | null;
  selectedService: string | null;
  onSelect: (name: string | null) => void;
  drawerWidth: number;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({
  services,
  loading,
  error,
  selectedService,
  onSelect,
  drawerWidth,
  mobileOpen,
  onMobileClose,
}: SidebarProps) {
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));

  const list = (
    <>
      <Toolbar sx={{ px: 2 }}>
        <Typography variant="subtitle2" color="text.secondary">
          Services
        </Typography>
      </Toolbar>
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={28} />
        </Box>
      )}
      {error && (
        <Typography color="error" variant="body2" sx={{ px: 2, py: 1 }}>
          {error.message}
        </Typography>
      )}
      <List dense disablePadding>
        <ListItemButton
          selected={selectedService === null}
          onClick={() => {
            onSelect(null);
            if (!isMdUp) onMobileClose();
          }}
        >
          <ListItemText primary="All services" secondary="Merged OpenAPI" />
        </ListItemButton>
        {services.map((s) => (
          <ListItemButton
            key={s.name}
            selected={selectedService === s.name}
            onClick={() => {
              onSelect(s.name);
              if (!isMdUp) onMobileClose();
            }}
          >
            <ListItemText
              primary={s.name}
              secondary={serviceListSecondary(s)}
              secondaryTypographyProps={{ noWrap: true, title: s.versions[s.latest]?.url }}
            />
          </ListItemButton>
        ))}
      </List>
    </>
  );

  return (
    <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' },
        }}
      >
        {list}
      </Drawer>
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' },
        }}
        open
      >
        {list}
      </Drawer>
    </Box>
  );
}

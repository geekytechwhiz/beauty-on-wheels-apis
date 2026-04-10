import SearchIcon from '@mui/icons-material/Search';
import {
  Box,
  CircularProgress,
  Drawer,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  formatServiceSecondaryText,
  type ServiceCatalogEntry,
} from '../services/S3Service';

export interface ApiCatalogProps {
  services: ServiceCatalogEntry[];
  loading: boolean;
  error: Error | null;
  selectedService: string | null;
  searchTerm: string;
  drawerWidth: number;
  mobileOpen: boolean;
  topOffset?: { xs: number; sm: number };
  onSearchTermChange: (value: string) => void;
  onSelectService: (serviceName: string | null) => void;
  onMobileClose: () => void;
}

export function ApiCatalog({
  services,
  loading,
  error,
  selectedService,
  searchTerm,
  drawerWidth,
  mobileOpen,
  topOffset = { xs: 0, sm: 0 },
  onSearchTermChange,
  onSelectService,
  onMobileClose,
}: ApiCatalogProps) {
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredServices = services.filter((service) =>
    service.name.toLowerCase().includes(normalizedSearch),
  );

  const handleSelect = (serviceName: string | null) => {
    onSelectService(serviceName);
    if (!isMdUp) {
      onMobileClose();
    }
  };

  const list = (
    <>
      <Toolbar sx={{ px: 2, pt: 1.5, pb: 0.5, display: 'flex', alignItems: 'stretch' }}>
        <Box sx={{ width: '100%' }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            API catalog
          </Typography>
          <TextField
            size="small"
            fullWidth
            placeholder="Search services"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 999,
                backgroundColor: (theme) => alpha(theme.palette.common.white, 0.75),
              },
            }}
          />
        </Box>
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
      <List dense disablePadding sx={{ px: 1, pb: 2 }}>
       
        {filteredServices.map((service) => (
          <ListItemButton
            key={service.name}
            selected={selectedService === service.name}
            onClick={() => handleSelect(service.name)}
          >
            <ListItemText
              primary={service.name}
              secondary={formatServiceSecondaryText(service)}
              primaryTypographyProps={{
                fontWeight: 700,
                fontSize: '0.95rem',
              }}
              secondaryTypographyProps={{
                fontSize: '0.8rem',
                color: 'text.secondary',
              }}
            />
          </ListItemButton>
        ))}
        {!loading && !error && filteredServices.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
            No services match your search.
          </Typography>
        )}
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
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            top: { xs: `${topOffset.xs}px`, sm: `${topOffset.sm}px` },
            height: {
              xs: `calc(100% - ${topOffset.xs}px)`,
              sm: `calc(100% - ${topOffset.sm}px)`,
            },
          },
        }}
      >
        {list}
      </Drawer>
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            top: `${topOffset.sm}px`,
            height: `calc(100% - ${topOffset.sm}px)`,
          },
        }}
        open
      >
        {list}
      </Drawer>
    </Box>
  );
}

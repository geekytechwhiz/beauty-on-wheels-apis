import { alpha } from '@mui/material/styles';
import { AppBar, Box, Chip, Stack, Tab, Tabs, Toolbar, Typography } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';

export const DEVELOPER_HUB_TOP_OFFSET = { xs: 64, sm: 72 };

const NAV_ITEMS = [
  { label: 'API Center', path: '/api-center' },
  { label: 'UI Components', path: '/ui-components' },
  { label: 'Design Library', path: '/design-library' },
];

function getActivePath(pathname: string): string {
  const match = NAV_ITEMS.find((item) => pathname.startsWith(item.path));
  return match?.path ?? '/api-center';
}

export function TopNavBar() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <AppBar
      position="fixed"
      color="default"
      elevation={0}
      sx={{
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: (theme) => alpha(theme.palette.background.paper, 0.84),
      }}
    >
      <Toolbar
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          px: { xs: 2, sm: 3 },
          minHeight: { xs: DEVELOPER_HUB_TOP_OFFSET.xs, sm: DEVELOPER_HUB_TOP_OFFSET.sm },
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 'fit-content' }}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: (theme) =>
                `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
              boxShadow: (theme) => `0 0 0 6px ${alpha(theme.palette.primary.main, 0.12)}`,
            }}
          />
          <Box>
            <Typography variant="subtitle2" color="text.secondary" sx={{ lineHeight: 1 }}>
                           </Typography>
            <Typography variant="h6" color="text.primary" sx={{ whiteSpace: 'nowrap', lineHeight: 1.1 }}>
              MyVitalRx Developer Hub
            </Typography>
          </Box>
        </Stack>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Tabs
            value={getActivePath(location.pathname)}
            onChange={(_, value: string) => navigate(value)}
            aria-label="Developer Hub sections"
            textColor="primary"
            indicatorColor="primary"
            variant="scrollable"
            scrollButtons="auto"
          >
            {NAV_ITEMS.map((item) => (
              <Tab key={item.path} value={item.path} label={item.label} />
            ))}
          </Tabs>
        </Box>
        <Chip label="Internal" color="primary" variant="outlined" sx={{ display: { xs: 'none', lg: 'inline-flex' } }} />
      </Toolbar>
    </AppBar>
  );
}

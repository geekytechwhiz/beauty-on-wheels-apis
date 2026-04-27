import { Box, Toolbar } from '@mui/material';
import { Navigate, Route, Routes } from 'react-router-dom';
import { DEVELOPER_HUB_TOP_OFFSET, TopNavBar } from './components/TopNavBar';
import { ApiCenterPage } from './pages/ApiCenter/ApiCenterPage';
import { DesignLibraryPage } from './pages/DesignLibraryPage';
import { UIComponentsPage } from './pages/UIComponentsPage';

function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        px: { xs: 2, sm: 3 },
        py: { xs: 2.5, sm: 3.5 },
        minHeight: `calc(100vh - ${DEVELOPER_HUB_TOP_OFFSET.sm}px)`,
        bgcolor: 'background.default',
      }}
    >
      {children}
    </Box>
  );
}

export default function DeveloperHubApp() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <TopNavBar />
      <Toolbar
        sx={{
          minHeight: { xs: DEVELOPER_HUB_TOP_OFFSET.xs, sm: DEVELOPER_HUB_TOP_OFFSET.sm },
        }}
      />
      <Routes>
        <Route path="/" element={<Navigate to="/api-center" replace />} />
        <Route
          path="/api-center"
          element={<ApiCenterPage topOffset={DEVELOPER_HUB_TOP_OFFSET} />}
        />
        <Route
          path="/ui-components"
          element={
            <PageContainer>
              <UIComponentsPage />
            </PageContainer>
          }
        />
        <Route
          path="/design-library"
          element={
            <PageContainer>
              <DesignLibraryPage />
            </PageContainer>
          }
        />
      </Routes>
    </Box>
  );
}

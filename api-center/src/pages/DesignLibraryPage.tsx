import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { loadDesignLibraryEntries } from '../services/specCatalogService';

export function DesignLibraryPage() {
  const designsQuery = useQuery({
    queryKey: ['figma-design-library'],
    queryFn: loadDesignLibraryEntries,
  });

  if (designsQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (designsQuery.error instanceof Error) {
    return <Alert severity="error">{designsQuery.error.message}</Alert>;
  }

  if ((designsQuery.data?.length ?? 0) === 0) {
    return (
      <Alert severity="info">
        No Figma designs were found. Add entries to `public/figma/designs.json` in this repo to populate the Design Library.
      </Alert>
    );
  }

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
          Shared design references
        </Typography>
        <Typography variant="h4" sx={{ mb: 0.75 }}>
          Design Library
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 760 }}>
          Shared Figma assets and flows for the developer experience team.
        </Typography>
      </Box>

      <Grid container spacing={2}>
        {designsQuery.data?.map((design) => (
          <Grid key={design.figmaUrl} item xs={12} md={6} xl={4}>
            <Card
              elevation={0}
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 5,
                border: (theme) => `1px solid ${theme.palette.divider}`,
                boxShadow: '0 18px 42px rgba(15, 23, 42, 0.06)',
              }}
            >
              <CardContent sx={{ flex: 1 }}>
                <Stack spacing={1.5}>
                  <Typography variant="h6">{design.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {design.description}
                  </Typography>
                  {design.updatedAt && (
                    <Chip
                      label={`Updated ${design.updatedAt}`}
                      size="small"
                      variant="outlined"
                      sx={{ alignSelf: 'flex-start' }}
                    />
                  )}
                </Stack>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2 }}>
                <Button
                  variant="contained"
                  endIcon={<OpenInNewIcon />}
                  component="a"
                  href={design.figmaUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Figma
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
}

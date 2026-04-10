import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import type { OpenApiSpecFile } from '../services/S3Service';

export interface VersionSelectorProps {
  serviceName: string | null;
  versions: OpenApiSpecFile[];
  selectedVersion: string | null;
  loading: boolean;
  onChange: (version: string) => void;
}

export function VersionSelector({
  serviceName,
  versions,
  selectedVersion,
  loading,
  onChange,
}: VersionSelectorProps) {
  const isDisabled = serviceName === null || versions.length === 0 || loading;

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2} 
      alignItems={{ xs: 'stretch', sm: 'center' }}
      sx={{ minWidth: 0 }}
    >
      <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          Version history
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0 }}>
        {serviceName === null
          ? 'Select a service to browse versions.'
          : loading
            ? `Loading versions for ${serviceName}...`
            : versions.length > 0
              ? `Showing ${versions.length} version${versions.length === 1 ? '' : 's'} for ${serviceName}.`
              : `No versions found for ${serviceName}.`}
        </Typography>
      </Stack>
      <FormControl size="small" sx={{ minWidth: 220 }} disabled={isDisabled}>
        <InputLabel id="version-selector-label">Version history</InputLabel>
        <Select
          labelId="version-selector-label"
          value={selectedVersion ?? ''}
          label="Version history"
          onChange={(event) => onChange(event.target.value)}
        >
          {versions.map((version) => (
            <MenuItem key={version.version} value={version.version}>
              {version.version}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  );
}

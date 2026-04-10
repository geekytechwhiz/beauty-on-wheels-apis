import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  LinearProgress,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  getFileExtension,
  getNextVersionForService,
  type ServiceCatalogEntry,
  type VersionBumpType,
} from '../services/S3Service';

export interface UploadOpenApiSpecValues {
  serviceName: string;
  version: string;
  file: File;
}

export interface UploadOpenApiSpecProps {
  open: boolean;
  uploading: boolean;
  error: string | null;
  services: ServiceCatalogEntry[];
  onClose: () => void;
  onUpload: (values: UploadOpenApiSpecValues) => void;
}

export function UploadOpenApiSpec({
  open,
  uploading,
  error,
  services,
  onClose,
  onUpload,
}: UploadOpenApiSpecProps) {
  const [serviceName, setServiceName] = useState('');
  const [versionBump, setVersionBump] = useState<VersionBumpType>('minor');
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || uploading) {
      return;
    }

    setServiceName('');
    setVersionBump('minor');
    setFile(null);
    setLocalError(null);
  }, [open, uploading]);

  const matchingService = useMemo(
    () =>
      services.find(
        (service) => service.name.toLowerCase() === serviceName.trim().toLowerCase(),
      ) ?? null,
    [serviceName, services],
  );

  const nextVersionState = useMemo(() => {
    if (!serviceName.trim()) {
      return { nextVersion: null, error: null };
    }

    try {
      return {
        nextVersion: getNextVersionForService(matchingService, versionBump),
        error: null,
      };
    } catch (bumpError) {
      return {
        nextVersion: null,
        error:
          bumpError instanceof Error
            ? bumpError.message
            : 'Unable to compute the next version.',
      };
    }
  }, [matchingService, serviceName, versionBump]);

  const handleSubmit = () => {
    if (!serviceName.trim()) {
      setLocalError('Service name is required.');
      return;
    }
    if (!nextVersionState.nextVersion) {
      setLocalError(nextVersionState.error ?? 'Unable to determine the next version.');
      return;
    }
    if (nextVersionState.error) {
      setLocalError('Unable to determine the next version.');
      return;
    }
    if (!file) {
      setLocalError('Select an OpenAPI file to upload.');
      return;
    }
    if (!getFileExtension(file.name)) {
      setLocalError('Only .yaml, .yml, and .json files are supported.');
      return;
    }

    setLocalError(null);
    onUpload({
      serviceName: serviceName.trim(),
      version: nextVersionState.nextVersion,
      file,
    });
  };

  const displayError = localError ?? error;

  return (
    <Dialog open={open} onClose={uploading ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Upload OpenAPI spec</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <TextField
          required
          autoFocus
          label="Service name"
          value={serviceName}
          onChange={(event) => setServiceName(event.target.value)}
          placeholder="user-service"
          fullWidth
          disabled={uploading}
        />
        <FormControl disabled={uploading}>
          <FormLabel id="version-bump-label">Version increment</FormLabel>
          <RadioGroup
            row
            aria-labelledby="version-bump-label"
            value={versionBump}
            onChange={(event) => setVersionBump(event.target.value as VersionBumpType)}
          >
            <FormControlLabel value="major" control={<Radio />} label="Major" />
            <FormControlLabel value="minor" control={<Radio />} label="Minor" />
            <FormControlLabel value="patch" control={<Radio />} label="Patch" />
          </RadioGroup>
        </FormControl>
        <Stack spacing={0.5}>
          <Typography variant="body2" color="text.secondary">
            {matchingService
              ? `Latest version: ${matchingService.latestVersion}`
              : 'New service: first upload will start from v1.0.0.'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {nextVersionState.nextVersion
              ? `Next version: ${nextVersionState.nextVersion}`
              : nextVersionState.error ?? 'Enter a service name to calculate the next version.'}
          </Typography>
        </Stack>
        <Stack spacing={1}>
          <Button variant="outlined" component="label" disabled={uploading}>
            {file ? 'Replace file' : 'Choose file'}
            <input
              hidden
              type="file"
              accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setFile(nextFile);
                setLocalError(null);
              }}
            />
          </Button>
          <Typography variant="body2" color="text.secondary">
            {file ? file.name : 'Supported formats: .yaml, .yml, .json'}
          </Typography>
        </Stack>
        {uploading && (
          <Stack spacing={1}>
            <LinearProgress />
            <Typography variant="body2" color="text.secondary">
              Uploading spec to S3...
            </Typography>
          </Stack>
        )}
        {displayError && <Alert severity="error">{displayError}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={uploading}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

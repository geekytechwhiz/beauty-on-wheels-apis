import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import type { VersionBumpType } from '../services/S3Service';

export interface SaveEditedSpecDialogProps {
  open: boolean;
  serviceName: string | null;
  sourceVersion: string | null;
  latestVersion: string | null;
  nextVersion: string | null;
  versionBump: VersionBumpType;
  allowMajorIncrement: boolean;
  loading: boolean;
  error: string | null;
  publishBlockedReason?: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onVersionBumpChange: (value: VersionBumpType) => void;
}

export function SaveEditedSpecDialog({
  open,
  serviceName,
  sourceVersion,
  latestVersion,
  nextVersion,
  versionBump,
  allowMajorIncrement,
  loading,
  error,
  publishBlockedReason,
  onClose,
  onConfirm,
  onVersionBumpChange,
}: SaveEditedSpecDialogProps) {
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Save edited spec</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          Immutable version save
        </Typography>
        <Stack spacing={0.5}>
          <Typography variant="body2" color="text.secondary">
            {serviceName
              ? `Service: ${serviceName}`
              : 'Select a service and version before saving.'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {sourceVersion ? `Editing version: ${sourceVersion}` : 'No version selected.'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {latestVersion ? `Latest saved version: ${latestVersion}` : 'No saved version found.'}
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <FormLabel>Version increment</FormLabel>
          <RadioGroup
            value={versionBump}
            onChange={(event) => onVersionBumpChange(event.target.value as VersionBumpType)}
          >
            <FormControlLabel value="patch" control={<Radio />} label="Patch" />
            <FormControlLabel value="minor" control={<Radio />} label="Minor" />
            <FormControlLabel
              value="major"
              control={<Radio />}
              label="Major"
              disabled={!allowMajorIncrement}
            />
          </RadioGroup>
          {!allowMajorIncrement && (
            <Typography variant="caption" color="text.secondary">
              Major increments are blocked unless the runtime admin toggle is enabled.
            </Typography>
          )}
        </Stack>

        <Alert severity="info">
          {nextVersion
            ? `Saving will create a new immutable version: ${nextVersion}`
            : 'Unable to determine the next version yet.'}
        </Alert>

        {error && <Alert severity="error">{error}</Alert>}
        {publishBlockedReason && <Alert severity="error">{publishBlockedReason}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          disabled={!nextVersion || loading || Boolean(publishBlockedReason)}
        >
          {loading ? 'Saving…' : 'Save as new version'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

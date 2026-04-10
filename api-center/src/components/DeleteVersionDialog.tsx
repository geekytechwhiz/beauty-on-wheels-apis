import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

export interface DeleteVersionDialogProps {
  open: boolean;
  serviceName: string | null;
  version: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteVersionDialog({
  open,
  serviceName,
  version,
  loading,
  error,
  onClose,
  onConfirm,
}: DeleteVersionDialogProps) {
  const hasSelection = serviceName !== null && version !== null;

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Delete version</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          Destructive action
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {hasSelection
            ? `Delete ${serviceName} ${version} from API Center. This removes the spec file for that version.`
            : 'Select a service version before attempting deletion.'}
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={onConfirm}
          disabled={!hasSelection || loading}
        >
          {loading ? 'Deleting…' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

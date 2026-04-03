import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiBase, registerService, type RegisterServicePayload } from '../api';

export interface RegisterServiceDialogProps {
  open: boolean;
  onClose: () => void;
}

export function RegisterServiceDialog({ open, onClose }: RegisterServiceDialogProps) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [version, setVersion] = useState('v1');
  const [module, setModule] = useState('');
  const [rules, setRules] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: RegisterServicePayload) => registerService(payload),
    onSuccess: () => {
      const base = getApiBase();
      void qc.invalidateQueries({ queryKey: ['services', base] });
      void qc.invalidateQueries({ queryKey: ['spec', base] });
      void qc.invalidateQueries({ queryKey: ['health', base] });
      setName('');
      setUrl('');
      setVersion('v1');
      setModule('');
      setRules('');
      onClose();
    },
  });

  const handleSubmit = () => {
    const payload: RegisterServicePayload = {
      name: name.trim(),
      url: url.trim(),
      version: version.trim() || 'v1',
    };
    if (module.trim()) payload.module = module.trim();
    const ruleList = rules
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    if (ruleList.length) payload.rules = ruleList;
    mutation.mutate(payload);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Register service</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <TextField
          required
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="order-service"
          fullWidth
          autoFocus
        />
        <TextField
          required
          label="OpenAPI URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/swagger.json"
          fullWidth
        />
        <TextField
          label="Version"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="v1"
          fullWidth
        />
        <TextField
          label="Module (optional)"
          value={module}
          onChange={(e) => setModule(e.target.value)}
          fullWidth
        />
        <TextField
          label="Rules (optional, comma-separated)"
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          placeholder="auth-required, pii"
          fullWidth
        />
        {mutation.isError && (
          <Alert severity="error">{(mutation.error as Error).message}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!name.trim() || !url.trim() || mutation.isPending}
        >
          {mutation.isPending ? 'Registering…' : 'Register'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

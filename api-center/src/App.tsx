import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  type AlertColor,
  AppBar,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  Snackbar,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiViewer, type ViewerKind } from './components/ApiViewer';
import { ApiCatalog } from './components/ApiCatalog';
import { DeleteVersionDialog } from './components/DeleteVersionDialog';
import { OpenApiEditorPanel } from './components/OpenApiEditorPanel';
import { SaveEditedSpecDialog } from './components/SaveEditedSpecDialog';
import { UploadOpenApiSpec, type UploadOpenApiSpecValues } from './components/UploadOpenApiSpec';
import { VersionSelector } from './components/VersionSelector';
import {
  validateOpenApiForEditor,
  type OpenApiValidationIssue,
} from './utils/openApiValidation';
import {
  canWriteSpecsLocally,
  computeNextVersion,
  deleteSpecVersion,
  getCatalogSummary,
  loadEditableSpecDocument,
  listServices,
  listVersions,
  parseOpenApiText,
  saveEditedSpecVersion,
  type SpecReviewStatus,
  type VersionBumpType,
  updateSpecReviewStatus,
  uploadSpec,
} from './services/specCatalogService';

const DRAWER_WIDTH = 280;
const MERGED_VIEW_PLACEHOLDER =
  'Select a service and version to load documentation directly from the catalog.';

type EditorLayoutMode = 'preview' | 'editor' | 'split';

interface ToastState {
  open: boolean;
  severity: AlertColor;
  message: string;
}

function getStatusChipColor(status: SpecReviewStatus): 'warning' | 'success' | 'error' {
  switch (status) {
    case 'approved':
      return 'success';
    case 'rejected':
      return 'error';
    case 'pending':
    default:
      return 'warning';
  }
}

export interface ApiCenterAppProps {
  topOffset?: { xs: number; sm: number };
}

export default function App({
  topOffset = { xs: 0, sm: 0 },
}: ApiCenterAppProps) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerKind>('swagger');
  const [editorLayoutMode, setEditorLayoutMode] = useState<EditorLayoutMode>('preview');
  const [majorVersionAdminEnabled, setMajorVersionAdminEnabled] = useState(false);
  const [saveVersionBump, setSaveVersionBump] = useState<VersionBumpType>('patch');
  const [editorText, setEditorText] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<SpecReviewStatus | null>(null);
  const [validationIssues, setValidationIssues] = useState<OpenApiValidationIssue[]>([]);
  const [saveDialogError, setSaveDialogError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>({
    open: false,
    severity: 'success',
    message: '',
  });
  const localSpecWriteEnabled = canWriteSpecsLocally();

  const catalogSummary = useMemo(() => getCatalogSummary(), []);

  const servicesQuery = useQuery({
    queryKey: ['spec-catalog-services'],
    queryFn: listServices,
  });

  const versionsQuery = useQuery({
    queryKey: ['spec-catalog-versions', selectedService],
    queryFn: () => listVersions(selectedService ?? ''),
    enabled: selectedService !== null,
  });

  const editableSpecQuery = useQuery({
    queryKey: ['spec-catalog-editable', selectedService, selectedVersion],
    queryFn: () =>
      loadEditableSpecDocument({
        serviceName: selectedService ?? '',
        version: selectedVersion ?? '',
      }),
    enabled: selectedService !== null && selectedVersion !== null,
  });

  const uploadMutation = useMutation({
    mutationFn: uploadSpec,
    onSuccess: async (uploadedFile) => {
      setUploadOpen(false);
      setSelectedService(uploadedFile.serviceName);
      setSelectedVersion(uploadedFile.version);
      await queryClient.invalidateQueries({ queryKey: ['spec-catalog-services'] });
      await queryClient.invalidateQueries({
        queryKey: ['spec-catalog-versions', uploadedFile.serviceName],
      });
      setToast({
        open: true,
        severity: 'success',
        message: `Uploaded ${uploadedFile.serviceName} ${uploadedFile.version}.`,
      });
    },
    onError: (error) => {
      setToast({
        open: true,
        severity: 'error',
        message: error instanceof Error ? error.message : 'Upload failed.',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSpecVersion,
    onSuccess: async (_, variables) => {
      setDeleteOpen(false);
      if (selectedService === variables.serviceName && selectedVersion === variables.version) {
        setSelectedVersion(null);
      }
      await queryClient.invalidateQueries({ queryKey: ['spec-catalog-services'] });
      await queryClient.invalidateQueries({
        queryKey: ['spec-catalog-versions', variables.serviceName],
      });
      setToast({
        open: true,
        severity: 'success',
        message: `Deleted ${variables.serviceName} ${variables.version} from API Center.`,
      });
    },
    onError: (error) => {
      setToast({
        open: true,
        severity: 'error',
        message: error instanceof Error ? error.message : 'Delete failed.',
      });
    },
  });

  const saveEditedSpecMutation = useMutation({
    mutationFn: async ({
      serviceName,
      version,
      yamlText,
    }: {
      serviceName: string;
      version: string;
      yamlText: string;
    }) => {
      const parsedSpec = parseOpenApiText(yamlText, 'yaml');
      const { default: SwaggerParser } = await import('@apidevtools/swagger-parser');
      await SwaggerParser.validate(parsedSpec as unknown as string);
      return saveEditedSpecVersion({
        serviceName,
        version,
        yamlText,
      });
    },
    onSuccess: async (savedFile) => {
      setSaveDialogOpen(false);
      setSaveDialogError(null);
      setEditorDirty(false);
      setSelectedVersion(savedFile.version);
      await queryClient.invalidateQueries({ queryKey: ['spec-catalog-services'] });
      await queryClient.invalidateQueries({
        queryKey: ['spec-catalog-versions', savedFile.serviceName],
      });
      await queryClient.invalidateQueries({
        queryKey: ['spec-catalog-editable', savedFile.serviceName, savedFile.version],
      });
      setToast({
        open: true,
        severity: 'success',
        message: `Saved ${savedFile.serviceName} as ${savedFile.version}.`,
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Save failed.';
      setSaveDialogError(message);
      setToast({
        open: true,
        severity: 'error',
        message,
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: updateSpecReviewStatus,
    onSuccess: async (updated) => {
      setPendingStatus(null);
      await queryClient.invalidateQueries({
        queryKey: ['spec-catalog-services'],
      });
      await queryClient.invalidateQueries({
        queryKey: ['spec-catalog-versions', updated.serviceName],
      });
      await queryClient.invalidateQueries({
        queryKey: ['spec-catalog-editable', updated.serviceName, updated.version],
      });
      setToast({
        open: true,
        severity: 'success',
        message: `${updated.serviceName} ${updated.version} marked as ${updated.status}.`,
      });
    },
    onError: (error) => {
      setToast({
        open: true,
        severity: 'error',
        message: error instanceof Error ? error.message : 'Status update failed.',
      });
    },
  });

  useEffect(() => {
    if (selectedService === null) {
      setSelectedVersion(null);
      return;
    }

    const serviceStillExists = (servicesQuery.data ?? []).some(
      (service) => service.name === selectedService,
    );
    if (!serviceStillExists && !servicesQuery.isLoading) {
      setSelectedService(null);
      setSelectedVersion(null);
    }
  }, [selectedService, servicesQuery.data, servicesQuery.isLoading]);

  useEffect(() => {
    if (selectedService === null) {
      return;
    }

    const versions = versionsQuery.data ?? [];
    if (versions.length === 0) {
      setSelectedVersion(null);
      return;
    }

    setSelectedVersion((currentVersion) => {
      if (currentVersion && versions.some((version) => version.version === currentVersion)) {
        return currentVersion;
      }
      return versions[0]?.version ?? null;
    });
  }, [selectedService, versionsQuery.data]);

  useEffect(() => {
    if (!majorVersionAdminEnabled && saveVersionBump === 'major') {
      setSaveVersionBump('patch');
    }
  }, [majorVersionAdminEnabled, saveVersionBump]);

  useEffect(() => {
    if (!editableSpecQuery.data) {
      return;
    }

    setEditorText(editableSpecQuery.data.yamlText);
    setEditorDirty(false);
  }, [editableSpecQuery.data]);

  useEffect(() => {
    setPendingStatus(null);
  }, [selectedService, selectedVersion]);

  useEffect(() => {
    let isCancelled = false;
    const timeoutId = window.setTimeout(async () => {
      const issues = await validateOpenApiForEditor(editorText);
      if (!isCancelled) {
        setValidationIssues(issues);
      }
    }, 350);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [editorText]);

  const title =
    selectedService === null
      ? 'All services'
      : `Service: ${selectedService}${selectedVersion ? ` · ${selectedVersion}` : ''}`;

  const selectedVersionFile =
    versionsQuery.data?.find((version) => version.version === selectedVersion) ?? null;
  const selectedServiceEntry =
    servicesQuery.data?.find((service) => service.name === selectedService) ?? null;
  const viewerError =
    selectedService === null
      ? null
      : ((versionsQuery.error as Error | null) ?? (editableSpecQuery.error as Error | null));
  const viewerPlaceholder =
    selectedService === null
      ? MERGED_VIEW_PLACEHOLDER
      : !versionsQuery.isLoading && (versionsQuery.data?.length ?? 0) === 0
        ? `No versions found for ${selectedService}.`
        : undefined;
  const catalogChipLabel = servicesQuery.isError
    ? 'Catalog error'
    : servicesQuery.isLoading
      ? 'Catalog loading'
      : `${servicesQuery.data?.length ?? 0} services`;
  const catalogTooltip = `Static catalog · public/${catalogSummary.specsPrefix}/ · ${catalogSummary.indexKey}`;
  const writeAccessMessage =
    'Editing specs in the browser is only available when the local spec API is running.';
  const editorParseState = useMemo(() => {
    if (!editorText.trim()) {
      return { parsedSpec: null, error: null };
    }

    try {
      return {
        parsedSpec: parseOpenApiText(editorText, 'yaml'),
        error: null,
      };
    } catch (error) {
      return {
        parsedSpec: null,
        error: error instanceof Error ? error.message : 'Unable to parse the editor YAML.',
      };
    }
  }, [editorText]);
  const canUseLivePreview =
    editorLayoutMode !== 'preview' &&
    selectedService !== null &&
    selectedVersion !== null &&
    editorText.trim() !== '';
  const loadedSpec = editableSpecQuery.data?.parsedSpec;
  const previewSpec = canUseLivePreview ? editorParseState.parsedSpec ?? undefined : loadedSpec;
  const activeViewerError =
    editorLayoutMode !== 'preview' && editorParseState.error
      ? new Error(editorParseState.error)
      : viewerError;
  const nextEditedVersion = useMemo(() => {
    if (selectedServiceEntry === null) {
      return null;
    }

    if (saveVersionBump === 'major' && !majorVersionAdminEnabled) {
      return null;
    }

    try {
      return computeNextVersion(selectedServiceEntry.latestVersion, saveVersionBump);
    } catch {
      return null;
    }
  }, [majorVersionAdminEnabled, saveVersionBump, selectedServiceEntry]);
  const editorValidationMessage =
    editorParseState.error === null
      ? 'Preview updates directly from the YAML you are editing.'
      : null;
  const selectedVersionStatus: SpecReviewStatus | null = selectedVersionFile?.status ?? null;
  const effectiveStatus = pendingStatus ?? selectedVersionStatus;
  const hasPendingStatusChange =
    pendingStatus !== null &&
    selectedVersionStatus !== null &&
    pendingStatus !== selectedVersionStatus;
  const blockingValidationErrors = validationIssues.some((issue) => issue.severity === 'error');

  const handleUpload = (values: UploadOpenApiSpecValues) => {
    uploadMutation.mutate(values);
  };

  const handleSelectService = (serviceName: string | null) => {
    setSelectedService(serviceName);
    setSelectedVersion(null);
  };

  const handleDelete = () => {
    if (!selectedService || !selectedVersion) {
      return;
    }

    deleteMutation.mutate({
      serviceName: selectedService,
      version: selectedVersion,
      key: selectedVersionFile?.key,
    });
  };

  const handleEditorChange = (value: string) => {
    setEditorText(value);
    setEditorDirty(true);
  };

  const handleOpenSaveDialog = () => {
    setSaveDialogError(null);
    setSaveDialogOpen(true);
  };

  const handleSave = () => {
    if (selectedService === null || selectedVersion === null) {
      return;
    }

    if (editorDirty) {
      if (blockingValidationErrors) {
        setToast({
          open: true,
          severity: 'error',
          message: 'Fix validation errors before publishing a new version.',
        });
        return;
      }
      handleOpenSaveDialog();
      return;
    }

    if (hasPendingStatusChange && effectiveStatus) {
      updateStatusMutation.mutate({
        serviceName: selectedService,
        version: selectedVersion,
        status: effectiveStatus,
      });
    }
  };

  const handleConfirmSave = () => {
    if (!selectedService || !nextEditedVersion) {
      return;
    }
    if (blockingValidationErrors) {
      setSaveDialogError('Publishing is blocked until all validation errors are resolved.');
      return;
    }

    setSaveDialogError(null);
    saveEditedSpecMutation.mutate({
      serviceName: selectedService,
      version: nextEditedVersion,
      yamlText: editorText,
    });
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        sx={{
          top: { xs: `${topOffset.xs}px`, sm: `${topOffset.sm}px` },
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { md: `${DRAWER_WIDTH}px` },
          bgcolor: 'background.paper',
        }}
      >
        <Toolbar sx={{ minHeight: { xs: 64, sm: 72 }, px: { xs: 2, sm: 3 } }}>
          {!isMdUp && (
            <IconButton
              color="inherit"
              edge="start"
              onClick={() => setMobileOpen(true)}
              sx={{ mr: 2 }}
              aria-label="open menu"
            >
              <MenuIcon />
            </IconButton>
          )}
          <Stack spacing={0.25} sx={{ flexGrow: 1, minWidth: 0 }}>
             
            <Typography variant="h5" noWrap component="div" sx={{ color: 'text.primary' }}>
              API Center
            </Typography>
          </Stack>
          <Tooltip title={catalogTooltip}>
            <Chip
              size="small"
              label={catalogChipLabel}
              color={
                servicesQuery.isLoading ? 'default' : servicesQuery.isError ? 'error' : 'success'
              }
              sx={{ mr: 1, fontWeight: 700 }}
            />
          </Tooltip>
          <Tooltip title={localSpecWriteEnabled ? 'Upload an OpenAPI spec (writes to public/specs in dev)' : writeAccessMessage}>
            <span>
              <IconButton
                color="inherit"
                aria-label="upload spec"
                onClick={() => setUploadOpen(true)}
                disabled={!localSpecWriteEnabled}
              >
                <AddIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={localSpecWriteEnabled ? 'Delete the selected version from API Center' : writeAccessMessage}>
            <span>
              <IconButton
                color="inherit"
                aria-label="delete selected version"
                onClick={() => setDeleteOpen(true)}
                disabled={!localSpecWriteEnabled || selectedService === null || selectedVersion === null}
              >
                <DeleteOutlineIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <ApiCatalog
        services={servicesQuery.data ?? []}
        loading={servicesQuery.isLoading}
        error={servicesQuery.error as Error | null}
        selectedService={selectedService}
        searchTerm={searchTerm}
        drawerWidth={DRAWER_WIDTH}
        mobileOpen={mobileOpen}
        topOffset={topOffset}
        onSearchTermChange={setSearchTerm}
        onSelectService={handleSelectService}
        onMobileClose={() => setMobileOpen(false)}
      />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          px: { xs: 2, sm: 3 },
          pb: { xs: 2, sm: 3 },
          pt: { xs: 11, sm: 12 },
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
       
        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          spacing={1.5}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', lg: 'center' }}
          sx={{
            mb: 2.5,
            p: 1.5,
            borderRadius: 4,
            border: (theme) => `1px solid ${theme.palette.divider}`,
            bgcolor: 'background.paper',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.05)',
          }}
        >
          <VersionSelector
            serviceName={selectedService}
            versions={versionsQuery.data ?? []}
            selectedVersion={selectedVersion}
            loading={versionsQuery.isLoading}
            onChange={setSelectedVersion}
          />
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', sm: 'center' }}
          >
            {selectedVersionStatus && (
              <Chip
                size="small"
                color={getStatusChipColor(effectiveStatus ?? selectedVersionStatus)}
                label={`Status: ${effectiveStatus ?? selectedVersionStatus}`}
                sx={{ textTransform: 'capitalize' }}
              />
            )}
            <Button
              variant="outlined"
              color="success"
              disabled={
                !localSpecWriteEnabled ||
                selectedService === null ||
                selectedVersion === null ||
                effectiveStatus === 'approved' ||
                saveEditedSpecMutation.isPending
              }
              onClick={() => {
                setPendingStatus('approved');
              }}
            >
              Approve
            </Button>
            <Button
              variant="outlined"
              color="error"
              disabled={
                !localSpecWriteEnabled ||
                selectedService === null ||
                selectedVersion === null ||
                effectiveStatus === 'rejected' ||
                saveEditedSpecMutation.isPending
              }
              onClick={() => {
                setPendingStatus('rejected');
              }}
            >
              Reject
            </Button>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={editorLayoutMode}
              onChange={(_, value: EditorLayoutMode | null) => value && setEditorLayoutMode(value)}
            >
              <ToggleButton value="preview">Preview</ToggleButton>
              <ToggleButton value="editor">Editor</ToggleButton>
              <ToggleButton value="split">Split</ToggleButton>
            </ToggleButtonGroup>
            <FormControlLabel
              sx={{
                mx: 0.5,
                '& .MuiFormControlLabel-label': {
                  fontWeight: 600,
                  color: 'text.secondary',
                },
              }}
              control={
                <Switch
                  checked={majorVersionAdminEnabled}
                  onChange={(event) => setMajorVersionAdminEnabled(event.target.checked)}
                />
              }
              label="Admin major"
            />
            <Button
              variant="outlined"
              onClick={handleSave}
              disabled={
                !localSpecWriteEnabled ||
                selectedService === null ||
                selectedVersion === null ||
                editableSpecQuery.isLoading ||
                (!editorDirty && !hasPendingStatusChange) ||
                (editorDirty && blockingValidationErrors) ||
                updateStatusMutation.isPending ||
                saveEditedSpecMutation.isPending
              }
            >
              {editorDirty ? 'Save new version' : 'Save status'}
            </Button>
          </Stack>
        </Stack>

        {!localSpecWriteEnabled && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Read-only mode: specs are served as static files from the build. Enable local spec writes in dev
            to upload, delete, or change review status from the UI.
          </Alert>
        )}

        {editorLayoutMode === 'split' ? (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 2 }}>
            <OpenApiEditorPanel
              value={editorText}
              loading={editableSpecQuery.isLoading}
              dirty={editorDirty}
              issues={validationIssues}
              error={
                editableSpecQuery.error instanceof Error
                  ? editableSpecQuery.error.message
                  : editorParseState.error
              }
              validationMessage={editorValidationMessage}
              onChange={handleEditorChange}
            />
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <ApiViewer
                viewer={viewer}
                onViewerChange={setViewer}
                spec={previewSpec}
                loading={
                  selectedService !== null &&
                  (versionsQuery.isLoading || editableSpecQuery.isLoading)
                }
                error={activeViewerError}
                title={title}
                placeholder={viewerPlaceholder}
              />
            </Box>
          </Box>
        ) : editorLayoutMode === 'editor' ? (
          <OpenApiEditorPanel
            value={editorText}
            loading={editableSpecQuery.isLoading}
            dirty={editorDirty}
            issues={validationIssues}
            error={
              editableSpecQuery.error instanceof Error
                ? editableSpecQuery.error.message
                : editorParseState.error
            }
            validationMessage={editorValidationMessage}
            onChange={handleEditorChange}
          />
        ) : (
          <ApiViewer
            viewer={viewer}
            onViewerChange={setViewer}
            spec={loadedSpec}
            loading={selectedService !== null && (versionsQuery.isLoading || editableSpecQuery.isLoading)}
            error={viewerError}
            title={title}
            placeholder={viewerPlaceholder}
          />
        )}
      </Box>

      <UploadOpenApiSpec
        open={uploadOpen}
        uploading={uploadMutation.isPending}
        error={uploadMutation.isError ? (uploadMutation.error as Error).message : null}
        services={servicesQuery.data ?? []}
        onClose={() => setUploadOpen(false)}
        onUpload={handleUpload}
      />
      <DeleteVersionDialog
        open={deleteOpen}
        serviceName={selectedService}
        version={selectedVersion}
        loading={deleteMutation.isPending}
        error={deleteMutation.isError ? (deleteMutation.error as Error).message : null}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
      />
      <SaveEditedSpecDialog
        open={saveDialogOpen}
        serviceName={selectedService}
        sourceVersion={selectedVersion}
        latestVersion={selectedServiceEntry?.latestVersion ?? null}
        nextVersion={nextEditedVersion}
        versionBump={saveVersionBump}
        allowMajorIncrement={majorVersionAdminEnabled}
        loading={saveEditedSpecMutation.isPending}
        error={saveDialogError}
        publishBlockedReason={
          blockingValidationErrors
            ? 'Publishing is blocked until all validation errors are fixed.'
            : null
        }
        onClose={() => setSaveDialogOpen(false)}
        onConfirm={handleConfirmSave}
        onVersionBumpChange={setSaveVersionBump}
      />
      <Snackbar
        open={toast.open}
        autoHideDuration={5000}
        onClose={() => setToast((currentToast) => ({ ...currentToast, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setToast((currentToast) => ({ ...currentToast, open: false }))}
          severity={toast.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

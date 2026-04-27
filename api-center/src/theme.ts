import { alpha, createTheme } from '@mui/material/styles';

const slate = '#0f172a';
const brand = '#2563eb';
const brandDark = '#1d4ed8';
const accent = '#0f766e';
const ink = '#172033';
const subtleInk = '#5b6780';
const line = '#d8e1ef';
const softLine = '#e7edf6';
const canvas = '#f4f7fb';
const paper = '#ffffff';
const navSurface = '#f8fbff';
const hoverFill = alpha(brand, 0.07);
const activeFill = alpha(brand, 0.12);
const focusRing = alpha(brand, 0.28);

export const appTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: brand,
      dark: brandDark,
      light: '#60a5fa',
      contrastText: '#ffffff',
    },
    secondary: {
      main: accent,
      dark: '#115e59',
      light: '#2dd4bf',
      contrastText: '#ffffff',
    },
    background: {
      default: canvas,
      paper,
    },
    text: {
      primary: ink,
      secondary: subtleInk,
    },
    divider: line,
    success: {
      main: '#15803d',
    },
    warning: {
      main: '#b45309',
    },
    error: {
      main: '#c2410c',
    },
  },
  shape: {
    borderRadius: 0,
  },
  typography: {
    fontFamily: '"DM Sans", system-ui, sans-serif',
    h4: {
      fontWeight: 700,
      letterSpacing: '-0.03em',
    },
    h5: {
      fontWeight: 700,
      letterSpacing: '-0.025em',
    },
    h6: {
      fontWeight: 700,
      letterSpacing: '-0.02em',
    },
    subtitle1: {
      fontWeight: 600,
      color: ink,
    },
    subtitle2: {
      fontWeight: 700,
      fontSize: '0.78rem',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      color: subtleInk,
    },
    body1: {
      lineHeight: 1.65,
    },
    body2: {
      lineHeight: 1.55,
      color: subtleInk,
    },
    button: {
      fontWeight: 700,
      letterSpacing: '0.01em',
      textTransform: 'none',
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ':root': {
          colorScheme: 'light',
        },
        body: {
          background:
            'radial-gradient(circle at top, rgba(37,99,235,0.08), transparent 28%), #f4f7fb',
          color: ink,
        },
        '::selection': {
          backgroundColor: alpha(brand, 0.18),
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: alpha(paper, 0.88),
          color: ink,
          boxShadow: '0 8px 28px rgba(15, 23, 42, 0.08)',
          backdropFilter: 'blur(18px)',
          borderBottom: `1px solid ${alpha(line, 0.9)}`,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        rounded: {
          borderRadius: 0,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          border: `1px solid ${softLine}`,
          boxShadow: '0 18px 48px rgba(15, 23, 42, 0.06)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: navSurface,
          borderRight: `1px solid ${softLine}`,
          boxShadow: 'none',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          position: 'relative',
          marginInline: 10,
          marginBlock: 4,
          borderRadius: 0,
          paddingInline: 14,
          paddingBlock: 10,
          transition:
            'background-color 200ms ease, transform 200ms ease, box-shadow 200ms ease',
          '&::before': {
            content: '""',
            position: 'absolute',
            left: 0,
            top: 10,
            bottom: 10,
            width: 4,
            borderRadius: 999,
            backgroundColor: 'transparent',
            transition: 'background-color 200ms ease, opacity 200ms ease',
            opacity: 0,
          },
          '&:hover': {
            backgroundColor: hoverFill,
            transform: 'translateX(2px)',
          },
          '&.Mui-selected': {
            backgroundColor: activeFill,
            boxShadow: `inset 0 0 0 1px ${alpha(brand, 0.08)}`,
          },
          '&.Mui-selected::before': {
            backgroundColor: brand,
            opacity: 1,
          },
          '&.Mui-selected:hover': {
            backgroundColor: alpha(brand, 0.16),
          },
          '&.Mui-focusVisible': {
            outline: `3px solid ${focusRing}`,
            outlineOffset: 2,
          },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: {
          minHeight: 48,
        },
        indicator: {
          height: 3,
          borderRadius: 999,
          backgroundColor: brand,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 48,
          paddingInline: 18,
          fontWeight: 700,
          fontSize: '0.92rem',
          color: subtleInk,
          '&.Mui-selected': {
            color: ink,
          },
          '&.Mui-focusVisible': {
            borderRadius: 0,
            outline: `3px solid ${focusRing}`,
            outlineOffset: 2,
          },
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: 0,
          paddingInline: 16,
          paddingBlock: 10,
          transition:
            'transform 200ms ease, background-color 200ms ease, border-color 200ms ease, box-shadow 200ms ease',
          '&:hover': {
            transform: 'translateY(-1px)',
            boxShadow: '0 10px 18px rgba(37, 99, 235, 0.12)',
          },
          '&.Mui-focusVisible': {
            outline: `3px solid ${focusRing}`,
            outlineOffset: 2,
          },
        },
        containedPrimary: {
          background: `linear-gradient(135deg, ${brand} 0%, ${brandDark} 100%)`,
        },
        outlined: {
          borderColor: line,
          backgroundColor: alpha(paper, 0.88),
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          backgroundColor: alpha(paper, 0.9),
          transition: 'box-shadow 200ms ease, border-color 200ms ease',
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: alpha(brand, 0.42),
          },
          '&.Mui-focused': {
            boxShadow: `0 0 0 4px ${focusRing}`,
          },
        },
        notchedOutline: {
          borderColor: softLine,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          fontWeight: 700,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 0,
          border: `1px solid ${softLine}`,
          boxShadow: '0 28px 80px rgba(15, 23, 42, 0.16)',
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 0,
        },
      },
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          backgroundColor: alpha(brand, 0.04),
          padding: 4,
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          border: 0,
          borderRadius: 0,
          color: subtleInk,
          fontWeight: 700,
          '&.Mui-selected': {
            backgroundColor: paper,
            color: ink,
            boxShadow: `0 8px 20px ${alpha(slate, 0.08)}`,
          },
          '&.Mui-selected:hover': {
            backgroundColor: paper,
          },
        },
      },
    },
    MuiTypography: {
      styleOverrides: {
        root: {
          textWrap: 'balance',
        },
      },
    },
  },
});

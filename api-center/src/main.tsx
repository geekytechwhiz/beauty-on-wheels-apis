import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Buffer } from 'buffer';
import process from 'process';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { BrowserRouter } from 'react-router-dom';
import DeveloperHubApp from './DeveloperHubApp';
import { appTheme } from './theme';

const globalWithPolyfills = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer;
  process?: typeof process;
};

if (typeof globalWithPolyfills.Buffer === 'undefined') {
  globalWithPolyfills.Buffer = Buffer;
}

if (typeof globalWithPolyfills.process === 'undefined') {
  globalWithPolyfills.process = process;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={appTheme}>
          <CssBaseline />
          <DeveloperHubApp />
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);

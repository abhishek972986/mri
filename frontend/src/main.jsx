import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import Root from './Root';
import './styles.css';

/*
 * One cache for all API state. Patient data is refetched on focus so a record
 * edited in another tab never shows stale; 4xx errors are not retried, since
 * repeating "not found" or "not signed in" cannot change the answer.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => !(error?.status >= 400 && error?.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <Root />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

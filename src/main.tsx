import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './styles.css';
import './simplified.css';
import './sidebar.css';
import './my-work.css';
import './insights-sandbox.css';
import './dependency-capacity.css';
import './chat.css';
import './team-resources.css';

if (typeof document !== 'undefined') {
  document.documentElement.removeAttribute('data-theme');
}
if (typeof localStorage !== 'undefined') {
  localStorage.removeItem('grace-theme');
}

const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 60000,
      gcTime: 600000,
    },
  },
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);

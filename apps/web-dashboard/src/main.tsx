import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { App } from './App';
import { WorkspaceProvider } from './state/workspace';
import { ErrorBoundary } from './components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary name="dashboard">
      <WorkspaceProvider><App /></WorkspaceProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

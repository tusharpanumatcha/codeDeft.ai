import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import { App } from './App';
import { WorkspaceProvider } from './state/workspace';
import { PreferencesProvider, applyPreferences, loadPreferences } from './state/preferences';
import { ErrorBoundary } from './components/ErrorBoundary';

applyPreferences(loadPreferences()); // before first paint: no theme flash

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary name="dashboard">
      <PreferencesProvider>
        <WorkspaceProvider><App /></WorkspaceProvider>
      </PreferencesProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

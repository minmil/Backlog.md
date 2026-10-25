import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { HealthCheckProvider } from './contexts/HealthCheckContext';
import { SchemaProvider } from './components/schema/SchemaProvider';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <HealthCheckProvider>
      <SchemaProvider><App /></SchemaProvider>
    </HealthCheckProvider>
  </React.StrictMode>
);

import React from 'react';
import { createRoot } from 'react-dom/client';
import BedtimeApp from './BedtimeApp';
import './index.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <BedtimeApp />
    </React.StrictMode>
  );
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import './index.css';

const ROOT_ELEMENT_ID = 'root';

const rootElement = document.getElementById(ROOT_ELEMENT_ID);
if (!rootElement) {
  throw new Error(`Mount point "#${ROOT_ELEMENT_ID}" is missing from index.html.`);
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

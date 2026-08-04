import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@/styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root 节点缺失，options.html 可能被破坏');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

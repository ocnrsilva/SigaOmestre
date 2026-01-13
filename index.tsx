
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const initApp = () => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error("Erro crítico: Elemento #root não encontrado no DOM.");
    return;
  }

  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    console.error("Erro ao renderizar a aplicação React:", error);
  }
};

// Garante que o DOM está carregado antes de iniciar o React
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

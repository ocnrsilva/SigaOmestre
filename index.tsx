
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const start = () => {
  const container = document.getElementById('root');
  if (container) {
    const root = ReactDOM.createRoot(container);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
};

if (document.readyState === 'complete') {
  start();
} else {
  window.addEventListener('load', start);
}

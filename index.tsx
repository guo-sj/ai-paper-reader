
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AdminApp from './AdminApp';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const path = window.location.pathname;
const RootComponent = path.startsWith('/admin') ? AdminApp : App;

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);

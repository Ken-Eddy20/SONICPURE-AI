import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { firebaseConfigured } from './firebase';

function SetupNotice() {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="card max-w-lg p-8">
        <p className="eyebrow text-accent">Setup needed</p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Firebase config is missing</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Add your Firebase web app config as <code className="font-mono text-ink">VITE_FIREBASE_*</code> variables: on Render in
          the service's Environment settings (then restart the service), or locally in <code className="font-mono text-ink">.env.local</code>{' '}
          (see <code className="font-mono text-ink">.env.example</code>) or as <code className="font-mono text-ink">firebase-applet-config.json</code> in
          the project root.
        </p>
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>{firebaseConfigured ? <App /> : <SetupNotice />}</React.StrictMode>,
);

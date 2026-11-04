import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { AppToastProvider } from './components/ui';
import App from './App';
import './i18n';
import './index.css';

// The static demo uses HashRouter; the real web app keeps clean BrowserRouter URLs.
const Router = import.meta.env.VITE_DEMO ? HashRouter : BrowserRouter;
// Sub-path builds (for example /develop/) need the router basename; '/' yields no basename.
const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, '');

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Router basename={Router === BrowserRouter ? routerBasename : undefined}>
            <ThemeProvider>
                <AppToastProvider>
                    <AuthProvider>
                        <WebSocketProvider>
                            <App />
                        </WebSocketProvider>
                    </AuthProvider>
                </AppToastProvider>
            </ThemeProvider>
        </Router>
    </React.StrictMode>
);

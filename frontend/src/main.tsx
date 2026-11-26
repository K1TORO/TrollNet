import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth';
import { LangProvider } from './i18n';
import { ModeProvider } from './mode';
import { ConfirmProvider } from './components/Confirm';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <AuthProvider>
        <ModeProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ModeProvider>
      </AuthProvider>
    </LangProvider>
  </StrictMode>,
);

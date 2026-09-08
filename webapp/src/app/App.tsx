import React from 'react';
import '@/styles/app.css';
import { Providers } from './providers.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { AuthLoadingScreen } from '@/features/auth/components/AuthLoadingScreen.js';
import { AuthErrorScreen } from '@/features/auth/components/AuthErrorScreen.js';
import { AdminLayout } from '@/features/admin/AdminLayout.js';
import { UserPortalPage } from '@/features/user-portal/UserPortalPage.js';

export const App: React.FC = () => {
  const { loading, error, authData } = useAuth();

  return (
    <Providers
      initialLocale={authData?.locale || 'fa'}
      languageSelectionEnabled={authData?.languageSelectionEnabled ?? true}
    >
      {loading ? (
        <AuthLoadingScreen />
      ) : error || !authData ? (
        <AuthErrorScreen error={error} />
      ) : authData.role === 'admin' ? (
        <AdminLayout user={authData.user} />
      ) : (
        <UserPortalPage user={authData.user} />
      )}
    </Providers>
  );
};

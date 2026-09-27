import React, { useState } from 'react';
import '@/styles/app.css';
import { Providers } from './providers.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { AuthLoadingScreen } from '@/features/auth/components/AuthLoadingScreen.js';
import { AuthErrorScreen } from '@/features/auth/components/AuthErrorScreen.js';
import { AdminLayout } from '@/features/admin/AdminLayout.js';
import { UserBetaPortal } from '@/features/user-portal/UserBetaPortal.js';
import { UserPortalPage } from '@/features/user-portal/UserPortalPage.js';

export const App: React.FC = () => {
  const { loading, error, authData } = useAuth();
  const [adminViewMode, setAdminViewMode] = useState<'admin' | 'user'>('admin');

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
        adminViewMode === 'admin' ? (
          <AdminLayout user={authData.user} onSwitchToUserPortal={() => setAdminViewMode('user')} />
        ) : (
          <UserBetaPortal
            user={authData.user}
            onExitBeta={() => setAdminViewMode('admin')}
            isAdminPreview={true}
            onSwitchToAdmin={() => setAdminViewMode('admin')}
          />
        )
      ) : (
        <UserPortalPage user={authData.user} />
      )}
    </Providers>
  );
};

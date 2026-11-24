import React, { Suspense, lazy, useState } from 'react';
import '@/styles/app.css';
import { Providers } from './providers.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { AuthLoadingScreen } from '@/features/auth/components/AuthLoadingScreen.js';
import { AuthErrorScreen } from '@/features/auth/components/AuthErrorScreen.js';

const AdminLayout = lazy(() =>
  import('@/features/admin/AdminLayout.js').then((m) => ({ default: m.AdminLayout }))
);
const UserPortal = lazy(() =>
  import('@/features/user-portal/UserPortal.js').then((m) => ({ default: m.UserPortal }))
);

export const App: React.FC = () => {
  const { loading, error, errorCode, errorTitle, errorLocale, authData } = useAuth();
  const [adminViewMode, setAdminViewMode] = useState<'admin' | 'user'>('admin');

  return (
    <Providers
      initialLocale={authData?.locale || errorLocale || 'fa'}
      languageSelectionEnabled={authData?.languageSelectionEnabled ?? true}
    >
      {loading ? (
        <AuthLoadingScreen />
      ) : error || !authData ? (
        <AuthErrorScreen error={error} errorCode={errorCode} errorTitle={errorTitle} />
      ) : (
        <Suspense fallback={<AuthLoadingScreen />}>
          {authData.role === 'admin' ? (
            adminViewMode === 'admin' ? (
              <AdminLayout
                user={authData.user}
                botUsername={authData.botUsername}
                onSwitchToUserPortal={() => setAdminViewMode('user')}
              />
            ) : (
              <UserPortal
                user={authData.user}
                startParam={authData.startParam}
                isAdminView={true}
                onSwitchToAdmin={() => setAdminViewMode('admin')}
              />
            )
          ) : (
            <UserPortal user={authData.user} startParam={authData.startParam} />
          )}
        </Suspense>
      )}
    </Providers>
  );
};

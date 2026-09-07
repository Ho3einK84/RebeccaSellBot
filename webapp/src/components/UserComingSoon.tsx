import React from 'react';
import type { TelegramWebAppUser } from '../types/telegram.js';
import { useLanguage } from '../i18n/LanguageContext.js';

interface UserComingSoonProps {
  user: TelegramWebAppUser;
}

export const UserComingSoon: React.FC<UserComingSoonProps> = ({ user }) => {
  const { t, locale, languageSelectionEnabled, setLocale } = useLanguage();

  const handleClose = () => {
    if (window.Telegram?.WebApp?.close) {
      window.Telegram.WebApp.close();
    } else {
      window.close();
    }
  };

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || t('guestUser');

  return (
    <div className="coming-soon-container">
      <div className="glass-panel coming-soon-card">
        {languageSelectionEnabled && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
            <button
              className="lang-toggle-btn"
              onClick={() => setLocale(locale === 'fa' ? 'en' : 'fa')}
            >
              🌐 {t('switchLang')}
            </button>
          </div>
        )}

        <div className="user-avatar">
          {user.photo_url ? (
            <img
              src={user.photo_url}
              alt={displayName}
              style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            '👤'
          )}
        </div>

        <h1 className="coming-soon-title">{t('greeting', { name: displayName })}</h1>

        <div className="user-badge">
          <span>{t('telegramId')}</span>
          <code>{user.id}</code>
          {user.username && <span>(@{user.username})</span>}
        </div>

        <div className="coming-soon-subtitle">
          <p
            style={{
              margin: '0 0 10px 0',
              fontSize: '16px',
              fontWeight: 600,
              color: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <span>{t('portalTitle')}</span>
            <span className="badge badge-warning" style={{ fontSize: '11px' }}>
              {t('betaBadge')}
            </span>
          </p>
          <p style={{ margin: 0 }}>{t('portalDesc')}</p>
        </div>

        <button className="btn-primary" onClick={handleClose}>
          {t('backToBot')}
        </button>
      </div>
    </div>
  );
};

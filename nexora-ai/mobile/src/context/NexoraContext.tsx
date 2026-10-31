import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { DARK_THEME, LIGHT_THEME, NexoraTheme, ThemeMode } from '../theme/theme';
import { AppLanguage, TRANSLATIONS } from '../i18n/translations';

export type ScreenName =
  | 'SPLASH'
  | 'ONBOARDING'
  | 'REGISTER'
  | 'LOGIN'
  | 'PASSWORD_RECOVERY'
  | 'HOME'
  | 'AI_CHAT'
  | 'MODEL_SELECTION'
  | 'IMAGE_GEN'
  | 'VIDEO_GEN'
  | 'VOICE_ASSISTANT'
  | 'AI_CODING'
  | 'DOCUMENT_ANALYSIS'
  | 'CHAT_HISTORY'
  | 'CREDIT_WALLET'
  | 'BUY_CREDITS'
  | 'SUBSCRIPTION_PLANS'
  | 'PAYMENT_HISTORY'
  | 'REFERRALS'
  | 'NOTIFICATIONS'
  | 'USER_PROFILE'
  | 'SETTINGS'
  | 'HELP_SUPPORT'
  | 'ADMIN_DASHBOARD';

interface NexoraContextValue {
  screen: ScreenName;
  navigate: (next: ScreenName) => void;
  theme: NexoraTheme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
  t: (key: string) => string;
  user: any | null;
  wallet: any | null;
  models: any[];
  selectedModel: any | null;
  setSelectedModel: (m: any) => void;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  unreadNotifications: number;
  announcements: any[];
  refreshSessionData: () => Promise<void>;
  handleAuthSuccess: (authPayload: any) => Promise<void>;
  signOut: (allDevices?: boolean) => Promise<void>;
}

const NexoraContext = createContext<NexoraContextValue | undefined>(undefined);

export const NexoraProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [screen, setScreen] = useState<ScreenName>('SPLASH');
  const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');
  const [language, setLanguageState] = useState<AppLanguage>('en');
  const [user, setUser] = useState<any | null>(null);
  const [wallet, setWallet] = useState<any | null>(null);
  const [models, setModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState<any | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState<number>(0);
  const [announcements, setAnnouncements] = useState<any[]>([]);

  const theme = themeMode === 'dark' ? DARK_THEME : LIGHT_THEME;
  const t = useCallback(
    (key: string) => TRANSLATIONS[language]?.[key] || TRANSLATIONS.en[key] || key,
    [language],
  );

  const refreshSessionData = useCallback(async () => {
    try {
      const [me, w, mList, notifData] = await Promise.all([
        apiClient.request('/auth/me'),
        apiClient.request('/wallet'),
        apiClient.request('/chat/models'),
        apiClient.request('/platform/notifications'),
      ]);
      setUser(me);
      if (me.preferredLanguage === 'si' || me.preferredLanguage === 'en') {
        setLanguageState(me.preferredLanguage);
      }
      if (me.themePreference === 'dark' || me.themePreference === 'light') {
        setThemeModeState(me.themePreference);
      }
      setWallet(w);
      setModels(mList);
      setSelectedModel((prev: any) => prev || mList.find((x: any) => x.category === 'CHAT') || mList[0] || null);
      setUnreadNotifications(notifData.unreadCount || 0);
      setAnnouncements(notifData.announcements || []);
    } catch {
      // Session invalid or expired
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const hasToken = await apiClient.hydrateTokens();
      if (hasToken) {
        try {
          await refreshSessionData();
          if (mounted) setScreen('HOME');
          return;
        } catch {
          await apiClient.clearTokens();
        }
      }
      setTimeout(() => {
        if (mounted) setScreen('ONBOARDING');
      }, 900);
    })();
    return () => {
      mounted = false;
    };
  }, [refreshSessionData]);

  const handleAuthSuccess = async (payload: any) => {
    await apiClient.saveTokens(payload.accessToken, payload.refreshToken);
    setUser(payload.user);
    setWallet(payload.wallet);
    if (payload.user?.preferredLanguage) setLanguageState(payload.user.preferredLanguage);
    if (payload.user?.themePreference) setThemeModeState(payload.user.themePreference);
    await refreshSessionData();
    setScreen('HOME');
  };

  const setThemeMode = async (mode: ThemeMode) => {
    setThemeModeState(mode);
    if (user) {
      await apiClient.request('/auth/me', { method: 'PATCH', body: { themePreference: mode } }).catch(() => undefined);
    }
  };

  const setLanguage = async (lang: AppLanguage) => {
    setLanguageState(lang);
    if (user) {
      await apiClient.request('/auth/me', { method: 'PATCH', body: { preferredLanguage: lang } }).catch(() => undefined);
    }
  };

  const signOut = async (allDevices = false) => {
    await apiClient.request('/auth/logout', { method: 'POST', body: { allDevices } }).catch(() => undefined);
    await apiClient.clearTokens();
    setUser(null);
    setWallet(null);
    setActiveConversationId(null);
    setScreen('LOGIN');
  };

  return (
    <NexoraContext.Provider
      value={{
        screen,
        navigate: setScreen,
        theme,
        themeMode,
        setThemeMode,
        language,
        setLanguage,
        t,
        user,
        wallet,
        models,
        selectedModel,
        setSelectedModel,
        activeConversationId,
        setActiveConversationId,
        unreadNotifications,
        announcements,
        refreshSessionData,
        handleAuthSuccess,
        signOut,
      }}
    >
      {children}
    </NexoraContext.Provider>
  );
};

export function useNexora(): NexoraContextValue {
  const ctx = useContext(NexoraContext);
  if (!ctx) throw new Error('useNexora must be used inside NexoraProvider');
  return ctx;
}

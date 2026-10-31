import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { downloadReleaseArtifact, isEmbeddedAndroidApk } from '../api/client';
import { ScreenName, useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const SettingsScreen: React.FC = () => {
  const {
    theme,
    themeMode,
    setThemeMode,
    language,
    setLanguage,
    navigate,
    user,
    signOut,
    t,
  } = useNexora();

  const links: Array<{ key: ScreenName; label: string }> = [
    { key: 'USER_PROFILE', label: '👤 User Profile & Password' },
    { key: 'CREDIT_WALLET', label: '💎 Token Credit Wallet & Promo Codes' },
    { key: 'BUY_CREDITS', label: '💳 Buy Credits (LKR PayHere / USD Stripe)' },
    { key: 'SUBSCRIPTION_PLANS', label: '⚡ Subscription Plans & Business API Keys' },
    { key: 'PAYMENT_HISTORY', label: '🧾 Payment History & Tax Invoices' },
    { key: 'REFERRALS', label: '🎁 Referral Program' },
    { key: 'NOTIFICATIONS', label: '🔔 Notifications & Announcements' },
    { key: 'HELP_SUPPORT', label: '❓ Help, FAQ & Live System Health' },
  ];

  return (
    <ScreenShell title={t('settings')} subtitle="Appearance, Language & Platform Directory" showBackTo="HOME">
      <GlowCard accent="purple">
        <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15, marginBottom: 10 }}>
          🎨 Theme Mode
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <PrimaryButton
            label={`🌙 ${t('darkMode')}`}
            variant={themeMode === 'dark' ? 'purple' : 'outline'}
            onPress={() => setThemeMode('dark')}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            label={`☀️ ${t('lightMode')}`}
            variant={themeMode === 'light' ? 'blue' : 'outline'}
            onPress={() => setThemeMode('light')}
            style={{ flex: 1 }}
          />
        </View>

        <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15, marginTop: 16, marginBottom: 10 }}>
          🌐 {t('languageLabel')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <PrimaryButton
            label="English (EN)"
            variant={language === 'en' ? 'purple' : 'outline'}
            onPress={() => setLanguage('en')}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            label="🇱🇰 සිංහල (Sinhala)"
            variant={language === 'si' ? 'blue' : 'outline'}
            onPress={() => setLanguage('si')}
            style={{ flex: 1 }}
          />
        </View>
      </GlowCard>

      <GlowCard>
        <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15, marginBottom: 8 }}>
          Platform Navigation
        </Text>
        {links.map((item) => (
          <TouchableOpacity
            key={item.key}
            onPress={() => navigate(item.key)}
            style={[styles.navRow, { borderBottomColor: theme.border }]}
          >
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>{item.label}</Text>
            <Text style={{ color: theme.electricBlue, fontWeight: '800' }}>→</Text>
          </TouchableOpacity>
        ))}

        {user && ['OWNER', 'ADMIN', 'SUPPORT'].includes(user.role) && (
          <TouchableOpacity
            onPress={() => navigate('ADMIN_DASHBOARD')}
            style={[styles.navRow, { borderBottomColor: theme.border }]}
          >
            <Text style={{ color: theme.electricBlue, fontWeight: '900', fontSize: 14 }}>
              🛡️ Owner & Admin Governance Dashboard ({user.role})
            </Text>
            <Text style={{ color: theme.electricBlue, fontWeight: '800' }}>→</Text>
          </TouchableOpacity>
        )}
      </GlowCard>

      {!isEmbeddedAndroidApk() && (
        <GlowCard accent="blue">
          <Text style={{ color: theme.electricBlue, fontWeight: '900', fontSize: 15, marginBottom: 6 }}>
            📲 App Downloads (Android APK & Production Web App)
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: 12.5, marginBottom: 10 }}>
            Download the signed Android APK (`NEXORA-AI-v1.0.0.apk`) for Android phones or the standalone PWA Web App bundle:
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <PrimaryButton
              label="📥 Download Android APK"
              onPress={() => downloadReleaseArtifact('NEXORA-AI-v1.0.0.apk')}
              style={{ flex: 1, minWidth: 180 }}
            />
            <PrimaryButton
              label="🌐 Download Web App (.zip)"
              variant="outline"
              onPress={() => downloadReleaseArtifact('NEXORA-AI-WebApp-v1.0.0.zip')}
              style={{ flex: 1, minWidth: 180 }}
            />
          </View>
        </GlowCard>
      )}

      <PrimaryButton label={t('signOut')} variant="danger" onPress={() => signOut(false)} />
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
});

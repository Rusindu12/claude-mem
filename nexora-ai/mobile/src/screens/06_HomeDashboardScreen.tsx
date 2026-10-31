import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { apiClient, downloadReleaseArtifact, isEmbeddedAndroidApk } from '../api/client';
import { ScreenName, useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

const QUICK_TOOLS: Array<{ screen: ScreenName; icon: string; title: string; subtitle: string }> = [
  { screen: 'AI_CHAT', icon: '💬', title: 'AI Chat & Sinhala', subtitle: 'Streaming multi-model' },
  { screen: 'AI_CODING', icon: '💻', title: 'AI Coding Lab', subtitle: 'Code, debug & review' },
  { screen: 'IMAGE_GEN', icon: '🎨', title: 'Image Studio', subtitle: 'Text-to-image & edits' },
  { screen: 'VIDEO_GEN', icon: '🎬', title: 'Video Studio', subtitle: 'Async video worker' },
  { screen: 'VOICE_ASSISTANT', icon: '🎙️', title: 'Voice Assistant', subtitle: 'Speak & listen (EN/SI)' },
  { screen: 'DOCUMENT_ANALYSIS', icon: '📄', title: 'Docs, Study & Translate', subtitle: 'PDF/Text & Sinhala' },
  { screen: 'CHAT_HISTORY', icon: '🗂️', title: 'Chat History', subtitle: 'Search & manage' },
  { screen: 'REFERRALS', icon: '🎁', title: 'Refer & Earn', subtitle: 'Free bonus credits' },
];

export const HomeDashboardScreen: React.FC = () => {
  const {
    theme,
    user,
    wallet,
    selectedModel,
    announcements,
    navigate,
    setActiveConversationId,
    refreshSessionData,
    t,
    language,
  } = useNexora();

  const [recentConvs, setRecentConvs] = useState<any[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [claimBanner, setClaimBanner] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request('/chat/conversations')
      .then((rows) => setRecentConvs((rows || []).slice(0, 4)))
      .catch(() => undefined);
  }, []);

  const handleDailyClaim = async () => {
    setClaiming(true);
    setClaimBanner(null);
    try {
      const res = await apiClient.request('/wallet/claim-daily', { method: 'POST' });
      setClaimBanner(`+${res.creditsGranted} Colombo Daily Free Credits added (${res.claimedDateColombo})!`);
      await refreshSessionData();
    } catch (err: any) {
      setClaimBanner(err.message);
    } finally {
      setClaiming(false);
    }
  };

  return (
    <ScreenShell
      title={`${t('welcomeBack')}, ${user?.fullName?.split(' ')[0] || 'Creator'}`}
      subtitle={t('tagline')}
    >
      {/* Platform Announcements */}
      {announcements.map((a) => (
        <GlowCard key={a.id} accent="blue" style={{ paddingVertical: 12 }}>
          <Text style={{ color: theme.electricBlue, fontWeight: '800', fontSize: 13 }}>
            📢 {language === 'si' && a.title_si ? a.title_si : a.title}
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: 12.5, marginTop: 4 }}>
            {language === 'si' && a.body_si ? a.body_si : a.body}
          </Text>
        </GlowCard>
      ))}

      {/* Credit Balance, Daily Free Balance & Subscription Status Card */}
      {!isEmbeddedAndroidApk() && (
        <GlowCard accent="blue" style={{ paddingVertical: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <View style={{ flex: 1, minWidth: 180 }}>
              <Text style={{ color: theme.electricBlue, fontWeight: '900', fontSize: 13 }}>
                📲 NEXORA AI Android App (v1.0.0 Signed APK)
              </Text>
              <Text style={{ color: theme.textSecondary, fontSize: 11.5, marginTop: 2 }}>
                Install directly on any Android phone (`com.nexora.ai`)
              </Text>
            </View>
            <PrimaryButton
              label="📥 Download APK"
              onPress={() => downloadReleaseArtifact('NEXORA-AI-v1.0.0.apk')}
            />
          </View>
        </GlowCard>
      )}

      <GlowCard accent="purple">
        <View style={styles.walletTopRow}>
          <View>
            <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '700' }}>
              {t('totalCredits')}
            </Text>
            <Text style={[styles.bigBalance, { color: theme.text }]}>
              💎 {Number(wallet?.totalAvailableCredits || 0).toFixed(2)}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => navigate('SUBSCRIPTION_PLANS')}
            style={[styles.planBadge, { backgroundColor: theme.electricSoft, borderColor: theme.electricBlue }]}
          >
            <Text style={{ color: theme.electricBlue, fontWeight: '800', fontSize: 12 }}>
              ⚡ {user?.activePlanCode || 'FREE'} PLAN
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bucketGrid}>
          <View style={[styles.bucketItem, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <Text style={{ color: theme.textMuted, fontSize: 11 }}>{t('freeCredits')}</Text>
            <Text style={{ color: theme.electricBlue, fontWeight: '800', fontSize: 16 }}>
              {Number(wallet?.freeCredits || 0).toFixed(1)}
            </Text>
          </View>
          <View style={[styles.bucketItem, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <Text style={{ color: theme.textMuted, fontSize: 11 }}>{t('purchasedCredits')}</Text>
            <Text style={{ color: theme.success, fontWeight: '800', fontSize: 16 }}>
              {Number(wallet?.purchasedCredits || 0).toFixed(1)}
            </Text>
          </View>
          <View style={[styles.bucketItem, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <Text style={{ color: theme.textMuted, fontSize: 11 }}>{t('bonusCredits')}</Text>
            <Text style={{ color: theme.purple, fontWeight: '800', fontSize: 16 }}>
              {Number(wallet?.bonusCredits || 0).toFixed(1)}
            </Text>
          </View>
        </View>

        {claimBanner && (
          <Text style={{ color: theme.electricBlue, fontSize: 12, marginTop: 10 }}>{claimBanner}</Text>
        )}

        <View style={styles.walletActions}>
          <PrimaryButton
            label={wallet?.canClaimDailyToday ? `☀️ ${t('claimDaily')} (+${wallet.dailyAllowance})` : `✓ ${t('claimedToday')}`}
            onPress={handleDailyClaim}
            disabled={!wallet?.canClaimDailyToday}
            loading={claiming}
            variant={wallet?.canClaimDailyToday ? 'blue' : 'outline'}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            label={`+ ${t('buyCredits')}`}
            onPress={() => navigate('BUY_CREDITS')}
            variant="purple"
          />
        </View>
      </GlowCard>

      {/* Active AI Model Selector Bar */}
      <TouchableOpacity onPress={() => navigate('MODEL_SELECTION')}>
        <GlowCard style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '700' }}>
              ACTIVE AI MODEL ROUTER
            </Text>
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: '800', marginTop: 2 }}>
              🧠 {selectedModel?.displayName || 'Select AI Model'}{' '}
              <Text style={{ color: theme.electricBlue, fontSize: 12 }}>
                ({selectedModel?.providerName || 'Multi-Provider'})
              </Text>
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: 2 }}>
              {selectedModel?.isAvailableNow
                ? `Connected • Min ${selectedModel?.pricing?.minimumCreditCharge} cr`
                : selectedModel?.unavailableReason || 'Configure API key in Owner Hub'}
            </Text>
          </View>
          <Text style={{ color: theme.purple, fontWeight: '800', fontSize: 13 }}>Change →</Text>
        </GlowCard>
      </TouchableOpacity>

      {/* Quick AI Tools Grid */}
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('quickTools')}</Text>
      <View style={styles.toolsGrid}>
        {QUICK_TOOLS.map((tool) => (
          <TouchableOpacity
            key={tool.screen}
            onPress={() => {
              if (tool.screen === 'AI_CHAT') setActiveConversationId(null);
              navigate(tool.screen);
            }}
            style={[styles.toolTile, { backgroundColor: theme.card, borderColor: theme.border }]}
          >
            <Text style={{ fontSize: 24 }}>{tool.icon}</Text>
            <Text style={{ color: theme.text, fontWeight: '800', fontSize: 13.5, marginTop: 8 }}>
              {tool.title}
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: 11.5, marginTop: 2 }}>
              {tool.subtitle}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Recent Conversations */}
      <View style={styles.rowBetween}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('recentChats')}</Text>
        <TouchableOpacity onPress={() => navigate('CHAT_HISTORY')}>
          <Text style={{ color: theme.electricBlue, fontSize: 12.5, fontWeight: '700' }}>
            View All →
          </Text>
        </TouchableOpacity>
      </View>

      {recentConvs.length === 0 ? (
        <GlowCard>
          <Text style={{ color: theme.textMuted, fontSize: 13 }}>
            No conversations yet. Start a Sinhala or English AI session now!
          </Text>
          <PrimaryButton
            label={`+ ${t('newChat')}`}
            onPress={() => {
              setActiveConversationId(null);
              navigate('AI_CHAT');
            }}
            style={{ marginTop: 10, alignSelf: 'flex-start' }}
          />
        </GlowCard>
      ) : (
        recentConvs.map((c) => (
          <TouchableOpacity
            key={c.id}
            onPress={() => {
              setActiveConversationId(c.id);
              navigate('AI_CHAT');
            }}
          >
            <GlowCard style={{ paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>
                  {c.title}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 11.5, marginTop: 2 }}>
                  {c.mode} • {c.message_count} messages • {Number(c.total_credits_used).toFixed(2)} cr
                </Text>
              </View>
              <Text style={{ color: theme.electricBlue, fontWeight: '800' }}>→</Text>
            </GlowCard>
          </TouchableOpacity>
        ))
      )}

      {/* Account & Billing Quick Links */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
        <PrimaryButton label="👤 Profile" variant="outline" onPress={() => navigate('USER_PROFILE')} />
        <PrimaryButton label="🧾 Invoices" variant="outline" onPress={() => navigate('PAYMENT_HISTORY')} />
        <PrimaryButton label="❓ Support" variant="outline" onPress={() => navigate('HELP_SUPPORT')} />
        {user && ['OWNER', 'ADMIN', 'SUPPORT'].includes(user.role) && (
          <PrimaryButton
            label="🛡️ Owner Governance"
            variant="blue"
            onPress={() => navigate('ADMIN_DASHBOARD')}
          />
        )}
      </View>
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  walletTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  bigBalance: { fontSize: 30, fontWeight: '900', marginTop: 4 },
  planBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  bucketGrid: { flexDirection: 'row', gap: 8, marginTop: 14 },
  bucketItem: { flex: 1, padding: 10, borderRadius: 12, borderWidth: 1 },
  walletActions: { flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' },
  sectionTitle: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  toolsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  toolTile: { width: '48%', minWidth: 155, flexGrow: 1, padding: 14, borderRadius: 14, borderWidth: 1 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});

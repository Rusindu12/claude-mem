import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ScreenName, useNexora } from '../context/NexoraContext';

const BOTTOM_NAV_ITEMS: Array<{ key: ScreenName; icon: string; labelKey: string }> = [
  { key: 'HOME', icon: '⚡', labelKey: 'brand' },
  { key: 'AI_CHAT', icon: '💬', labelKey: 'aiChat' },
  { key: 'MODEL_SELECTION', icon: '🧠', labelKey: 'modelSelect' },
  { key: 'CREDIT_WALLET', icon: '💎', labelKey: 'creditWallet' },
  { key: 'SETTINGS', icon: '⚙️', labelKey: 'settings' },
];

export const ScreenShell: React.FC<{
  title: string;
  subtitle?: string;
  showBackTo?: ScreenName;
  rightAction?: React.ReactNode;
  scrollable?: boolean;
  hideNav?: boolean;
  children: React.ReactNode;
}> = ({
  title,
  subtitle,
  showBackTo,
  rightAction,
  scrollable = true,
  hideNav = false,
  children,
}) => {
  const { theme, screen, navigate, wallet, user, unreadNotifications, t, language, setLanguage } =
    useNexora();

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      {/* Top App Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: theme.bgSecondary, borderBottomColor: theme.border },
        ]}
      >
        <View style={styles.headerLeft}>
          {showBackTo ? (
            <TouchableOpacity
              onPress={() => navigate(showBackTo)}
              style={[styles.backBtn, { borderColor: theme.border, backgroundColor: theme.card }]}
            >
              <Text style={{ color: theme.electricBlue, fontWeight: '700', fontSize: 15 }}>←</Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.brandBadge, { borderColor: theme.purple }]}>
              <Text style={{ color: theme.electricBlue, fontWeight: '900', fontSize: 15 }}>N</Text>
            </View>
          )}
          <View style={{ flexShrink: 1 }}>
            <Text numberOfLines={1} style={[styles.headerTitle, { color: theme.text }]}>
              {title}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} style={{ color: theme.textMuted, fontSize: 12 }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => setLanguage(language === 'en' ? 'si' : 'en')}
            style={[styles.langChip, { borderColor: theme.border, backgroundColor: theme.card }]}
          >
            <Text style={{ color: theme.electricBlue, fontSize: 11, fontWeight: '700' }}>
              {language === 'en' ? 'සිංහල' : 'EN'}
            </Text>
          </TouchableOpacity>

          {wallet && (
            <TouchableOpacity
              onPress={() => navigate('CREDIT_WALLET')}
              style={[
                styles.creditPill,
                { backgroundColor: theme.purpleSoft, borderColor: theme.purple },
              ]}
            >
              <Text style={{ color: theme.electricBlue, fontWeight: '800', fontSize: 12 }}>
                💎 {Number(wallet.totalAvailableCredits || 0).toFixed(1)}
              </Text>
            </TouchableOpacity>
          )}

          {user && (
            <TouchableOpacity
              onPress={() => navigate('NOTIFICATIONS')}
              style={[styles.iconChip, { backgroundColor: theme.card, borderColor: theme.border }]}
            >
              <Text style={{ fontSize: 14 }}>🔔</Text>
              {unreadNotifications > 0 && (
                <View style={[styles.notifDot, { backgroundColor: theme.danger }]} />
              )}
            </TouchableOpacity>
          )}

          {user && ['OWNER', 'ADMIN', 'SUPPORT'].includes(user.role) && (
            <TouchableOpacity
              onPress={() => navigate('ADMIN_DASHBOARD')}
              style={[
                styles.ownerChip,
                { backgroundColor: theme.electricSoft, borderColor: theme.electricBlue },
              ]}
            >
              <Text style={{ color: theme.electricBlue, fontSize: 11, fontWeight: '800' }}>
                🛡️ {user.role}
              </Text>
            </TouchableOpacity>
          )}
          {rightAction}
        </View>
      </View>

      {/* Main Content */}
      <View style={styles.bodyWrapper}>
        {scrollable ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.nonScrollContent]}>{children}</View>
        )}
      </View>

      {/* Bottom Tab Navigation */}
      {!hideNav && user && (
        <View
          style={[
            styles.bottomBar,
            { backgroundColor: theme.bgSecondary, borderTopColor: theme.border },
          ]}
        >
          {BOTTOM_NAV_ITEMS.map((item) => {
            const active = screen === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                onPress={() => navigate(item.key)}
                style={[
                  styles.navTab,
                  active && { backgroundColor: theme.purpleSoft, borderColor: theme.purple },
                ]}
              >
                <Text style={{ fontSize: 16 }}>{item.icon}</Text>
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 11,
                    fontWeight: active ? '800' : '600',
                    color: active ? theme.electricBlue : theme.textMuted,
                    marginTop: 2,
                  }}
                >
                  {t(item.labelKey)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
};

export const GlowCard: React.FC<{
  children: React.ReactNode;
  accent?: 'purple' | 'blue' | 'none';
  style?: any;
}> = ({ children, accent = 'none', style }) => {
  const { theme } = useNexora();
  const borderColor =
    accent === 'purple'
      ? theme.purple
      : accent === 'blue'
        ? theme.electricBlue
        : theme.border;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.card,
          borderColor,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
};

export const PrimaryButton: React.FC<{
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'purple' | 'blue' | 'outline' | 'danger';
  style?: any;
}> = ({ label, onPress, loading, disabled, variant = 'purple', style }) => {
  const { theme } = useNexora();
  const bg =
    variant === 'purple'
      ? theme.purple
      : variant === 'blue'
        ? theme.electricBlue
        : variant === 'danger'
          ? theme.danger
          : 'transparent';
  const txtCol = variant === 'blue' ? '#05050A' : variant === 'outline' ? theme.text : '#FFFFFF';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.btn,
        {
          backgroundColor: bg,
          borderColor: variant === 'outline' ? theme.border : bg,
          opacity: disabled || loading ? 0.55 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={txtCol} />
      ) : (
        <Text style={[styles.btnText, { color: txtCol }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
};

/**
 * Renders Markdown & syntax-styled code fences with a Copy Code button.
 */
export const MarkdownMessageView: React.FC<{ content: string }> = ({ content }) => {
  const { theme } = useNexora();
  const segments = (content || '').split(/(```[\s\S]*?```)/g);

  return (
    <View style={{ gap: 8 }}>
      {segments.map((seg, idx) => {
        if (seg.startsWith('```') && seg.endsWith('```')) {
          const inner = seg.slice(3, -3);
          const firstNewline = inner.indexOf('\n');
          const lang = firstNewline !== -1 ? inner.slice(0, firstNewline).trim() : 'code';
          const code = firstNewline !== -1 ? inner.slice(firstNewline + 1) : inner;
          return (
            <View
              key={idx}
              style={[
                styles.codeContainer,
                { backgroundColor: theme.codeBg, borderColor: theme.border },
              ]}
            >
              <View style={[styles.codeHeader, { borderBottomColor: theme.border }]}>
                <Text style={{ color: theme.electricBlue, fontSize: 11, fontWeight: '700' }}>
                  {lang.toUpperCase() || 'CODE'}
                </Text>
                <TouchableOpacity onPress={() => Clipboard.setStringAsync(code)}>
                  <Text style={{ color: theme.purple, fontSize: 11, fontWeight: '700' }}>
                    📋 Copy Code
                  </Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal>
                <Text style={styles.codeText}>{code}</Text>
              </ScrollView>
            </View>
          );
        }
        if (!seg.trim()) return null;
        return (
          <Text key={idx} style={{ color: theme.text, fontSize: 14, lineHeight: 22 }}>
            {seg.trim()}
          </Text>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B0D1C',
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
  langChip: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  creditPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  ownerChip: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  bodyWrapper: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 1080 },
  scrollContent: { padding: 16, paddingBottom: 36, gap: 14 },
  nonScrollContent: { flex: 1, padding: 12 },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderTopWidth: 1,
  },
  navTab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontWeight: '800', fontSize: 14, letterSpacing: 0.3 },
  codeContainer: { borderRadius: 10, borderWidth: 1, overflow: 'hidden', marginVertical: 4 },
  codeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  codeText: {
    color: '#E2E8F0',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12.5,
    lineHeight: 19,
    padding: 12,
  },
});

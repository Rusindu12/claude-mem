import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { apiClient, downloadReleaseArtifact, getApiBaseUrl, getCustomApiBaseUrl, isEmbeddedAndroidApk, setCustomApiBaseUrl } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const LoginScreen: React.FC = () => {
  const { theme, navigate, handleAuthSuccess } = useNexora();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServerCfg, setShowServerCfg] = useState(false);
  const [serverInput, setServerInput] = useState(getCustomApiBaseUrl() || getApiBaseUrl());
  const [serverSavedMsg, setServerSavedMsg] = useState<string | null>(null);
  const inAndroidApk = isEmbeddedAndroidApk();

  const onLogin = async (customEmail?: string, customPassword?: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiClient.request('/auth/login', {
        method: 'POST',
        body: {
          email: customEmail ?? email,
          password: customPassword ?? password,
        },
      });
      await handleAuthSuccess(res);
    } catch (err: any) {
      setError(err.message || 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenShell
      title="Sign In to NEXORA AI"
      subtitle="INTELLIGENCE WITHOUT LIMITS"
      showBackTo="ONBOARDING"
      hideNav
    >
      <View style={{ maxWidth: 460, alignSelf: 'center', width: '100%', gap: 14 }}>
        <GlowCard accent="purple">
          <Text style={[styles.heading, { color: theme.text }]}>Welcome Back</Text>
          <Text style={{ color: theme.textMuted, fontSize: 13, marginBottom: 14 }}>
            Access your multi-model AI workspace, credit wallet, and history.
          </Text>

          {error && (
            <View style={[styles.errBox, { borderColor: theme.danger }]}>
              <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
            </View>
          )}

          <Text style={[styles.label, { color: theme.textSecondary }]}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.lk"
            placeholderTextColor={theme.textMuted}
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
          />

          <Text style={[styles.label, { color: theme.textSecondary }]}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••••••"
            placeholderTextColor={theme.textMuted}
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
          />

          <TouchableOpacity
            onPress={() => navigate('PASSWORD_RECOVERY')}
            style={{ alignSelf: 'flex-end', marginTop: 8 }}
          >
            <Text style={{ color: theme.electricBlue, fontSize: 12, fontWeight: '700' }}>
              Forgot Password?
            </Text>
          </TouchableOpacity>

          <PrimaryButton
            label="Sign In"
            onPress={() => onLogin()}
            loading={loading}
            style={{ marginTop: 16 }}
          />

          <TouchableOpacity
            onPress={() => navigate('REGISTER')}
            style={{ marginTop: 16, alignItems: 'center' }}
          >
            <Text style={{ color: theme.purple, fontWeight: '700', fontSize: 13 }}>
              New to NEXORA AI? Create Free Account →
            </Text>
          </TouchableOpacity>
        </GlowCard>

        <GlowCard accent="blue">
          <Text style={{ color: theme.electricBlue, fontWeight: '800', fontSize: 13, marginBottom: 6 }}>
            🛡️ Sandbox Owner Evaluation Access
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: 12, marginBottom: 10 }}>
            Sign in directly as the bootstrapped Platform Owner (`owner@nexora.ai`) to inspect the Owner Governance Dashboard, AI Provider Keys, Budgets & GAAP Analytics:
          </Text>
          <PrimaryButton
            label="Quick Sign In as Platform Owner"
            variant="blue"
            loading={loading}
            onPress={() => onLogin('owner@nexora.ai', 'NexoraOwner#2026!')}
          />
        </GlowCard>

        {!inAndroidApk && (
          <GlowCard accent="purple">
            <Text style={{ color: theme.success, fontWeight: '900', fontSize: 14, marginBottom: 4 }}>
              📲 Download NEXORA AI Apps (Android APK & Web Bundle)
            </Text>
            <Text style={{ color: theme.textSecondary, fontSize: 12, marginBottom: 10 }}>
              Install the signed Android APK (`com.nexora.ai`) directly on your phone or download the standalone production Web App package:
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
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

        <GlowCard>
          <TouchableOpacity onPress={() => setShowServerCfg(!showServerCfg)}>
            <Text style={{ color: theme.textSecondary, fontWeight: '800', fontSize: 12.5 }}>
              ⚙️ Cloud Server Endpoint ({getApiBaseUrl()}) {showServerCfg ? '▲' : '▼'}
            </Text>
          </TouchableOpacity>
          {showServerCfg && (
            <View style={{ marginTop: 10, gap: 8 }}>
              <Text style={{ color: theme.textMuted, fontSize: 11.5 }}>
                Connected to NEXORA AI Cloud Backend. When deploying your own VPS/domain, enter your server URL (e.g. https://nexora.lk):
              </Text>
              <TextInput
                value={serverInput}
                onChangeText={setServerInput}
                autoCapitalize="none"
                placeholder="https://your-domain.com/api/v1"
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
              />
              {serverSavedMsg && (
                <Text style={{ color: theme.success, fontSize: 12, fontWeight: '700' }}>{serverSavedMsg}</Text>
              )}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <PrimaryButton
                  label="Save Server URL"
                  onPress={async () => {
                    await setCustomApiBaseUrl(serverInput);
                    setServerSavedMsg(`Connected to: ${getApiBaseUrl()}`);
                  }}
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  label="Reset Default"
                  variant="outline"
                  onPress={async () => {
                    await setCustomApiBaseUrl(null);
                    setServerInput(getApiBaseUrl());
                    setServerSavedMsg(`Reset to default: ${getApiBaseUrl()}`);
                  }}
                />
              </View>
            </View>
          )}
        </GlowCard>
      </View>
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  heading: { fontSize: 22, fontWeight: '900', marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '700', marginTop: 10, marginBottom: 5 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  errBox: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 8, backgroundColor: 'rgba(239,68,68,0.1)' },
});

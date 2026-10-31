import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const PasswordRecoveryScreen: React.FC = () => {
  const { theme, navigate } = useNexora();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const requestReset = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiClient.request('/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
      setStatusMsg(res.message);
      if (res.devResetToken) {
        setToken(res.devResetToken);
      }
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const confirmReset = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiClient.request('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword },
      });
      setStatusMsg(res.message);
      setTimeout(() => navigate('LOGIN'), 1100);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenShell
      title="Password Recovery"
      subtitle="Single-use token verification & session revocation"
      showBackTo="LOGIN"
      hideNav
    >
      <View style={{ maxWidth: 460, alignSelf: 'center', width: '100%' }}>
        <GlowCard accent="purple">
          {statusMsg && (
            <Text style={{ color: theme.success, fontSize: 13, marginBottom: 10 }}>{statusMsg}</Text>
          )}
          {error && (
            <Text style={{ color: theme.danger, fontSize: 13, marginBottom: 10 }}>{error}</Text>
          )}

          {step === 1 ? (
            <>
              <Text style={[styles.label, { color: theme.textSecondary }]}>Registered Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                placeholder="you@example.lk"
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
              />
              <PrimaryButton
                label="Send Recovery Token"
                onPress={requestReset}
                loading={loading}
                style={{ marginTop: 14 }}
              />
            </>
          ) : (
            <>
              <Text style={[styles.label, { color: theme.textSecondary }]}>Recovery Token</Text>
              <TextInput
                value={token}
                onChangeText={setToken}
                placeholder="Paste recovery token"
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
              />
              <Text style={[styles.label, { color: theme.textSecondary }]}>New Password</Text>
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                placeholder="Min 8 characters"
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
              />
              <PrimaryButton
                label="Reset Password & Revoke Old Sessions"
                variant="blue"
                onPress={confirmReset}
                loading={loading}
                style={{ marginTop: 14 }}
              />
            </>
          )}
        </GlowCard>
      </View>
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '700', marginTop: 8, marginBottom: 5 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
});

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const RegisterScreen: React.FC = () => {
  const { theme, navigate, handleAuthSuccess, language } = useNexora();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [countryCode, setCountryCode] = useState('LK');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiClient.request('/auth/register', {
        method: 'POST',
        body: {
          fullName,
          email,
          password,
          countryCode,
          preferredLanguage: language,
          referralCode: referralCode.trim() || undefined,
        },
      });
      await handleAuthSuccess(res);
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenShell
      title="Create NEXORA Account"
      subtitle="Claim 25 Daily Free + 50 Welcome Bonus Credits"
      showBackTo="ONBOARDING"
      hideNav
    >
      <View style={{ maxWidth: 480, alignSelf: 'center', width: '100%', gap: 14 }}>
        <GlowCard accent="purple">
          <Text style={[styles.heading, { color: theme.text }]}>Join NEXORA AI</Text>
          <Text style={{ color: theme.textMuted, fontSize: 13, marginBottom: 16 }}>
            INTELLIGENCE WITHOUT LIMITS • Sri Lanka & Global Multi-Model Platform
          </Text>

          {error && (
            <View style={[styles.errBox, { borderColor: theme.danger }]}>
              <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
            </View>
          )}

          <Text style={[styles.label, { color: theme.textSecondary }]}>Full Name</Text>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            placeholder="Kasun Perera"
            placeholderTextColor={theme.textMuted}
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
          />

          <Text style={[styles.label, { color: theme.textSecondary }]}>Email Address</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.lk"
            placeholderTextColor={theme.textMuted}
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
          />

          <Text style={[styles.label, { color: theme.textSecondary }]}>Password (min 8 chars)</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••••••"
            placeholderTextColor={theme.textMuted}
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
          />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>Country ISO</Text>
              <TextInput
                value={countryCode}
                onChangeText={setCountryCode}
                maxLength={3}
                placeholder="LK"
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
              />
            </View>
            <View style={{ flex: 2 }}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>Referral Code (Optional)</Text>
              <TextInput
                value={referralCode}
                onChangeText={setReferralCode}
                autoCapitalize="characters"
                placeholder="NXR..."
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
              />
            </View>
          </View>

          <PrimaryButton
            label="Create Account & Claim Free Credits"
            onPress={onSubmit}
            loading={loading}
            style={{ marginTop: 18 }}
          />

          <TouchableOpacity onPress={() => navigate('LOGIN')} style={{ marginTop: 16, alignItems: 'center' }}>
            <Text style={{ color: theme.electricBlue, fontWeight: '700', fontSize: 13 }}>
              Already registered? Sign in →
            </Text>
          </TouchableOpacity>
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

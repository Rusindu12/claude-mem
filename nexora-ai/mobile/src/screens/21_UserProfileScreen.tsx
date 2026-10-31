import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const UserProfileScreen: React.FC = () => {
  const { theme, user, refreshSessionData, signOut } = useNexora();
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [countryCode, setCountryCode] = useState(user?.countryCode || 'LK');
  const [preferredCurrency, setPreferredCurrency] = useState(user?.preferredCurrency || 'LKR');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const saveProfile = async () => {
    setMsg(null);
    setErr(null);
    try {
      await apiClient.request('/auth/me', {
        method: 'PATCH',
        body: { fullName, countryCode, preferredCurrency },
      });
      await refreshSessionData();
      setMsg('Profile updated!');
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const changePwd = async () => {
    setMsg(null);
    setErr(null);
    try {
      const r = await apiClient.request('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setMsg(r.message);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <ScreenShell
      title="User Profile & Security"
      subtitle={`${user?.email || ''} • Role: ${user?.role || 'USER'}`}
      showBackTo="HOME"
    >
      {msg && (
        <GlowCard>
          <Text style={{ color: theme.success, fontWeight: '700' }}>{msg}</Text>
        </GlowCard>
      )}
      {err && (
        <GlowCard>
          <Text style={{ color: theme.danger, fontWeight: '700' }}>{err}</Text>
        </GlowCard>
      )}

      <GlowCard accent="purple">
        <Text style={{ color: theme.text, fontWeight: '800', fontSize: 16, marginBottom: 10 }}>
          Account Identity
        </Text>
        <Text style={[styles.label, { color: theme.textSecondary }]}>Full Name</Text>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
        />

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Country ISO</Text>
            <TextInput
              value={countryCode}
              onChangeText={setCountryCode}
              maxLength={3}
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Preferred Currency</Text>
            <TextInput
              value={preferredCurrency}
              onChangeText={setPreferredCurrency}
              maxLength={3}
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
            />
          </View>
        </View>

        <PrimaryButton label="Save Profile" onPress={saveProfile} style={{ marginTop: 14 }} />
      </GlowCard>

      <GlowCard>
        <Text style={{ color: theme.text, fontWeight: '800', fontSize: 16, marginBottom: 10 }}>
          Change Password
        </Text>
        <TextInput
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          placeholder="Current Password"
          placeholderTextColor={theme.textMuted}
          style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary, marginBottom: 8 }]}
        />
        <TextInput
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          placeholder="New Password (min 8 chars)"
          placeholderTextColor={theme.textMuted}
          style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
        />
        <PrimaryButton label="Update Password" variant="blue" onPress={changePwd} style={{ marginTop: 12 }} />
      </GlowCard>

      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <PrimaryButton label="Sign Out (This Device)" variant="outline" onPress={() => signOut(false)} />
        <PrimaryButton label="Revoke All Active Devices" variant="danger" onPress={() => signOut(true)} />
      </View>
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
});

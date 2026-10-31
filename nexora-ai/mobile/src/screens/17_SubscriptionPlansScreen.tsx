import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const SubscriptionPlansScreen: React.FC = () => {
  const { theme, user } = useNexora();
  const [plans, setPlans] = useState<any[]>([]);
  const [activeSub, setActiveSub] = useState<any | null>(null);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [freshPlainKey, setFreshPlainKey] = useState<string | null>(null);
  const [currency, setCurrency] = useState<'LKR' | 'USD'>('LKR');
  const [checkoutRes, setCheckoutRes] = useState<any | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadAll = async () => {
    const [cat, subRes, keys] = await Promise.all([
      apiClient.request('/payments/catalog'),
      apiClient.request('/payments/subscription'),
      apiClient.request('/platform/api-keys').catch(() => []),
    ]);
    setPlans(cat.subscriptionPlans || cat.plans || []);
    setActiveSub(subRes?.activeSubscription ?? subRes ?? null);
    setApiKeys(keys || []);
  };

  useEffect(() => {
    loadAll().catch(() => undefined);
  }, []);

  const subscribe = async (plan: any) => {
    setMsg(null);
    const provider = currency === 'LKR' ? 'PAYHERE' : 'STRIPE';
    const res = await apiClient.request('/payments/checkout', {
      method: 'POST',
      body: {
        paymentType: 'SUBSCRIPTION',
        planId: plan.id,
        provider,
        currency,
      },
    });
    setCheckoutRes(res);
  };

  const cancelAutoRenew = async () => {
    if (!activeSub?.id) return;
    const res = await apiClient.request(`/payments/subscription/${activeSub.id}/cancel`, {
      method: 'POST',
    });
    setMsg(res.message || 'Auto-renewal cancelled at period end.');
    await loadAll();
  };

  const createBusinessApiKey = async () => {
    if (!newKeyName.trim()) return;
    setMsg(null);
    try {
      const created = await apiClient.request('/platform/api-keys', {
        method: 'POST',
        body: { name: newKeyName.trim() },
      });
      setFreshPlainKey(created.apiKey);
      setNewKeyName('');
      await loadAll();
    } catch (err: any) {
      setMsg(err.message);
    }
  };

  return (
    <ScreenShell
      title="Subscriptions & Business API"
      subtitle="Free, Monthly, Annual, Business & Enterprise Tiers"
      showBackTo="HOME"
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {(['LKR', 'USD'] as const).map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => setCurrency(c)}
            style={[
              styles.chip,
              {
                borderColor: currency === c ? theme.electricBlue : theme.border,
                backgroundColor: currency === c ? theme.electricSoft : theme.card,
              },
            ]}
          >
            <Text style={{ color: theme.text, fontWeight: '800' }}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeSub && (
        <GlowCard accent="blue">
          <Text style={{ color: theme.electricBlue, fontWeight: '900', fontSize: 15 }}>
            ⚡ Active Subscription: {activeSub.plan_name} ({activeSub.status})
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: 12.5, marginTop: 4 }}>
            Renews / Ends: {new Date(activeSub.current_period_end).toLocaleDateString()} • Cancel at Period End:{' '}
            {activeSub.cancel_at_period_end ? 'Yes' : 'No'}
          </Text>
          {!activeSub.cancel_at_period_end && (
            <PrimaryButton
              label="Cancel Auto-Renewal at Period End"
              variant="outline"
              onPress={cancelAutoRenew}
              style={{ marginTop: 10 }}
            />
          )}
        </GlowCard>
      )}

      {checkoutRes && (
        <GlowCard accent="purple">
          <Text style={{ color: theme.electricBlue, fontWeight: '800' }}>
            Order {checkoutRes.orderNumber} Pending Gateway Confirmation ({checkoutRes.currency}{' '}
            {checkoutRes.amount})
          </Text>
        </GlowCard>
      )}

      {msg && (
        <GlowCard>
          <Text style={{ color: theme.warning, fontSize: 12.5 }}>{msg}</Text>
        </GlowCard>
      )}

      {plans.map((p) => {
        const isCurrent = (user?.activePlanCode || 'FREE') === p.code;
        const price =
          Number(p.price_usd) === 0
            ? 'Free Forever'
            : currency === 'LKR'
              ? `LKR ${Number(p.price_lkr).toLocaleString()} / ${p.billing_interval.toLowerCase()}`
              : `$${Number(p.price_usd).toFixed(2)} / ${p.billing_interval.toLowerCase()}`;

        return (
          <GlowCard key={p.id} accent={isCurrent ? 'blue' : 'none'}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <Text style={{ color: theme.text, fontSize: 17, fontWeight: '900' }}>{p.name}</Text>
              <Text style={{ color: theme.electricBlue, fontSize: 15, fontWeight: '900' }}>
                {price}
              </Text>
            </View>
            <Text style={{ color: theme.textSecondary, fontSize: 12.5, marginTop: 6 }}>
              • +{p.daily_free_credits} Daily Free Credits • +{p.included_bonus_credits ?? p.monthly_included_credits ?? 0} Included Credits •{' '}
              {p.rate_limit_rpm} req/min {p.allows_business_api || p.api_access_enabled ? '• Business REST API Enabled' : ''}
            </Text>
            {Number(p.price_usd) > 0 && (
              <PrimaryButton
                label={isCurrent ? '✓ Active Plan' : `Upgrade to ${p.name}`}
                variant={isCurrent ? 'outline' : 'purple'}
                disabled={isCurrent}
                onPress={() => subscribe(p)}
                style={{ marginTop: 12 }}
              />
            )}
          </GlowCard>
        );
      })}

      {/* Business & Enterprise API Access */}
      <GlowCard accent="purple">
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '900' }}>
          🔑 Business & Developer API Keys (`X-API-Key`)
        </Text>
        <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>
          Available on Business, Enterprise, and Owner accounts for programmatic access to NEXORA AI.
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <TextInput
            value={newKeyName}
            onChangeText={setNewKeyName}
            placeholder="Key label (e.g., Production ERP Bot)"
            placeholderTextColor={theme.textMuted}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary },
            ]}
          />
          <PrimaryButton label="Generate Key" onPress={createBusinessApiKey} />
        </View>

        {freshPlainKey && (
          <View style={{ marginTop: 10 }}>
            <Text style={{ color: theme.success, fontSize: 12, fontWeight: '800' }}>
              Copy your secret key now (shown once): {freshPlainKey}
            </Text>
            <PrimaryButton
              label="Copy Secret Key"
              variant="blue"
              onPress={() => Clipboard.setStringAsync(freshPlainKey)}
              style={{ marginTop: 6 }}
            />
          </View>
        )}

        {apiKeys.map((k) => (
          <View key={k.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
            <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
              {k.name} ({k.key_prefix}•••) • {k.is_active ? 'Active' : 'Revoked'}
            </Text>
            {k.is_active && (
              <TouchableOpacity
                onPress={async () => {
                  await apiClient.request(`/platform/api-keys/${k.id}`, { method: 'DELETE' });
                  loadAll();
                }}
              >
                <Text style={{ color: theme.danger, fontSize: 12, fontWeight: '700' }}>Revoke</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </GlowCard>
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
});

import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const AdminOwnerDashboardScreen: React.FC = () => {
  const { theme, user, refreshSessionData } = useNexora();
  const [tab, setTab] = useState<'ANALYTICS' | 'PROVIDERS' | 'MODELS' | 'USERS' | 'AUDIT'>('ANALYTICS');
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [promoCode, setPromoCode] = useState('');
  const [promoCredits, setPromoCredits] = useState('150');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const loadTab = async () => {
    setErrMsg(null);
    try {
      if (tab === 'ANALYTICS' && ['OWNER', 'ADMIN'].includes(user?.role)) {
        const a = await apiClient.request('/admin/analytics');
        setAnalytics(a);
      } else if ((tab === 'PROVIDERS' || tab === 'MODELS') && ['OWNER', 'ADMIN'].includes(user?.role)) {
        const pm = await apiClient.request('/admin/providers');
        setProviders(pm.providers || []);
        setModels(pm.models || []);
      } else if (tab === 'USERS') {
        const u = await apiClient.request('/admin/users');
        setUsersList(u || []);
      } else if (tab === 'AUDIT' && ['OWNER', 'ADMIN'].includes(user?.role)) {
        const logs = await apiClient.request('/admin/audit-logs');
        setAuditLogs(logs || []);
      }
    } catch (e: any) {
      setErrMsg(e.message);
    }
  };

  useEffect(() => {
    loadTab();
  }, [tab]);

  const ownerHeaders = (): Record<string, string> =>
    stepUpPassword ? { 'X-Confirm-Password': stepUpPassword } : {};

  const saveProviderKey = async (providerId: string, providerName: string) => {
    setStatusMsg(null);
    setErrMsg(null);
    try {
      await apiClient.request(`/admin/providers/${providerId}/credentials`, {
        method: 'PATCH',
        headers: ownerHeaders(),
        body: {
          apiKey: apiKeyInputs[providerId] || undefined,
          isEnabled: true,
        },
      });
      setApiKeyInputs((prev) => ({ ...prev, [providerId]: '' }));
      setStatusMsg(`Encrypted AES-256-GCM credentials saved for ${providerName}.`);
      await loadTab();
      await refreshSessionData();
    } catch (e: any) {
      setErrMsg(e.message);
    }
  };

  const toggleModel = async (m: any) => {
    setStatusMsg(null);
    setErrMsg(null);
    try {
      await apiClient.request(`/admin/models/${m.id}`, {
        method: 'PATCH',
        body: { isEnabled: !m.is_enabled },
      });
      setStatusMsg(`${m.display_name} ${!m.is_enabled ? 'enabled' : 'disabled'}.`);
      await loadTab();
      await refreshSessionData();
    } catch (e: any) {
      setErrMsg(e.message);
    }
  };

  const grantBonusToUser = async (targetUserId: string) => {
    setStatusMsg(null);
    setErrMsg(null);
    try {
      await apiClient.request(`/admin/users/${targetUserId}/grant-credits`, {
        method: 'POST',
        body: { amount: 100, reason: 'Admin customer care credit grant' },
      });
      setStatusMsg('Granted +100 Bonus Credits & recorded immutable audit log.');
      await loadTab();
    } catch (e: any) {
      setErrMsg(e.message);
    }
  };

  const createPromo = async () => {
    if (!promoCode.trim()) return;
    setStatusMsg(null);
    setErrMsg(null);
    try {
      await apiClient.request('/admin/promos', {
        method: 'POST',
        body: {
          code: promoCode.trim(),
          rewardType: 'BONUS_CREDITS',
          bonusCredits: Number(promoCredits) || 100,
          maxRedemptions: 500,
        },
      });
      setPromoCode('');
      setStatusMsg('Promotional code created!');
    } catch (e: any) {
      setErrMsg(e.message);
    }
  };

  const sum = analytics?.summary;
  const apiSettlement = analytics?.apiCostSettlementFromPayments;

  const toggleFreeAiOnlyMode = async () => {
    if (!apiSettlement) return;
    setStatusMsg(null);
    setErrMsg(null);
    try {
      const nextEnabled = !apiSettlement.freeAiOnlyMode;
      await apiClient.request('/admin/system/settings/platform.free_ai_only_mode', {
        method: 'PATCH',
        headers: ownerHeaders(),
        body: {
          value: { enabled: nextEnabled },
        },
      });
      setStatusMsg(
        nextEnabled
          ? 'Free-AI-Only Launch Mode ENABLED: Only $0.00 Free AI providers/models can run ($0 API bill guaranteed)!'
          : 'Free-AI-Only Launch Mode turned OFF: Paid premium providers can now be used.',
      );
      await loadTab();
      await refreshSessionData();
    } catch (e: any) {
      setErrMsg(e.message);
    }
  };

  const toggleProviderEnabled = async (p: any) => {
    setStatusMsg(null);
    setErrMsg(null);
    try {
      await apiClient.request(`/admin/providers/${p.id}/credentials`, {
        method: 'PATCH',
        headers: ownerHeaders(),
        body: { isEnabled: !p.is_enabled },
      });
      setStatusMsg(`${p.name} ${!p.is_enabled ? 'enabled' : 'disabled'}.`);
      await loadTab();
      await refreshSessionData();
    } catch (e: any) {
      setErrMsg(e.message);
    }
  };

  const togglePaymentFundedApiGuard = async () => {
    if (!apiSettlement) return;
    setStatusMsg(null);
    setErrMsg(null);
    try {
      const nextEnabled = !apiSettlement.strictPaymentGuardEnabled;
      await apiClient.request('/admin/system/settings/finance.payment_funded_api_guard', {
        method: 'PATCH',
        headers: ownerHeaders(),
        body: {
          value: {
            enabled: nextEnabled,
            reserveAllocationPercent: apiSettlement.reserveAllocationPercent ?? 35,
            initialFloatUsd: apiSettlement.initialFloatUsd ?? 0,
          },
        },
      });
      setStatusMsg(
        nextEnabled
          ? 'Strict Payment-Funded API Guard ENABLED: AI API usage is now capped strictly within collected customer payment reserve!'
          : 'Strict Payment-Funded API Guard disabled.',
      );
      await loadTab();
    } catch (e: any) {
      setErrMsg(e.message);
    }
  };

  return (
    <ScreenShell
      title="Owner & Admin Governance Hub"
      subtitle={`Server-Verified RBAC Role: ${user?.role} • Step-Up & Audit Protected`}
      showBackTo="HOME"
    >
      {/* Owner Step-Up Password Bar */}
      {user?.role === 'OWNER' && (
        <GlowCard accent="purple" style={{ paddingVertical: 12 }}>
          <Text style={{ color: theme.electricBlue, fontWeight: '800', fontSize: 12.5 }}>
            🔐 Owner Step-Up Re-Authentication (`X-Confirm-Password`)
          </Text>
          <TextInput
            value={stepUpPassword}
            onChangeText={setStepUpPassword}
            secureTextEntry
            placeholder="Enter Owner password before modifying API keys, budgets, or roles..."
            placeholderTextColor={theme.textMuted}
            style={[
              styles.input,
              {
                color: theme.text,
                borderColor: theme.border,
                backgroundColor: theme.bgSecondary,
                marginTop: 8,
              },
            ]}
          />
        </GlowCard>
      )}

      {/* Governance Sub-Navigation */}
      <View style={styles.tabs}>
        {(['ANALYTICS', 'PROVIDERS', 'MODELS', 'USERS', 'AUDIT'] as const).map((tKey) => (
          <TouchableOpacity
            key={tKey}
            onPress={() => setTab(tKey)}
            style={[
              styles.tabBtn,
              {
                borderColor: tab === tKey ? theme.electricBlue : theme.border,
                backgroundColor: tab === tKey ? theme.electricSoft : theme.card,
              },
            ]}
          >
            <Text style={{ color: theme.text, fontWeight: '800', fontSize: 12 }}>{tKey}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {statusMsg && (
        <GlowCard>
          <Text style={{ color: theme.success, fontWeight: '700', fontSize: 13 }}>{statusMsg}</Text>
        </GlowCard>
      )}
      {errMsg && (
        <GlowCard>
          <Text style={{ color: theme.danger, fontWeight: '700', fontSize: 13 }}>⚠ {errMsg}</Text>
        </GlowCard>
      )}

      {/* TAB 1: GAAP Financial & Usage Analytics */}
      {tab === 'ANALYTICS' && sum && (
        <>
          {apiSettlement && (
            <GlowCard accent={apiSettlement.freeAiOnlyMode ? 'blue' : 'purple'}>
              <Text style={{ color: theme.success, fontWeight: '900', fontSize: 16 }}>
                🆓 {apiSettlement.freeAiOnlyMode ? 'Free-AI-Only Launch Mode: ACTIVE ($0 API Bill)' : 'Paid + Free Hybrid Mode: ACTIVE'}
              </Text>
              <Text style={{ color: theme.textSecondary, fontSize: 12.5, marginTop: 4, lineHeight: 19 }}>
                {apiSettlement.freeAiOnlyMode
                  ? 'NEXORA AI is currently running ONLY $0.00 Free AI providers (Pollinations Zero-Key AI, Free Gemini/Groq/OpenRouter, or Local Ollama). Paid models are locked so your API bill stays $0.00 while you collect customer payments!'
                  : 'Both Free AI and Paid Premium AI models are unlocked. You can switch back to Free-AI-Only Mode anytime.'}
              </Text>
              {user?.role === 'OWNER' && (
                <PrimaryButton
                  label={
                    apiSettlement.freeAiOnlyMode
                      ? '🔓 Unlock Paid AI Models (Requires Owner Step-Up Password)'
                      : '🆓 Switch Back to Free-AI-Only Mode ($0 API Cost)'
                  }
                  variant={apiSettlement.freeAiOnlyMode ? 'outline' : 'blue'}
                  onPress={toggleFreeAiOnlyMode}
                  style={{ marginTop: 12 }}
                />
              )}
            </GlowCard>
          )}

          <GlowCard accent="blue">
            <Text style={{ color: theme.electricBlue, fontWeight: '900', fontSize: 16 }}>
              📊 GAAP Financial Accounting & Deferred Liability
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: 11.5, marginTop: 2 }}>
              Basis: {analytics.accountingBasis} — Unused purchased credits are tracked as Deferred Liability, NEVER falsely counted as realized profit!
            </Text>

            <View style={styles.kpiGrid}>
              <View style={[styles.kpi, { borderColor: theme.border }]}>
                <Text style={{ color: theme.textMuted, fontSize: 11 }}>Gross Cash Collected</Text>
                <Text style={{ color: theme.text, fontWeight: '900', fontSize: 18 }}>
                  ${Number(sum.grossCashReceiptsUsd || 0).toFixed(2)}
                </Text>
              </View>
              <View style={[styles.kpi, { borderColor: theme.warning }]}>
                <Text style={{ color: theme.warning, fontSize: 11 }}>Deferred Credit Liability</Text>
                <Text style={{ color: theme.warning, fontWeight: '900', fontSize: 18 }}>
                  ${Number(sum.totalFutureServiceObligationUsd || 0).toFixed(2)}
                </Text>
              </View>
              <View style={[styles.kpi, { borderColor: theme.success }]}>
                <Text style={{ color: theme.success, fontSize: 11 }}>Realized Earned Revenue</Text>
                <Text style={{ color: theme.success, fontWeight: '900', fontSize: 18 }}>
                  ${Number(sum.totalRealizedRevenueUsd || 0).toFixed(2)}
                </Text>
              </View>
              <View style={[styles.kpi, { borderColor: theme.purple }]}>
                <Text style={{ color: theme.purple, fontSize: 11 }}>AI Provider API Spend</Text>
                <Text style={{ color: theme.text, fontWeight: '900', fontSize: 18 }}>
                  ${Number(sum.aiApiExpensesUsd || 0).toFixed(4)}
                </Text>
              </View>
              <View style={[styles.kpi, { borderColor: theme.electricBlue }]}>
                <Text style={{ color: theme.electricBlue, fontSize: 11 }}>Accrual Net Profit (USD)</Text>
                <Text style={{ color: theme.electricBlue, fontWeight: '900', fontSize: 18 }}>
                  ${Number(sum.netProfitUsd || 0).toFixed(2)}
                </Text>
              </View>
            </View>
          </GlowCard>

          {apiSettlement && (
            <GlowCard accent="purple">
              <Text style={{ color: theme.electricBlue, fontWeight: '900', fontSize: 15.5 }}>
                💳 AI API Key Cost Deduction from Customer Payments (LKR & USD)
              </Text>
              <Text style={{ color: theme.textMuted, fontSize: 11.5, marginTop: 3 }}>
                Automatically sets aside {apiSettlement.reserveAllocationPercent}% of verified PayHere/Stripe payments to cover AI API bills and deducts exact token/media usage cost.
              </Text>

              <View style={styles.kpiGrid}>
                <View style={[styles.kpi, { borderColor: theme.border }]}>
                  <Text style={{ color: theme.textMuted, fontSize: 11 }}>Net Payments Collected</Text>
                  <Text style={{ color: theme.text, fontWeight: '900', fontSize: 16 }}>
                    LKR {Number(apiSettlement.netPaymentsAfterGatewayFeesLkr || 0).toLocaleString()}
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                    (${Number(apiSettlement.netPaymentsAfterGatewayFeesUsd || 0).toFixed(2)})
                  </Text>
                </View>

                <View style={[styles.kpi, { borderColor: theme.danger }]}>
                  <Text style={{ color: theme.danger, fontSize: 11 }}>AI API Cost Deducted</Text>
                  <Text style={{ color: theme.danger, fontWeight: '900', fontSize: 16 }}>
                    -LKR {Number(apiSettlement.aiApiCostDeductedLkr || 0).toLocaleString()}
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                    (-${Number(apiSettlement.aiApiCostDeductedUsd || 0).toFixed(4)})
                  </Text>
                </View>

                <View style={[styles.kpi, { borderColor: theme.electricBlue }]}>
                  <Text style={{ color: theme.electricBlue, fontSize: 11 }}>API Reserve Pool Left</Text>
                  <Text style={{ color: theme.electricBlue, fontWeight: '900', fontSize: 16 }}>
                    LKR {Number(apiSettlement.remainingApiReserveLkr || 0).toLocaleString()}
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                    (${Number(apiSettlement.remainingApiReserveUsd || 0).toFixed(4)})
                  </Text>
                </View>

                <View style={[styles.kpi, { borderColor: theme.success }]}>
                  <Text style={{ color: theme.success, fontSize: 11 }}>Owner Net After API Cost</Text>
                  <Text style={{ color: theme.success, fontWeight: '900', fontSize: 16 }}>
                    LKR {Number(apiSettlement.ownerNetAfterApiCostLkr || 0).toLocaleString()}
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                    (${Number(apiSettlement.ownerNetAfterApiCostUsd || 0).toFixed(2)})
                  </Text>
                </View>
              </View>

              {user?.role === 'OWNER' && (
                <PrimaryButton
                  label={
                    apiSettlement.strictPaymentGuardEnabled
                      ? '🛡️ Payment-Only API Guard: ON (Tap to Disable)'
                      : '🛡️ Enable Strict Payment-Only API Guard (Zero Out-of-Pocket Loss)'
                  }
                  variant={apiSettlement.strictPaymentGuardEnabled ? 'blue' : 'outline'}
                  onPress={togglePaymentFundedApiGuard}
                  style={{ marginTop: 12 }}
                />
              )}
            </GlowCard>
          )}

          <GlowCard>
            <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15 }}>
              👥 Platform Scale & AI Usage Metrics
            </Text>
            <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 6 }}>
              Total Users: {sum.totalUsers} • Active Paid Subscriptions: {sum.activeSubscriptions} • AI Requests:{' '}
              {sum.totalAiRequests} • Tokens Processed: {sum.totalTokensProcessed}
            </Text>
          </GlowCard>

          <GlowCard>
            <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15, marginBottom: 8 }}>
              🎟️ Create Promotional Credit Code
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <TextInput
                value={promoCode}
                onChangeText={setPromoCode}
                autoCapitalize="characters"
                placeholder="CODE (e.g. LANKA150)"
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { flex: 2, color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
              />
              <TextInput
                value={promoCredits}
                onChangeText={setPromoCredits}
                keyboardType="numeric"
                placeholder="Credits"
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { flex: 1, color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary }]}
              />
              <PrimaryButton label="Create" onPress={createPromo} />
            </View>
          </GlowCard>
        </>
      )}

      {/* TAB 2: AI Providers & Encrypted Keys + Budgets */}
      {tab === 'PROVIDERS' && (
        <GlowCard accent="purple">
          <Text style={{ color: theme.electricBlue, fontWeight: '800', fontSize: 13 }}>
            🔑 Connect Your Own Provider Accounts (Encrypted with AES-256-GCM)
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 18 }}>
            • Free-tier starter keys: Google Gemini (aistudio.google.com/apikey) or Groq OSS (console.groq.com/keys){'\n'}
            • Commercial paid keys: OpenAI (platform.openai.com) & Anthropic (console.anthropic.com){'\n'}
            • 100% of customer PayHere/Stripe payments go directly to YOUR merchant account; NEXORA tracks & deducts exact API costs in the Analytics tab.
          </Text>
        </GlowCard>
      )}
      {tab === 'PROVIDERS' &&
        providers.map((p) => (
          <GlowCard key={p.id} accent={p.isFreeProvider ? 'blue' : p.hasApiKeyConfigured ? 'purple' : 'none'}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
              <Text style={{ color: theme.text, fontWeight: '900', fontSize: 16 }}>
                {p.isFreeProvider ? '🆓 ' : ''}{p.name} ({p.code})
              </Text>
              <Text
                style={{
                  color: p.hasApiKeyConfigured ? theme.success : theme.warning,
                  fontWeight: '800',
                  fontSize: 12,
                }}
              >
                {!p.requiresApiKey
                  ? '🟢 Zero-Key Free AI (Ready)'
                  : p.hasApiKeyConfigured
                    ? `Key: ${p.maskedApiKey}`
                    : 'Optional Key Not Set'}
              </Text>
            </View>
            <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>
              Status: {p.is_enabled ? 'ENABLED' : 'DISABLED'} • Health: {p.health_status} •{' '}
              {p.isFreeProvider
                ? '$0.00 Provider Cost'
                : `Daily Cap: $${Number(p.daily_budget_limit_usd || 0).toFixed(0)} (Spent: $${Number(p.current_day_spend_usd || 0).toFixed(4)})`}
            </Text>
            {user?.role === 'OWNER' && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {p.requiresApiKey && (
                  <>
                    <TextInput
                      value={apiKeyInputs[p.id] || ''}
                      onChangeText={(txt) => setApiKeyInputs((prev) => ({ ...prev, [p.id]: txt }))}
                      secureTextEntry
                      placeholder={`Paste ${p.name} API Key (AES-256-GCM encrypted)...`}
                      placeholderTextColor={theme.textMuted}
                      style={[
                        styles.input,
                        { flex: 1, minWidth: 190, color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary },
                      ]}
                    />
                    <PrimaryButton label="Save Key" onPress={() => saveProviderKey(p.id, p.name)} />
                  </>
                )}
                <PrimaryButton
                  label={p.is_enabled ? 'Enabled ✓ (Tap to Disable)' : 'Enable Provider'}
                  variant={p.is_enabled ? 'blue' : 'outline'}
                  onPress={() => toggleProviderEnabled(p)}
                />
              </View>
            )}
          </GlowCard>
        ))}

      {/* TAB 3: AI Model Toggles & Credit Pricing */}
      {tab === 'MODELS' &&
        models.map((m) => (
          <GlowCard key={m.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15 }}>
                  {m.display_name} ({m.provider_name})
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
                  {m.category} • {m.credit_cost_per_1k_input} in / {m.credit_cost_per_1k_output} out cr/1k
                </Text>
              </View>
              <PrimaryButton
                label={m.is_enabled ? 'Enabled ✓' : 'Disabled'}
                variant={m.is_enabled ? 'blue' : 'outline'}
                onPress={() => toggleModel(m)}
              />
            </View>
          </GlowCard>
        ))}

      {/* TAB 4: User Governance */}
      {tab === 'USERS' &&
        usersList.map((u) => (
          <GlowCard key={u.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <View>
                <Text style={{ color: theme.text, fontWeight: '800', fontSize: 14 }}>
                  {u.full_name} ({u.email})
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
                  Role: {u.role || u.role_name} • Free: {Number(u.free_credits || 0).toFixed(1)} | Paid:{' '}
                  {Number(u.purchased_credits || 0).toFixed(1)} | Bonus:{' '}
                  {Number(u.bonus_credits || 0).toFixed(1)}
                </Text>
              </View>
              {['OWNER', 'ADMIN'].includes(user?.role) && (
                <PrimaryButton
                  label="+100 Bonus"
                  variant="outline"
                  onPress={() => grantBonusToUser(u.id)}
                />
              )}
            </View>
          </GlowCard>
        ))}

      {/* TAB 5: Immutable Admin Audit Logs */}
      {tab === 'AUDIT' &&
        auditLogs.map((l) => (
          <GlowCard key={l.id} style={{ paddingVertical: 10 }}>
            <Text style={{ color: theme.electricBlue, fontWeight: '800', fontSize: 12.5 }}>
              {l.action} • {l.target_type} ({l.actor_role})
            </Text>
            <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 2 }}>
              Actor: {l.actor_email || l.actor_user_id} • {new Date(l.created_at).toLocaleString()}
            </Text>
          </GlowCard>
        ))}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tabBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13.5 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  kpi: { flex: 1, minWidth: 135, borderWidth: 1, borderRadius: 12, padding: 10 },
});

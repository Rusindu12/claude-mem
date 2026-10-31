import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const CreditWalletScreen: React.FC = () => {
  const { theme, wallet, navigate, refreshSessionData } = useNexora();
  const [txs, setTxs] = useState<any[]>([]);
  const [promoCode, setPromoCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadLedger = async () => {
    const res = await apiClient.request('/wallet/transactions?limit=35');
    setTxs(res.items || []);
  };

  useEffect(() => {
    loadLedger().catch(() => undefined);
  }, []);

  const claimDaily = async () => {
    setError(null);
    setMsg(null);
    setLoading(true);
    try {
      const r = await apiClient.request('/wallet/claim-daily', { method: 'POST' });
      setMsg(`Claimed +${r.creditsGranted} Colombo daily free credits (${r.claimedDateColombo})`);
      await refreshSessionData();
      await loadLedger();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const redeemPromo = async () => {
    if (!promoCode.trim()) return;
    setError(null);
    setMsg(null);
    setLoading(true);
    try {
      const r = await apiClient.request('/platform/promos/redeem', {
        method: 'POST',
        body: { code: promoCode.trim() },
      });
      setMsg(`Redeemed ${r.code}: +${r.creditsAwarded} Bonus Credits!`);
      setPromoCode('');
      await refreshSessionData();
      await loadLedger();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenShell
      title="Token Credit Wallet"
      subtitle="3-Bucket Atomic Balance & Immutable Audit Ledger"
      showBackTo="HOME"
    >
      <GlowCard accent="purple">
        <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '700' }}>
          AVAILABLE SPENDABLE CREDITS
        </Text>
        <Text style={{ color: theme.text, fontSize: 34, fontWeight: '900', marginVertical: 4 }}>
          💎 {Number(wallet?.totalAvailableCredits || 0).toFixed(3)}
        </Text>
        <Text style={{ color: theme.textMuted, fontSize: 11.5 }}>
          Colombo Date: {wallet?.colomboToday} • Reserved In-Flight: {Number(wallet?.reservedCredits || 0).toFixed(2)} cr
        </Text>

        <View style={styles.grid}>
          <View style={[styles.bucket, { borderColor: theme.electricBlue }]}>
            <Text style={{ color: theme.electricBlue, fontWeight: '800', fontSize: 12 }}>Daily Free</Text>
            <Text style={{ color: theme.text, fontWeight: '900', fontSize: 18, marginTop: 4 }}>
              {Number(wallet?.freeCredits || 0).toFixed(2)}
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: 10.5, marginTop: 2 }}>
              Renews daily (Asia/Colombo)
            </Text>
          </View>
          <View style={[styles.bucket, { borderColor: theme.success }]}>
            <Text style={{ color: theme.success, fontWeight: '800', fontSize: 12 }}>Purchased</Text>
            <Text style={{ color: theme.text, fontWeight: '900', fontSize: 18, marginTop: 4 }}>
              {Number(wallet?.purchasedCredits || 0).toFixed(2)}
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: 10.5, marginTop: 2 }}>
              Never expires on daily reset
            </Text>
          </View>
          <View style={[styles.bucket, { borderColor: theme.purple }]}>
            <Text style={{ color: theme.purple, fontWeight: '800', fontSize: 12 }}>Bonus</Text>
            <Text style={{ color: theme.text, fontWeight: '900', fontSize: 18, marginTop: 4 }}>
              {Number(wallet?.bonusCredits || 0).toFixed(2)}
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: 10.5, marginTop: 2 }}>
              Referrals & promo rewards
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <PrimaryButton
            label={wallet?.canClaimDailyToday ? `☀️ Claim +${wallet.dailyAllowance} Daily Credits` : '✓ Daily Free Claimed'}
            variant="blue"
            disabled={!wallet?.canClaimDailyToday}
            loading={loading}
            onPress={claimDaily}
          />
          <PrimaryButton
            label="+ Top Up Credits (LKR / USD)"
            onPress={() => navigate('BUY_CREDITS')}
          />
        </View>
      </GlowCard>

      {/* Promo Code Redemption */}
      <GlowCard>
        <Text style={{ color: theme.text, fontWeight: '800', fontSize: 14, marginBottom: 8 }}>
          🎟️ Redeem Promotional Code
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={promoCode}
            onChangeText={setPromoCode}
            autoCapitalize="characters"
            placeholder="Enter promo code (e.g., NEXORA2026)"
            placeholderTextColor={theme.textMuted}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary },
            ]}
          />
          <PrimaryButton label="Redeem" onPress={redeemPromo} loading={loading} />
        </View>
        {msg && <Text style={{ color: theme.success, fontSize: 12.5, marginTop: 8 }}>{msg}</Text>}
        {error && <Text style={{ color: theme.danger, fontSize: 12.5, marginTop: 8 }}>{error}</Text>}
      </GlowCard>

      {/* Immutable Ledger */}
      <Text style={{ color: theme.text, fontWeight: '800', fontSize: 16 }}>
        Immutable Credit Ledger ({txs.length})
      </Text>
      {txs.map((tx) => {
        const amt = Number(tx.amount);
        return (
          <GlowCard key={tx.id} style={{ paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.text, fontWeight: '700', fontSize: 13 }}>
                {tx.tx_type} ({tx.bucket})
              </Text>
              <Text
                style={{
                  color: amt >= 0 ? theme.success : theme.electricBlue,
                  fontWeight: '900',
                  fontSize: 13.5,
                }}
              >
                {amt >= 0 ? `+${amt.toFixed(3)}` : amt.toFixed(3)} cr
              </Text>
            </View>
            <Text style={{ color: theme.textMuted, fontSize: 11.5, marginTop: 3 }}>
              {tx.description} • Balance After: {Number(tx.balance_after).toFixed(2)} cr
            </Text>
          </GlowCard>
        );
      })}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  bucket: { flex: 1, minWidth: 95, borderWidth: 1, borderRadius: 12, padding: 10 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
});

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const BuyCreditsScreen: React.FC = () => {
  const { theme, navigate } = useNexora();
  const [packages, setPackages] = useState<any[]>([]);
  const [currency, setCurrency] = useState<'LKR' | 'USD'>('LKR');
  const [orderInfo, setOrderInfo] = useState<any | null>(null);
  const [loadingCode, setLoadingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request('/payments/catalog')
      .then((res) => setPackages(res.creditPackages || []))
      .catch(() => undefined);
  }, []);

  const initiateCheckout = async (pkg: any) => {
    setError(null);
    setLoadingCode(pkg.code);
    try {
      const provider = currency === 'LKR' ? 'PAYHERE' : 'STRIPE';
      const res = await apiClient.request('/payments/checkout', {
        method: 'POST',
        body: {
          paymentType: 'CREDIT_PACKAGE',
          packageId: pkg.id,
          provider,
          currency,
        },
      });
      setOrderInfo(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingCode(null);
    }
  };

  return (
    <ScreenShell
      title="Buy Credit Packages"
      subtitle="Sri Lanka LKR (PayHere) & International USD (Stripe)"
      showBackTo="CREDIT_WALLET"
    >
      <View style={styles.currencyToggle}>
        {(['LKR', 'USD'] as const).map((cur) => (
          <TouchableOpacity
            key={cur}
            onPress={() => setCurrency(cur)}
            style={[
              styles.curBtn,
              {
                borderColor: currency === cur ? theme.electricBlue : theme.border,
                backgroundColor: currency === cur ? theme.electricSoft : theme.card,
              },
            ]}
          >
            <Text style={{ color: theme.text, fontWeight: '800', fontSize: 13 }}>
              {cur === 'LKR' ? '🇱🇰 Sri Lanka (LKR • PayHere)' : '🌐 International (USD • Stripe)'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error && (
        <GlowCard>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </GlowCard>
      )}

      {orderInfo && (
        <GlowCard accent="blue">
          <Text style={{ color: theme.electricBlue, fontWeight: '900', fontSize: 15 }}>
            ✓ Secure Payment Order Created: {orderInfo.orderNumber}
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: 12.5, marginTop: 6 }}>
            Amount: {orderInfo.currency} {Number(orderInfo.amount).toLocaleString()} • Gateway:{' '}
            {orderInfo.provider}
          </Text>
          <Text style={{ color: theme.warning, fontSize: 12, marginTop: 6 }}>
            🔒 {orderInfo.securityNote}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            {orderInfo.checkoutUrl && (
              <PrimaryButton
                label={`Proceed to ${orderInfo.provider} Checkout`}
                variant="blue"
                onPress={() => Linking.openURL(orderInfo.checkoutUrl)}
              />
            )}
            <PrimaryButton
              label="View Payment History"
              variant="outline"
              onPress={() => navigate('PAYMENT_HISTORY')}
            />
          </View>
        </GlowCard>
      )}

      {packages.map((p) => {
        const total = Number(p.credits) + Number(p.bonus_credits);
        const price =
          currency === 'LKR'
            ? `LKR ${Number(p.price_lkr).toLocaleString()}`
            : `$${Number(p.price_usd).toFixed(2)} USD`;

        return (
          <GlowCard key={p.id} accent={p.is_featured ? 'purple' : 'none'}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: '900' }}>
                  {p.name} {p.is_featured ? '🔥 MOST POPULAR' : ''}
                </Text>
                <Text style={{ color: theme.electricBlue, fontSize: 14, fontWeight: '800', marginTop: 3 }}>
                  💎 {total.toLocaleString()} Total Credits ({p.credits} + {p.bonus_credits} Bonus)
                </Text>
              </View>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '900' }}>{price}</Text>
            </View>
            <Text style={{ color: theme.textMuted, fontSize: 12.5, marginTop: 6 }}>
              {p.description} • Non-expiring purchased balance
            </Text>
            <PrimaryButton
              label={`Buy ${p.name} (${price})`}
              variant={p.is_featured ? 'purple' : 'outline'}
              loading={loadingCode === p.code}
              onPress={() => initiateCheckout(p)}
              style={{ marginTop: 12 }}
            />
          </GlowCard>
        );
      })}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  currencyToggle: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  curBtn: { flex: 1, minWidth: 160, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
});

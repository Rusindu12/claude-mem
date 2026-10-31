import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, ScreenShell } from '../components/NexoraUI';

export const PaymentHistoryScreen: React.FC = () => {
  const { theme } = useNexora();
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    apiClient
      .request('/payments/history')
      .then((rows) => setOrders(rows || []))
      .catch(() => undefined);
  }, []);

  const invoices = orders.filter((o) => o.invoice_number);

  return (
    <ScreenShell
      title="Payments & Tax Invoices"
      subtitle="Verified Orders, Receipts & Refund Records"
      showBackTo="CREDIT_WALLET"
    >
      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>
        Issued Tax Invoices ({invoices.length})
      </Text>
      {invoices.length === 0 ? (
        <GlowCard>
          <Text style={{ color: theme.textMuted, fontSize: 13 }}>No paid invoices yet.</Text>
        </GlowCard>
      ) : (
        invoices.map((inv) => (
          <GlowCard key={`inv-${inv.id}`} accent="blue">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.electricBlue, fontWeight: '900' }}>
                🧾 {inv.invoice_number}
              </Text>
              <Text style={{ color: theme.success, fontWeight: '900' }}>
                {inv.currency} {Number(inv.amount).toLocaleString()}
              </Text>
            </View>
            <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 4 }}>
              Order: {inv.order_number} • Gateway: {inv.provider} • Verified:{' '}
              {inv.verified_at ? new Date(inv.verified_at).toLocaleString() : 'Yes'}
            </Text>
          </GlowCard>
        ))
      )}

      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800', marginTop: 8 }}>
        Payment Orders ({orders.length})
      </Text>
      {orders.length === 0 ? (
        <GlowCard>
          <Text style={{ color: theme.textMuted, fontSize: 13 }}>No payment orders created yet.</Text>
        </GlowCard>
      ) : (
        orders.map((o) => (
          <GlowCard key={o.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.text, fontWeight: '800' }}>
                {o.order_number} ({o.payment_type})
              </Text>
              <Text
                style={{
                  color:
                    o.status === 'SUCCEEDED'
                      ? theme.success
                      : o.status === 'REFUNDED'
                        ? theme.danger
                        : theme.warning,
                  fontWeight: '800',
                }}
              >
                {o.status}
              </Text>
            </View>
            <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>
              {o.provider} • {o.currency} {Number(o.amount).toLocaleString()} • Credits:{' '}
              {Number(o.credits_to_grant + o.bonus_credits_to_grant).toFixed(0)}
            </Text>
          </GlowCard>
        ))
      )}
    </ScreenShell>
  );
};

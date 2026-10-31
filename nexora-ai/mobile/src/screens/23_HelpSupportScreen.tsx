import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, ScreenShell } from '../components/NexoraUI';

const FAQS = [
  {
    q: 'How do Colombo Daily Free Credits work?',
    a: 'Every user can claim their daily free credit allowance once per calendar day in the Asia/Colombo timezone (+05:30). Unused daily free credits reset on the next daily claim, while Purchased Credits and Bonus Credits NEVER expire on daily renewal.',
  },
  {
    q: 'What happens if an AI request fails or times out?',
    a: 'NEXORA AI reserves credits atomically before calling the AI provider. If all providers fail or time out, 100% of reserved credits are automatically released back to your exact original wallet buckets.',
  },
  {
    q: 'Does NEXORA AI ever silently swap my chosen AI model?',
    a: 'Never. If your chosen model is unavailable and Auto-Failover is enabled, NEXORA AI displays an explicit yellow Fallback Alert banner naming both your requested model and the executed fallback model.',
  },
  {
    q: 'How are Sri Lankan LKR and International USD payments secured?',
    a: 'LKR payments use PayHere and international payments use Stripe. Credits are issued strictly on the backend after cryptographic webhook signature verification (MD5 / HMAC-SHA256) and idempotency checks.',
  },
];

export const HelpSupportScreen: React.FC = () => {
  const { theme } = useNexora();
  const [health, setHealth] = useState<any | null>(null);

  useEffect(() => {
    apiClient
      .request('/health')
      .then(setHealth)
      .catch(() => undefined);
  }, []);

  return (
    <ScreenShell
      title="Help, Support & Status"
      subtitle="Transparent Billing, Credit Safety & Live Diagnostics"
      showBackTo="SETTINGS"
    >
      <GlowCard accent="blue">
        <Text style={{ color: theme.electricBlue, fontWeight: '900', fontSize: 15 }}>
          🟢 Live Platform Diagnostics
        </Text>
        <Text style={{ color: theme.textSecondary, fontSize: 12.5, marginTop: 6 }}>
          Status: {health?.status?.toUpperCase() || 'CHECKING...'} • DB Driver:{' '}
          {health?.database?.driver || 'PostgreSQL'} • Cache:{' '}
          {health?.cache?.mode || 'Active'} • Uptime:{' '}
          {health?.uptimeSeconds ?? 0}s
        </Text>
        <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 6 }}>
          Support Desk: support@nexora.ai • Colombo & Global Enterprise Desk
        </Text>
      </GlowCard>

      {FAQS.map((f, idx) => (
        <GlowCard key={idx}>
          <Text style={{ color: theme.text, fontWeight: '800', fontSize: 14.5 }}>{f.q}</Text>
          <Text style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 6 }}>
            {f.a}
          </Text>
        </GlowCard>
      ))}
    </ScreenShell>
  );
};

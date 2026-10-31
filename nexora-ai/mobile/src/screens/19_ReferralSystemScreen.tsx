import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const ReferralSystemScreen: React.FC = () => {
  const { theme } = useNexora();
  const [data, setData] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiClient
      .request('/platform/referrals')
      .then(setData)
      .catch(() => undefined);
  }, []);

  const copyCode = async () => {
    if (!data?.referralCode) return;
    await Clipboard.setStringAsync(data.referralCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <ScreenShell
      title="Refer Friends & Earn Credits"
      subtitle="Invite friends to NEXORA AI & both earn instant bonus credits"
      showBackTo="HOME"
    >
      <GlowCard accent="purple" style={{ alignItems: 'center', paddingVertical: 24 }}>
        <Text style={{ fontSize: 38 }}>🎁</Text>
        <Text style={{ color: theme.text, fontSize: 19, fontWeight: '900', marginTop: 8 }}>
          Your Personal Referral Code
        </Text>
        <Text
          style={{
            color: theme.electricBlue,
            fontSize: 28,
            fontWeight: '900',
            letterSpacing: 3,
            marginVertical: 12,
          }}
        >
          {data?.referralCode || 'LOADING...'}
        </Text>
        <PrimaryButton
          label={copied ? '✓ Copied to Clipboard!' : '📋 Copy Referral Code'}
          variant="blue"
          onPress={copyCode}
        />
      </GlowCard>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <GlowCard style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>Total Invited</Text>
          <Text style={{ color: theme.text, fontSize: 24, fontWeight: '900', marginTop: 4 }}>
            {data?.totalReferredUsers || 0}
          </Text>
        </GlowCard>
        <GlowCard style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>Bonus Credits Earned</Text>
          <Text style={{ color: theme.success, fontSize: 24, fontWeight: '900', marginTop: 4 }}>
            +{Number(data?.totalBonusCreditsEarned || 0).toFixed(0)}
          </Text>
        </GlowCard>
      </View>

      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>Referred Friends</Text>
      {(data?.referrals || []).length === 0 ? (
        <GlowCard>
          <Text style={{ color: theme.textMuted, fontSize: 13 }}>
            Share your code above — every friend who joins awards you +75 Bonus Credits and gives them +50 Bonus Credits!
          </Text>
        </GlowCard>
      ) : (
        data.referrals.map((r: any, idx: number) => (
          <GlowCard key={idx}>
            <Text style={{ color: theme.text, fontWeight: '700' }}>{r.full_name}</Text>
            <Text style={{ color: theme.success, fontSize: 12, marginTop: 2 }}>
              +{r.referrer_bonus_credits} Credits Awarded • {r.status}
            </Text>
          </GlowCard>
        ))
      )}
    </ScreenShell>
  );
};

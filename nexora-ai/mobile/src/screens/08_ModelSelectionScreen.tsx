import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const ModelSelectionScreen: React.FC = () => {
  const { theme, models, selectedModel, setSelectedModel, navigate, refreshSessionData } = useNexora();
  const [filter, setFilter] = useState<string>('ALL');

  useEffect(() => {
    refreshSessionData();
  }, [refreshSessionData]);

  const categories = ['ALL', 'FREE_ONLY', 'CHAT', 'REASONING', 'CODING', 'IMAGE', 'VIDEO'];
  const filtered =
    filter === 'ALL'
      ? models
      : filter === 'FREE_ONLY'
        ? models.filter((m) => m.isFreeModel)
        : models.filter((m) => m.category === filter);

  return (
    <ScreenShell
      title="AI Model Router"
      subtitle="Dynamic Multi-Provider Selection & Transparent Credit Pricing"
      showBackTo="HOME"
    >
      <View style={styles.filterRow}>
        {categories.map((cat) => (
          <TouchableOpacity
            key={cat}
            onPress={() => setFilter(cat)}
            style={[
              styles.chip,
              {
                borderColor: filter === cat ? theme.electricBlue : theme.border,
                backgroundColor: filter === cat ? theme.electricSoft : theme.card,
              },
            ]}
          >
            <Text
              style={{
                color: filter === cat ? theme.electricBlue : theme.textSecondary,
                fontSize: 12,
                fontWeight: '800',
              }}
            >
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {filtered.map((m) => {
        const isSelected = selectedModel?.id === m.id;
        return (
          <GlowCard key={m.id} accent={isSelected ? 'blue' : 'none'}>
            <View style={styles.topRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>
                  {m.displayName}
                </Text>
                <Text style={{ color: theme.purple, fontSize: 12, fontWeight: '700', marginTop: 2 }}>
                  {m.providerName} • {m.modelKey} • {m.tier} TIER
                </Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor: m.isAvailableNow
                      ? 'rgba(16,185,129,0.15)'
                      : 'rgba(245,158,11,0.15)',
                  },
                ]}
              >
                <Text
                  style={{
                    color: m.isAvailableNow ? theme.success : theme.warning,
                    fontSize: 11,
                    fontWeight: '800',
                  }}
                >
                  {m.isAvailableNow ? '● LIVE' : '○ KEY NEEDED'}
                </Text>
              </View>
            </View>

            <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 8 }}>
              {m.description}
            </Text>

            <View style={styles.tagsRow}>
              {m.isFreeModel && (
                <Text style={[styles.tag, { color: theme.success, borderColor: theme.success }]}>
                  🆓 {m.requiresApiKey === false ? 'FREE AI (Zero-Key)' : 'FREE AI Tier'}
                </Text>
              )}
              <Text style={[styles.tag, { color: theme.textMuted, borderColor: theme.border }]}>
                Context: {(m.contextWindow / 1000).toFixed(0)}k
              </Text>
              {m.supportsSinhala && (
                <Text style={[styles.tag, { color: theme.electricBlue, borderColor: theme.electricBlue }]}>
                  🇱🇰 Sinhala Ready
                </Text>
              )}
              {m.supportsVision && (
                <Text style={[styles.tag, { color: theme.purple, borderColor: theme.purple }]}>
                  👁 Vision
                </Text>
              )}
              <Text style={[styles.tag, { color: theme.success, borderColor: theme.border }]}>
                {m.category === 'IMAGE'
                  ? `${m.pricing.creditCostPerImage} cr / image`
                  : m.category === 'VIDEO'
                    ? `${m.pricing.creditCostPerVideoSec} cr / sec`
                    : `${m.pricing.creditCostPer1kInput} in / ${m.pricing.creditCostPer1kOutput} out cr/1k`}
              </Text>
            </View>

            {!m.isAvailableNow && m.unavailableReason && (
              <Text style={{ color: theme.warning, fontSize: 11.5, marginTop: 8 }}>
                Note: {m.unavailableReason}
              </Text>
            )}

            {m.category !== 'IMAGE' && m.category !== 'VIDEO' && (
              <PrimaryButton
                label={isSelected ? '✓ Active Chat Model' : 'Select for AI Chat'}
                variant={isSelected ? 'blue' : 'purple'}
                onPress={() => {
                  setSelectedModel(m);
                  navigate('AI_CHAT');
                }}
                style={{ marginTop: 12 }}
              />
            )}
          </GlowCard>
        );
      })}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
});

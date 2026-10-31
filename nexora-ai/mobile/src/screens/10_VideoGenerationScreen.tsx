import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const VideoGenerationScreen: React.FC = () => {
  const { theme, refreshSessionData } = useNexora();
  const [caps, setCaps] = useState<any | null>(null);
  const [operation, setOperation] = useState<'TEXT_TO_VIDEO' | 'IMAGE_TO_VIDEO'>('TEXT_TO_VIDEO');
  const [prompt, setPrompt] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(5);
  const [jobs, setJobs] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    const [c, j] = await Promise.all([
      apiClient.request('/media/capabilities'),
      apiClient.request('/media/jobs?mediaType=VIDEO'),
    ]);
    setCaps(c);
    setJobs(j || []);
  };

  useEffect(() => {
    loadData().catch(() => undefined);
  }, []);

  const activeModel = caps?.connectedVideoModels?.[0];
  const estimatedCredits = (activeModel?.creditsPerSecond || 35) * durationSeconds;

  const submitVideo = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiClient.request('/media/videos', {
        method: 'POST',
        body: {
          operation,
          prompt,
          durationSeconds,
          modelId: activeModel?.id,
        },
      });
      setPrompt('');
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 800));
        const st = await apiClient.request(`/media/jobs/${created.jobId}`);
        await loadData();
        if (st.status === 'SUCCEEDED' || st.status === 'FAILED') break;
      }
      await refreshSessionData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenShell
      title="AI Video Studio"
      subtitle="Text-to-Video & Image-to-Video Background Queue"
      showBackTo="HOME"
    >
      {caps && !caps.videoGenerationAvailable ? (
        <GlowCard accent="blue">
          <Text style={{ color: theme.warning, fontWeight: '800', fontSize: 14 }}>
            🎬 Connected Video Provider Required
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 6 }}>
            Video generation is dynamically displayed only when a video-capable provider (e.g., Google Gemini Veo or OpenAI Video API) has active credentials in the Owner Dashboard.
          </Text>
        </GlowCard>
      ) : (
        <GlowCard accent="blue">
          <Text style={{ color: theme.electricBlue, fontWeight: '800', fontSize: 13 }}>
            🎬 Active Video Model: {activeModel?.displayName || 'Loading...'}
          </Text>

          <View style={styles.row}>
            {(['TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO'] as const).map((op) => (
              <TouchableOpacity
                key={op}
                onPress={() => setOperation(op)}
                style={[
                  styles.chip,
                  {
                    borderColor: operation === op ? theme.electricBlue : theme.border,
                    backgroundColor: operation === op ? theme.electricSoft : theme.bgSecondary,
                  },
                ]}
              >
                <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700' }}>
                  {op.replace(/_/g, ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            multiline
            placeholder="Describe camera motion, scene lighting, subject action..."
            placeholderTextColor={theme.textMuted}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary },
            ]}
          />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[4, 5, 8].map((sec) => (
                <TouchableOpacity
                  key={sec}
                  onPress={() => setDurationSeconds(sec)}
                  style={[styles.chip, { borderColor: durationSeconds === sec ? theme.purple : theme.border }]}
                >
                  <Text style={{ color: theme.text, fontSize: 12 }}>{sec}s</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: theme.electricBlue, fontWeight: '800', fontSize: 13 }}>
              Est. Cost: {estimatedCredits} Credits
            </Text>
          </View>

          {error && <Text style={{ color: theme.danger, fontSize: 12.5, marginTop: 8 }}>{error}</Text>}

          <PrimaryButton
            label={`Queue Video Job (${estimatedCredits} Credits)`}
            variant="blue"
            onPress={submitVideo}
            loading={submitting}
            disabled={!prompt.trim()}
            style={{ marginTop: 14 }}
          />
        </GlowCard>
      )}

      <Text style={{ color: theme.text, fontWeight: '800', fontSize: 16 }}>Video Job Queue & History</Text>
      {jobs.length === 0 ? (
        <GlowCard>
          <Text style={{ color: theme.textMuted, fontSize: 13 }}>No video generation jobs yet.</Text>
        </GlowCard>
      ) : (
        jobs.map((j) => (
          <GlowCard key={j.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.text, fontWeight: '700', flex: 1 }}>{j.prompt}</Text>
              <Text style={{ color: theme.electricBlue, fontWeight: '800', fontSize: 12 }}>
                {j.status} ({j.progress_percent}%)
              </Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: theme.bgSecondary }]}>
              <View
                style={{
                  width: `${j.progress_percent}%`,
                  height: 6,
                  borderRadius: 4,
                  backgroundColor: theme.electricBlue,
                }}
              />
            </View>
            {j.error_message && (
              <Text style={{ color: theme.danger, fontSize: 12, marginTop: 4 }}>{j.error_message}</Text>
            )}
            {Array.isArray(j.output_urls) &&
              j.output_urls.map((u: string, idx: number) => (
                <PrimaryButton
                  key={idx}
                  label="▶ Open / Download Generated Video"
                  variant="outline"
                  onPress={() => Linking.openURL(u)}
                  style={{ marginTop: 8 }}
                />
              ))}
          </GlowCard>
        ))
      )}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginVertical: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 84, fontSize: 14 },
  progressTrack: { height: 6, borderRadius: 4, overflow: 'hidden', marginTop: 8 },
});

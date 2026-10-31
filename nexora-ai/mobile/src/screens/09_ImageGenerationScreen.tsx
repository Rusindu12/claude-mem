import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, Linking, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const ImageGenerationScreen: React.FC = () => {
  const { theme, refreshSessionData } = useNexora();
  const [caps, setCaps] = useState<any | null>(null);
  const [prompt, setPrompt] = useState('');
  const [operation, setOperation] = useState<'TEXT_TO_IMAGE' | 'IMAGE_VARIATION' | 'IMAGE_EDIT'>('TEXT_TO_IMAGE');
  const [size, setSize] = useState('1024x1024');
  const [count, setCount] = useState(1);
  const [jobs, setJobs] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    const [c, j] = await Promise.all([
      apiClient.request('/media/capabilities'),
      apiClient.request('/media/jobs?mediaType=IMAGE'),
    ]);
    setCaps(c);
    setJobs(j || []);
  };

  useEffect(() => {
    loadData().catch(() => undefined);
  }, []);

  const activeModel = caps?.connectedImageModels?.[0];
  const estimatedCredits = (activeModel?.creditsPerImage || 12) * count;

  const submitJob = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiClient.request('/media/images', {
        method: 'POST',
        body: {
          operation,
          prompt,
          size,
          count,
          modelId: activeModel?.id,
        },
      });
      setPrompt('');
      // Poll job progress
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 700));
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
      title="AI Image Studio"
      subtitle="Text-to-Image, Variations & Edits via Background Worker"
      showBackTo="HOME"
    >
      {caps && !caps.imageGenerationAvailable ? (
        <GlowCard accent="purple">
          <Text style={{ color: theme.warning, fontWeight: '800', fontSize: 14 }}>
            🔌 Connected Image Provider Required
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 6 }}>
            {caps.notice ||
              'Image generation is dynamically enabled as soon as an OpenAI or Google Gemini Imagen API key is configured in the Owner Dashboard.'}
          </Text>
        </GlowCard>
      ) : (
        <GlowCard accent="purple">
          <Text style={{ color: theme.electricBlue, fontWeight: '800', fontSize: 13 }}>
            🎨 Connected Model: {activeModel?.displayName || 'Loading...'}
          </Text>

          <View style={styles.opRow}>
            {(['TEXT_TO_IMAGE', 'IMAGE_VARIATION', 'IMAGE_EDIT'] as const).map((op) => (
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
                <Text style={{ color: theme.text, fontSize: 11.5, fontWeight: '700' }}>
                  {op.replace(/_/g, ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            multiline
            placeholder="Describe the artwork, lighting, style, and composition..."
            placeholderTextColor={theme.textMuted}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary },
            ]}
          />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {[1, 2].map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setCount(n)}
                  style={[styles.chip, { borderColor: count === n ? theme.purple : theme.border }]}
                >
                  <Text style={{ color: theme.text, fontSize: 12 }}>{n} Image{n > 1 ? 's' : ''}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: theme.electricBlue, fontWeight: '800', fontSize: 13 }}>
              Est. Cost: {estimatedCredits} Credits
            </Text>
          </View>

          {error && <Text style={{ color: theme.danger, fontSize: 12.5, marginTop: 8 }}>{error}</Text>}

          <PrimaryButton
            label={`Generate (${estimatedCredits} Credits)`}
            onPress={submitJob}
            loading={submitting}
            disabled={!prompt.trim()}
            style={{ marginTop: 14 }}
          />
        </GlowCard>
      )}

      <Text style={{ color: theme.text, fontWeight: '800', fontSize: 16 }}>Image History</Text>
      {jobs.length === 0 ? (
        <GlowCard>
          <Text style={{ color: theme.textMuted, fontSize: 13 }}>No image generation jobs yet.</Text>
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
            <Text style={{ color: theme.textMuted, fontSize: 11.5, marginTop: 4 }}>
              {j.operation} • Charged: {j.actual_credits || j.estimated_credits} cr
            </Text>
            {Array.isArray(j.output_urls) &&
              j.output_urls.map((u: string, i: number) => (
                <View key={i} style={{ marginTop: 10 }}>
                  <Image
                    source={{ uri: u }}
                    style={{ width: '100%', height: 220, borderRadius: 12, backgroundColor: '#090B14' }}
                    resizeMode="cover"
                  />
                  <PrimaryButton
                    label="⬇ Download / Export Image"
                    variant="outline"
                    onPress={() => Linking.openURL(u)}
                    style={{ marginTop: 8 }}
                  />
                </View>
              ))}
          </GlowCard>
        ))
      )}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  opRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 84, fontSize: 14 },
});

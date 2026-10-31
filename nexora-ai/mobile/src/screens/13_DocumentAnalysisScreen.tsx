import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import {
  GlowCard,
  MarkdownMessageView,
  PrimaryButton,
  ScreenShell,
} from '../components/NexoraUI';

export const DocumentAnalysisScreen: React.FC = () => {
  const { theme, selectedModel, refreshSessionData } = useNexora();
  const [tab, setTab] = useState<'DOCUMENT' | 'TRANSLATION' | 'STUDY' | 'PRODUCTIVITY'>('DOCUMENT');
  const [targetLang, setTargetLang] = useState<'Sinhala (සිංහල)' | 'English' | 'Tamil'>('Sinhala (සිංහල)');
  const [uploadedFile, setUploadedFile] = useState<any | null>(null);
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUploadDoc = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/*', 'application/pdf', 'application/json'],
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      let base64 = '';
      if (Platform.OS === 'web' && (asset as any).file) {
        const buf = await (asset as any).file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
        base64 = btoa(bin);
      } else if (asset.uri.startsWith('data:')) {
        base64 = asset.uri.split(',')[1] || '';
      }
      const res = await apiClient.request('/files/upload', {
        method: 'POST',
        body: {
          filename: asset.name,
          mimeType: asset.mimeType || 'text/plain',
          contentBase64: base64,
          purpose: 'DOCUMENT_ANALYSIS',
        },
      });
      setUploadedFile(res);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const execute = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiClient.request('/chat/tools/execute', {
        method: 'POST',
        body: {
          mode: tab,
          targetLanguage: tab === 'TRANSLATION' ? targetLang : undefined,
          fileId: uploadedFile?.id,
          prompt: prompt.trim(),
          modelId: selectedModel?.id,
        },
      });
      setResult(res.assistantMessage);
      await refreshSessionData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenShell
      title="Documents, Translation & Study"
      subtitle="Document Intelligence, Sinhala Translation, Study Tutor & Productivity"
      showBackTo="HOME"
    >
      <View style={styles.tabs}>
        {(['DOCUMENT', 'TRANSLATION', 'STUDY', 'PRODUCTIVITY'] as const).map((m) => (
          <TouchableOpacity
            key={m}
            onPress={() => setTab(m)}
            style={[
              styles.chip,
              {
                borderColor: tab === m ? theme.electricBlue : theme.border,
                backgroundColor: tab === m ? theme.electricSoft : theme.card,
              },
            ]}
          >
            <Text style={{ color: theme.text, fontSize: 12, fontWeight: '800' }}>{m}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <GlowCard accent="purple">
        {tab === 'DOCUMENT' && (
          <View style={{ marginBottom: 12 }}>
            <PrimaryButton
              label={uploadedFile ? `📄 Attached: ${uploadedFile.filename}` : '📤 Upload Document (TXT / MD / CSV / JSON / PDF)'}
              variant="outline"
              onPress={handleUploadDoc}
            />
          </View>
        )}

        {tab === 'TRANSLATION' && (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {(['Sinhala (සිංහල)', 'English', 'Tamil'] as const).map((l) => (
              <TouchableOpacity
                key={l}
                onPress={() => setTargetLang(l)}
                style={[styles.chip, { borderColor: targetLang === l ? theme.purple : theme.border }]}
              >
                <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700' }}>→ {l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          multiline
          placeholder={
            tab === 'DOCUMENT'
              ? 'Ask questions or request an executive summary of your document...'
              : tab === 'TRANSLATION'
                ? 'Paste text to translate accurately...'
                : tab === 'STUDY'
                  ? 'Enter an exam topic (A/L, University, IT, Science) for step-by-step tutoring & quiz...'
                  : 'Describe the email, business plan, or meeting notes you need...'
          }
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary },
          ]}
        />

        {error && <Text style={{ color: theme.danger, fontSize: 12.5, marginTop: 8 }}>{error}</Text>}

        <PrimaryButton
          label={`Run ${tab} AI`}
          onPress={execute}
          loading={loading}
          disabled={!prompt.trim()}
          style={{ marginTop: 12 }}
        />
      </GlowCard>

      {result && (
        <GlowCard accent="blue">
          <Text style={{ color: theme.electricBlue, fontSize: 12, fontWeight: '800', marginBottom: 8 }}>
            ✓ {result.executedModel?.displayName} • {Number(result.usage?.creditsCharged || 0).toFixed(3)} cr
          </Text>
          <MarkdownMessageView content={result.content} />
        </GlowCard>
      )}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 110, fontSize: 14 },
});

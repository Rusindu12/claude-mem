import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import {
  GlowCard,
  MarkdownMessageView,
  PrimaryButton,
  ScreenShell,
} from '../components/NexoraUI';

const TASKS = ['Generate Code', 'Debug & Fix', 'Security Audit', 'Write Unit Tests'];
const LANGS = ['TypeScript', 'Python', 'Kotlin (Android)', 'PostgreSQL', 'Rust', 'Go'];

export const AICodingScreen: React.FC = () => {
  const { theme, selectedModel, refreshSessionData } = useNexora();
  const [task, setTask] = useState(TASKS[0]);
  const [codeLang, setCodeLang] = useState(LANGS[0]);
  const [spec, setSpec] = useState('');
  const [output, setOutput] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCodingTask = async () => {
    setError(null);
    setLoading(true);
    try {
      const prompt = `[Task: ${task}] [Language/Stack: ${codeLang}]\n\n${spec.trim()}`;
      const res = await apiClient.request('/chat/tools/execute', {
        method: 'POST',
        body: {
          mode: 'CODING',
          prompt,
          modelId: selectedModel?.id,
        },
      });
      setOutput(res.assistantMessage);
      await refreshSessionData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenShell
      title="AI Coding Architect"
      subtitle="Production Code Generation, Debugging, Security Review & Tests"
      showBackTo="HOME"
    >
      <GlowCard accent="purple">
        <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: '700' }}>
          ENGINEERING TASK
        </Text>
        <View style={styles.chipRow}>
          {TASKS.map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTask(t)}
              style={[
                styles.chip,
                {
                  borderColor: task === t ? theme.electricBlue : theme.border,
                  backgroundColor: task === t ? theme.electricSoft : theme.bgSecondary,
                },
              ]}
            >
              <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700' }}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 8 }}>
          TARGET STACK
        </Text>
        <View style={styles.chipRow}>
          {LANGS.map((l) => (
            <TouchableOpacity
              key={l}
              onPress={() => setCodeLang(l)}
              style={[
                styles.chip,
                {
                  borderColor: codeLang === l ? theme.purple : theme.border,
                  backgroundColor: codeLang === l ? theme.purpleSoft : theme.bgSecondary,
                },
              ]}
            >
              <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700' }}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          value={spec}
          onChangeText={setSpec}
          multiline
          placeholder="Paste code to debug/audit or describe the architecture/algorithm you want built..."
          placeholderTextColor={theme.textMuted}
          style={[
            styles.editor,
            { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary },
          ]}
        />

        {error && <Text style={{ color: theme.danger, fontSize: 12.5, marginTop: 8 }}>{error}</Text>}

        <PrimaryButton
          label={`Run ${task}`}
          onPress={runCodingTask}
          loading={loading}
          disabled={!spec.trim()}
          style={{ marginTop: 12 }}
        />
      </GlowCard>

      {output && (
        <GlowCard accent="blue">
          <Text style={{ color: theme.electricBlue, fontSize: 12, fontWeight: '800', marginBottom: 8 }}>
            ✓ {output.executedModel?.displayName} • {Number(output.usage?.creditsCharged || 0).toFixed(3)} credits
          </Text>
          <MarkdownMessageView content={output.content} />
        </GlowCard>
      )}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  editor: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 130, fontSize: 13.5, marginTop: 6 },
});

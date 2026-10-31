import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import * as Speech from 'expo-speech';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const VoiceAssistantScreen: React.FC = () => {
  const { theme, selectedModel, refreshSessionData } = useNexora();
  const [voiceLang, setVoiceLang] = useState<'en' | 'si'>('en');
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startBrowserSpeechRecognition = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SR) {
        const rec = new SR();
        rec.lang = voiceLang === 'si' ? 'si-LK' : 'en-US';
        rec.interimResults = false;
        setListening(true);
        rec.onresult = (ev: any) => {
          const spoken = ev.results?.[0]?.[0]?.transcript || '';
          setTranscript(spoken);
          setListening(false);
        };
        rec.onerror = () => setListening(false);
        rec.onend = () => setListening(false);
        rec.start();
        return;
      }
    }
    setError('Microphone speech-to-text requires browser SpeechRecognition or Android audio input; type below or tap Speak Reply.');
  };

  const askVoiceAssistant = async () => {
    if (!transcript.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const res = await apiClient.request('/chat/tools/execute', {
        method: 'POST',
        body: {
          mode: 'VOICE',
          targetLanguage: voiceLang,
          prompt: transcript.trim(),
          modelId: selectedModel?.id,
        },
      });
      const text = res.assistantMessage?.content || '';
      setReply(text);
      Speech.stop();
      Speech.speak(text.slice(0, 1000), {
        language: voiceLang === 'si' ? 'si-LK' : 'en-US',
      });
      await refreshSessionData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenShell
      title="NEXORA Voice Assistant"
      subtitle="Conversational Speech Input & Text-to-Speech (English & සිංහල)"
      showBackTo="HOME"
    >
      <GlowCard accent="purple" style={{ alignItems: 'center', paddingVertical: 28 }}>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 18 }}>
          {(['en', 'si'] as const).map((l) => (
            <TouchableOpacity
              key={l}
              onPress={() => setVoiceLang(l)}
              style={[
                styles.langChip,
                {
                  borderColor: voiceLang === l ? theme.electricBlue : theme.border,
                  backgroundColor: voiceLang === l ? theme.electricSoft : theme.bgSecondary,
                },
              ]}
            >
              <Text style={{ color: theme.text, fontWeight: '800', fontSize: 12 }}>
                {l === 'en' ? '🌐 English Voice' : '🇱🇰 සිංහල හඬ'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={startBrowserSpeechRecognition}
          style={[
            styles.orb,
            {
              borderColor: listening ? theme.electricBlue : theme.purple,
              backgroundColor: listening ? theme.electricSoft : theme.purpleSoft,
            },
          ]}
        >
          <Text style={{ fontSize: 38 }}>{listening ? '🔴' : '🎙️'}</Text>
        </TouchableOpacity>
        <Text style={{ color: theme.textSecondary, fontSize: 12.5, marginTop: 10 }}>
          {listening ? 'Listening now...' : 'Tap Neural Orb to Speak or Enter Voice Prompt Below'}
        </Text>

        <TextInput
          value={transcript}
          onChangeText={setTranscript}
          placeholder={
            voiceLang === 'si'
              ? 'ඔබේ හඬ පණිවිඩය මෙහි ලියන්න හෝ කතා කරන්න...'
              : 'Speak or type your voice query...'
          }
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSecondary },
          ]}
        />

        {error && <Text style={{ color: theme.danger, fontSize: 12, marginTop: 8 }}>{error}</Text>}

        <PrimaryButton
          label="Ask Voice AI & Play Audio Reply"
          variant="blue"
          onPress={askVoiceAssistant}
          loading={loading}
          disabled={!transcript.trim()}
          style={{ marginTop: 12, alignSelf: 'stretch' }}
        />
      </GlowCard>

      {reply ? (
        <GlowCard accent="blue">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ color: theme.electricBlue, fontWeight: '800' }}>🔊 Spoken AI Response</Text>
            <TouchableOpacity onPress={() => Speech.stop()}>
              <Text style={{ color: theme.danger, fontWeight: '700', fontSize: 12 }}>⏹ Stop Audio</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ color: theme.text, fontSize: 14, lineHeight: 22 }}>{reply}</Text>
        </GlowCard>
      ) : null}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  langChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  orb: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
    fontSize: 14,
  },
});

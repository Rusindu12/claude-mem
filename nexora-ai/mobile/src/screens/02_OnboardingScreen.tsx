import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { downloadReleaseArtifact, isEmbeddedAndroidApk } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton } from '../components/NexoraUI';

const SLIDES = [
  {
    icon: '🧠',
    titleEn: 'Multi-Model AI Engine',
    titleSi: 'බහු-මාදිලි AI පද්ධතිය',
    descEn:
      'Switch seamlessly between OpenAI, Google Gemini, Anthropic Claude & Open-Source models with transparent failover protection.',
    descSi:
      'OpenAI, Google Gemini, Anthropic Claude සහ Open-Source AI මාදිලි අතර පහසුවෙන් මාරු වන්න.',
  },
  {
    icon: '🇱🇰',
    titleEn: 'Fluent Sinhala & Global Intelligence',
    titleSi: 'සිංහල සහ බහු-භාෂා විශිෂ්ටත්වය',
    descEn:
      'Chat, translate, analyze documents, write production code, and study in Sinhala, English, and 50+ languages.',
    descSi:
      'සිංහල සහ ඉංග්‍රීසි බසින් සංවාද, පරිවර්තන, කේතනය සහ ලේඛන විශ්ලේෂණය සිදු කරන්න.',
  },
  {
    icon: '💎',
    titleEn: 'Daily Colombo Free Credits & Fair Wallet',
    titleSi: 'දෛනික නොමිලේ ක්‍රෙඩිට් සහ ආරක්ෂිත පසුම්බිය',
    descEn:
      'Claim daily free credits every Colombo day, top up in LKR or USD, and pay only for actual tokens used.',
    descSi:
      'සෑම දිනකම නොමිලේ ක්‍රෙඩිට් ලබාගන්න. රුපියල් (LKR) හෝ USD මගින් ආරක්ෂිතව ගෙවීම් කරන්න.',
  },
];

export const OnboardingScreen: React.FC = () => {
  const { theme, navigate, language, setLanguage } = useNexora();
  const [step, setStep] = useState(0);
  const s = SLIDES[step];

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={styles.topRow}>
        <Text style={{ color: theme.electricBlue, fontWeight: '900', letterSpacing: 1.5 }}>
          NEXORA AI
        </Text>
        <TouchableOpacity
          onPress={() => setLanguage(language === 'en' ? 'si' : 'en')}
          style={[styles.langBtn, { borderColor: theme.purple }]}
        >
          <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700' }}>
            {language === 'en' ? '🇱🇰 සිංහල' : '🌐 English'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.centerWrap}>
        <GlowCard accent="purple" style={{ alignItems: 'center', paddingVertical: 36 }}>
          <Text style={{ fontSize: 56, marginBottom: 18 }}>{s.icon}</Text>
          <Text style={[styles.title, { color: theme.text }]}>
            {language === 'si' ? s.titleSi : s.titleEn}
          </Text>
          <Text style={[styles.desc, { color: theme.textSecondary }]}>
            {language === 'si' ? s.descSi : s.descEn}
          </Text>

          <View style={styles.dots}>
            {SLIDES.map((_, idx) => (
              <View
                key={idx}
                style={[
                  styles.dot,
                  {
                    backgroundColor: idx === step ? theme.electricBlue : theme.border,
                    width: idx === step ? 26 : 8,
                  },
                ]}
              />
            ))}
          </View>
        </GlowCard>

        <View style={{ gap: 12, marginTop: 24 }}>
          {step < SLIDES.length - 1 ? (
            <PrimaryButton
              label={language === 'si' ? 'ඊළඟ (Next) →' : 'Next →'}
              onPress={() => setStep(step + 1)}
            />
          ) : (
            <PrimaryButton
              label={language === 'si' ? 'නොමිලේ ආරම්භ කරන්න' : 'Get Started Free'}
              variant="blue"
              onPress={() => navigate('REGISTER')}
            />
          )}
          <PrimaryButton
            label={language === 'si' ? 'ගිණුමකට පිවිසෙන්න (Sign In)' : 'I Already Have an Account'}
            variant="outline"
            onPress={() => navigate('LOGIN')}
          />
          {!isEmbeddedAndroidApk() && (
            <PrimaryButton
              label={language === 'si' ? '📥 Android APK එක බාගන්න (v1.0.0)' : '📥 Download Android APK (v1.0.0)'}
              variant="blue"
              onPress={() => downloadReleaseArtifact('NEXORA-AI-v1.0.0.apk')}
            />
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 22, justifyContent: 'space-between' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  langBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  centerWrap: { flex: 1, justifyContent: 'center', maxWidth: 520, alignSelf: 'center', width: '100%' },
  title: { fontSize: 23, fontWeight: '900', textAlign: 'center', marginBottom: 12 },
  desc: { fontSize: 14.5, lineHeight: 22, textAlign: 'center', paddingHorizontal: 10 },
  dots: { flexDirection: 'row', gap: 8, marginTop: 26 },
  dot: { height: 8, borderRadius: 4 },
});

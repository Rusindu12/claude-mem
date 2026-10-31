import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { useNexora } from '../context/NexoraContext';

export const SplashScreen: React.FC = () => {
  const { theme } = useNexora();
  const pulse = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.85, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  return (
    <View style={[styles.container, { backgroundColor: '#05050A' }]}>
      <Animated.View
        style={[
          styles.emblemRing,
          {
            borderColor: theme.purple,
            transform: [{ scale: pulse }],
          },
        ]}
      >
        <View style={[styles.innerHex, { borderColor: theme.electricBlue }]}>
          <Text style={[styles.nLetter, { color: theme.electricBlue }]}>N</Text>
        </View>
      </Animated.View>
      <Text style={styles.brand}>NEXORA AI</Text>
      <Text style={[styles.tagline, { color: theme.electricBlue }]}>
        INTELLIGENCE WITHOUT LIMITS
      </Text>
      <Text style={styles.sinhalaSub}>සීමාවකින් තොර කෘත්‍රිම බුද්ධිය</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emblemRing: {
    width: 118,
    height: 118,
    borderRadius: 34,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.14)',
    marginBottom: 24,
  },
  innerHex: {
    width: 82,
    height: 82,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B0D1D',
  },
  nLetter: { fontSize: 44, fontWeight: '900' },
  brand: { color: '#FFFFFF', fontSize: 32, fontWeight: '900', letterSpacing: 3 },
  tagline: { fontSize: 12, fontWeight: '800', letterSpacing: 2.4, marginTop: 8 },
  sinhalaSub: { color: '#94A3B8', fontSize: 13, marginTop: 6 },
});

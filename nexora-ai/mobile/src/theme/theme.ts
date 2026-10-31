export type ThemeMode = 'dark' | 'light';

export interface NexoraTheme {
  mode: ThemeMode;
  bg: string;
  bgSecondary: string;
  card: string;
  cardElevated: string;
  border: string;
  borderGlow: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  purple: string;
  purpleSoft: string;
  electricBlue: string;
  electricSoft: string;
  success: string;
  warning: string;
  danger: string;
  codeBg: string;
}

export const DARK_THEME: NexoraTheme = {
  mode: 'dark',
  bg: '#05050A',
  bgSecondary: '#0A0B14',
  card: '#101223',
  cardElevated: '#171A32',
  border: '#23284A',
  borderGlow: '#8B5CF6',
  text: '#F8FAFC',
  textSecondary: '#CBD5E1',
  textMuted: '#7C86A6',
  purple: '#8B5CF6',
  purpleSoft: 'rgba(139, 92, 246, 0.16)',
  electricBlue: '#00D4FF',
  electricSoft: 'rgba(0, 212, 255, 0.15)',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  codeBg: '#080912',
};

export const LIGHT_THEME: NexoraTheme = {
  mode: 'light',
  bg: '#F5F7FF',
  bgSecondary: '#EEF2FF',
  card: '#FFFFFF',
  cardElevated: '#F8FAFF',
  border: '#DCE3F5',
  borderGlow: '#7C3AED',
  text: '#0F172A',
  textSecondary: '#334155',
  textMuted: '#64748B',
  purple: '#7C3AED',
  purpleSoft: 'rgba(124, 58, 237, 0.12)',
  electricBlue: '#0284C7',
  electricSoft: 'rgba(2, 132, 199, 0.12)',
  success: '#059669',
  warning: '#D97706',
  danger: '#DC2626',
  codeBg: '#0F172A',
};

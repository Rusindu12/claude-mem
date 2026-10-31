import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { NexoraProvider, useNexora } from './src/context/NexoraContext';

import { SplashScreen } from './src/screens/01_SplashScreen';
import { OnboardingScreen } from './src/screens/02_OnboardingScreen';
import { RegisterScreen } from './src/screens/03_RegisterScreen';
import { LoginScreen } from './src/screens/04_LoginScreen';
import { PasswordRecoveryScreen } from './src/screens/05_PasswordRecoveryScreen';
import { HomeDashboardScreen } from './src/screens/06_HomeDashboardScreen';
import { AIChatScreen } from './src/screens/07_AIChatScreen';
import { ModelSelectionScreen } from './src/screens/08_ModelSelectionScreen';
import { ImageGenerationScreen } from './src/screens/09_ImageGenerationScreen';
import { VideoGenerationScreen } from './src/screens/10_VideoGenerationScreen';
import { VoiceAssistantScreen } from './src/screens/11_VoiceAssistantScreen';
import { AICodingScreen } from './src/screens/12_AICodingScreen';
import { DocumentAnalysisScreen } from './src/screens/13_DocumentAnalysisScreen';
import { ChatHistoryScreen } from './src/screens/14_ChatHistoryScreen';
import { CreditWalletScreen } from './src/screens/15_CreditWalletScreen';
import { BuyCreditsScreen } from './src/screens/16_BuyCreditsScreen';
import { SubscriptionPlansScreen } from './src/screens/17_SubscriptionPlansScreen';
import { PaymentHistoryScreen } from './src/screens/18_PaymentHistoryScreen';
import { ReferralSystemScreen } from './src/screens/19_ReferralSystemScreen';
import { NotificationsScreen } from './src/screens/20_NotificationsScreen';
import { UserProfileScreen } from './src/screens/21_UserProfileScreen';
import { SettingsScreen } from './src/screens/22_SettingsScreen';
import { HelpSupportScreen } from './src/screens/23_HelpSupportScreen';
import { AdminOwnerDashboardScreen } from './src/screens/24_AdminOwnerDashboardScreen';

const NexoraRouter: React.FC = () => {
  const { screen, theme, themeMode } = useNexora();

  const renderScreen = () => {
    switch (screen) {
      case 'SPLASH':
        return <SplashScreen />;
      case 'ONBOARDING':
        return <OnboardingScreen />;
      case 'REGISTER':
        return <RegisterScreen />;
      case 'LOGIN':
        return <LoginScreen />;
      case 'PASSWORD_RECOVERY':
        return <PasswordRecoveryScreen />;
      case 'HOME':
        return <HomeDashboardScreen />;
      case 'AI_CHAT':
        return <AIChatScreen />;
      case 'MODEL_SELECTION':
        return <ModelSelectionScreen />;
      case 'IMAGE_GEN':
        return <ImageGenerationScreen />;
      case 'VIDEO_GEN':
        return <VideoGenerationScreen />;
      case 'VOICE_ASSISTANT':
        return <VoiceAssistantScreen />;
      case 'AI_CODING':
        return <AICodingScreen />;
      case 'DOCUMENT_ANALYSIS':
        return <DocumentAnalysisScreen />;
      case 'CHAT_HISTORY':
        return <ChatHistoryScreen />;
      case 'CREDIT_WALLET':
        return <CreditWalletScreen />;
      case 'BUY_CREDITS':
        return <BuyCreditsScreen />;
      case 'SUBSCRIPTION_PLANS':
        return <SubscriptionPlansScreen />;
      case 'PAYMENT_HISTORY':
        return <PaymentHistoryScreen />;
      case 'REFERRALS':
        return <ReferralSystemScreen />;
      case 'NOTIFICATIONS':
        return <NotificationsScreen />;
      case 'USER_PROFILE':
        return <UserProfileScreen />;
      case 'SETTINGS':
        return <SettingsScreen />;
      case 'HELP_SUPPORT':
        return <HelpSupportScreen />;
      case 'ADMIN_DASHBOARD':
        return <AdminOwnerDashboardScreen />;
      default:
        return <HomeDashboardScreen />;
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.bg}
      />
      {renderScreen()}
    </SafeAreaView>
  );
};

export default function App() {
  return (
    <NexoraProvider>
      <NexoraRouter />
    </NexoraProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
});

import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const NotificationsScreen: React.FC = () => {
  const { theme, refreshSessionData } = useNexora();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);

  const load = async () => {
    const res = await apiClient.request('/platform/notifications');
    setNotifications(res.notifications || []);
    setAnnouncements(res.announcements || []);
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const markAllRead = async () => {
    const unread = notifications.filter((n) => !n.is_read);
    await Promise.all(
      unread.map((n) =>
        apiClient.request(`/platform/notifications/${n.id}/read`, { method: 'PATCH' }),
      ),
    );
    await load();
    await refreshSessionData();
  };

  return (
    <ScreenShell
      title="Notifications & Alerts"
      subtitle="Credit Usage, Fallback Notices & Platform Broadcasts"
      showBackTo="HOME"
      rightAction={<PrimaryButton label="Mark All Read" variant="outline" onPress={markAllRead} />}
    >
      {announcements.map((a) => (
        <GlowCard key={a.id} accent="blue">
          <Text style={{ color: theme.electricBlue, fontWeight: '800' }}>📢 {a.title}</Text>
          <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 4 }}>{a.body}</Text>
        </GlowCard>
      ))}

      {notifications.length === 0 ? (
        <GlowCard>
          <Text style={{ color: theme.textMuted }}>You are all caught up!</Text>
        </GlowCard>
      ) : (
        notifications.map((n) => (
          <GlowCard key={n.id} accent={n.is_read ? 'none' : 'purple'}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.text, fontWeight: '800' }}>{n.title}</Text>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                {n.is_read ? 'Read' : '● Unread'}
              </Text>
            </View>
            <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 4 }}>{n.body}</Text>
          </GlowCard>
        ))
      )}
    </ScreenShell>
  );
};

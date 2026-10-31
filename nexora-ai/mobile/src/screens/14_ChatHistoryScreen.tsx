import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import { GlowCard, PrimaryButton, ScreenShell } from '../components/NexoraUI';

export const ChatHistoryScreen: React.FC = () => {
  const { theme, navigate, setActiveConversationId } = useNexora();
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<any[]>([]);

  const load = async (q = search) => {
    const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    const rows = await apiClient.request(`/chat/conversations${query}`);
    setItems(rows || []);
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const deleteConv = async (id: string) => {
    await apiClient.request(`/chat/conversations/${id}`, { method: 'DELETE' });
    await load();
  };

  const togglePin = async (c: any) => {
    await apiClient.request(`/chat/conversations/${c.id}`, {
      method: 'PATCH',
      body: { isPinned: !c.is_pinned },
    });
    await load();
  };

  return (
    <ScreenShell
      title="Conversation History"
      subtitle="Search, Pin, Resume or Delete Saved Multi-Model Chats"
      showBackTo="HOME"
    >
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search chat titles..."
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { color: theme.text, borderColor: theme.border, backgroundColor: theme.card },
          ]}
        />
        <PrimaryButton label="Search" onPress={() => load(search)} />
      </View>

      {items.length === 0 ? (
        <GlowCard>
          <Text style={{ color: theme.textMuted }}>No saved conversations match your filter.</Text>
        </GlowCard>
      ) : (
        items.map((c) => (
          <GlowCard key={c.id} accent={c.is_pinned ? 'purple' : 'none'}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => {
                  setActiveConversationId(c.id);
                  navigate('AI_CHAT');
                }}
              >
                <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15 }}>
                  {c.is_pinned ? '📌 ' : ''}
                  {c.title}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>
                  {c.mode} • {c.message_count} messages • {Number(c.total_credits_used).toFixed(3)} credits
                </Text>
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity onPress={() => togglePin(c)}>
                  <Text style={{ color: theme.electricBlue, fontWeight: '700', fontSize: 12 }}>
                    {c.is_pinned ? 'Unpin' : 'Pin'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteConv(c.id)}>
                  <Text style={{ color: theme.danger, fontWeight: '700', fontSize: 12 }}>
                    Delete
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </GlowCard>
        ))
      )}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
});

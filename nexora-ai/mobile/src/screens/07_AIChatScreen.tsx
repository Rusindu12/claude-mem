import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as Speech from 'expo-speech';
import { apiClient } from '../api/client';
import { useNexora } from '../context/NexoraContext';
import {
  GlowCard,
  MarkdownMessageView,
  PrimaryButton,
  ScreenShell,
} from '../components/NexoraUI';

export const AIChatScreen: React.FC = () => {
  const {
    theme,
    selectedModel,
    activeConversationId,
    setActiveConversationId,
    refreshSessionData,
    navigate,
    language,
    t,
  } = useNexora();

  const [convTitle, setConvTitle] = useState('New Conversation');
  const [editingTitle, setEditingTitle] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [prompt, setPrompt] = useState('');
  const [streamingReply, setStreamingReply] = useState('');
  const [estimatedCredits, setEstimatedCredits] = useState<number | null>(null);
  const [allowFallback, setAllowFallback] = useState(true);
  const [attachedFile, setAttachedFile] = useState<{ id: string; filename: string } | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeConversationId) {
      setConvTitle('New Conversation');
      setMessages([]);
      return;
    }
    apiClient
      .request(`/chat/conversations/${activeConversationId}`)
      .then((res) => {
        setConvTitle(res.conversation.title);
        setMessages(res.messages || []);
      })
      .catch((err) => setError(err.message));
  }, [activeConversationId]);

  // Real-time pre-send credit cost estimate
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!prompt.trim()) {
        setEstimatedCredits(null);
        return;
      }
      apiClient
        .request('/chat/estimate', {
          method: 'POST',
          body: {
            modelId: selectedModel?.id,
            taskType: 'CHAT',
            prompt,
          },
        })
        .then((r) => setEstimatedCredits(r.estimatedCredits))
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [prompt, selectedModel?.id]);

  const pickAttachment = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/*', 'application/pdf', 'application/json', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];

      let base64 = '';
      if (Platform.OS === 'web' && (asset as any).file) {
        const buf = await (asset as any).file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        base64 = btoa(binary);
      } else if (asset.uri.startsWith('data:')) {
        base64 = asset.uri.split(',')[1] || '';
      }

      if (!base64) {
        setError('Unable to read file bytes on this device');
        return;
      }

      const uploaded = await apiClient.request('/files/upload', {
        method: 'POST',
        body: {
          filename: asset.name,
          mimeType: asset.mimeType || 'text/plain',
          contentBase64: base64,
          purpose: 'CHAT_ATTACHMENT',
        },
      });
      setAttachedFile({ id: uploaded.id, filename: uploaded.filename });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSend = async () => {
    if (!prompt.trim() || sending) return;
    setError(null);
    setSending(true);
    setStreamingReply('');

    try {
      if (editingMsgId) {
        await apiClient.request(`/chat/messages/${editingMsgId}`, {
          method: 'PATCH',
          body: { content: prompt.trim(), regenerate: true },
        });
        setEditingMsgId(null);
        setPrompt('');
        if (activeConversationId) {
          const fresh = await apiClient.request(`/chat/conversations/${activeConversationId}`);
          setMessages(fresh.messages || []);
        }
        await refreshSessionData();
        return;
      }

      let convId = activeConversationId;
      if (!convId) {
        const created = await apiClient.request('/chat/conversations', {
          method: 'POST',
          body: {
            title: prompt.trim().slice(0, 56),
            mode: 'CHAT',
            selectedModelId: selectedModel?.id,
            language,
          },
        });
        convId = created.id;
        setActiveConversationId(convId);
      }

      const userText = prompt.trim();
      setPrompt('');
      const fileIds = attachedFile ? [attachedFile.id] : undefined;
      setAttachedFile(null);

      // Optimistic user bubble while streaming SSE tokens
      setMessages((prev) => [
        ...prev,
        { id: `temp-${Date.now()}`, role: 'user', content: userText },
      ]);

      const completed = await apiClient.streamConversationMessage(
        convId!,
        {
          content: userText,
          modelId: selectedModel?.id,
          attachmentFileIds: fileIds,
          allowFallback,
        },
        (delta) => setStreamingReply((prev) => prev + delta),
      );

      setStreamingReply('');
      if (completed?.conversationTitle) setConvTitle(completed.conversationTitle);

      const refreshed = await apiClient.request(`/chat/conversations/${convId}`);
      setMessages(refreshed.messages || []);
      await refreshSessionData();
    } catch (err: any) {
      setStreamingReply('');
      setError(err.message || 'AI request failed');
    } finally {
      setSending(false);
    }
  };

  const handleRegenerate = async () => {
    if (!activeConversationId || sending) return;
    setSending(true);
    setError(null);
    try {
      await apiClient.request(`/chat/conversations/${activeConversationId}/regenerate`, {
        method: 'POST',
        body: { modelId: selectedModel?.id },
      });
      const refreshed = await apiClient.request(`/chat/conversations/${activeConversationId}`);
      setMessages(refreshed.messages || []);
      await refreshSessionData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const saveTitle = async () => {
    setEditingTitle(false);
    if (!activeConversationId) return;
    await apiClient
      .request(`/chat/conversations/${activeConversationId}`, {
        method: 'PATCH',
        body: { title: convTitle },
      })
      .catch(() => undefined);
  };

  const speakText = (text: string) => {
    Speech.stop();
    Speech.speak(text.slice(0, 1200), {
      language: language === 'si' ? 'si-LK' : 'en-US',
      rate: 1.0,
    });
  };

  return (
    <ScreenShell
      title={convTitle}
      subtitle={`Model: ${selectedModel?.displayName || 'Auto Router'}`}
      showBackTo="HOME"
      scrollable={false}
      rightAction={
        <TouchableOpacity
          onPress={() => {
            setActiveConversationId(null);
            setMessages([]);
            setConvTitle('New Conversation');
          }}
          style={[styles.smallChip, { borderColor: theme.purple }]}
        >
          <Text style={{ color: theme.electricBlue, fontSize: 11, fontWeight: '800' }}>+ New</Text>
        </TouchableOpacity>
      }
    >
      {/* Conversation Toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={() => navigate('MODEL_SELECTION')}>
          <Text style={{ color: theme.electricBlue, fontSize: 12, fontWeight: '700' }}>
            🧠 {selectedModel?.displayName || 'Choose Model'}
          </Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setAllowFallback(!allowFallback)}>
            <Text
              style={{
                color: allowFallback ? theme.success : theme.warning,
                fontSize: 11.5,
                fontWeight: '700',
              }}
            >
              {allowFallback ? '✓ Auto-Failover ON' : '⚠ Strict Model Lock'}
            </Text>
          </TouchableOpacity>

          {activeConversationId && (
            <TouchableOpacity onPress={() => setEditingTitle(!editingTitle)}>
              <Text style={{ color: theme.purple, fontSize: 12, fontWeight: '700' }}>✎ Rename</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => navigate('CHAT_HISTORY')}>
            <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: '700' }}>
              🗂 History
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {editingTitle && (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          <TextInput
            value={convTitle}
            onChangeText={setConvTitle}
            style={[
              styles.renameInput,
              { color: theme.text, borderColor: theme.purple, backgroundColor: theme.card },
            ]}
          />
          <PrimaryButton label="Save" onPress={saveTitle} />
        </View>
      )}

      {error && (
        <GlowCard accent="purple" style={{ padding: 10, marginBottom: 8 }}>
          <Text style={{ color: theme.danger, fontSize: 12.5, fontWeight: '700' }}>⚠ {error}</Text>
        </GlowCard>
      )}

      {/* Messages Stream */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingVertical: 8 }}>
        {messages.length === 0 && !streamingReply && (
          <GlowCard style={{ alignItems: 'center', paddingVertical: 28 }}>
            <Text style={{ fontSize: 34, marginBottom: 8 }}>⚡</Text>
            <Text style={{ color: theme.text, fontWeight: '800', fontSize: 16 }}>
              NEXORA Multi-Model Intelligence
            </Text>
            <Text
              style={{
                color: theme.textMuted,
                fontSize: 13,
                textAlign: 'center',
                marginTop: 6,
                maxWidth: 460,
              }}
            >
              Ask in Sinhala (සිංහල) or English, attach documents or images, write code, and inspect exact token credit usage on every turn.
            </Text>
          </GlowCard>
        )}

        {messages.map((m) => {
          const isUser = m.role === 'user';
          return (
            <View
              key={m.id}
              style={[
                styles.msgBubble,
                {
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                  backgroundColor: isUser ? theme.purpleSoft : theme.card,
                  borderColor: isUser ? theme.purple : theme.border,
                  maxWidth: '90%',
                },
              ]}
            >
              {/* Explicit Fallback Notification Banner (NEVER silently switch models!) */}
              {!isUser && m.fallback_used && (
                <View style={[styles.fallbackBanner, { borderColor: theme.warning }]}>
                  <Text style={{ color: theme.warning, fontSize: 11.5, fontWeight: '800' }}>
                    ⚠ {t('fallbackUsedTitle')}: Routed from {m.requested_model_name || 'Selected Model'} →{' '}
                    {m.executed_model_name} ({m.fallback_reason})
                  </Text>
                </View>
              )}

              <MarkdownMessageView content={m.content} />

              <View style={styles.msgFooter}>
                <Text style={{ color: theme.textMuted, fontSize: 10.5 }}>
                  {isUser
                    ? m.is_edited
                      ? 'You (Edited)'
                      : 'You'
                    : `${m.executed_model_name || 'AI'} • ${Number(m.credits_charged || 0).toFixed(3)} cr`}
                </Text>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => Clipboard.setStringAsync(m.content)}>
                    <Text style={{ color: theme.electricBlue, fontSize: 11, fontWeight: '700' }}>
                      Copy
                    </Text>
                  </TouchableOpacity>
                  {isUser ? (
                    <TouchableOpacity
                      onPress={() => {
                        setEditingMsgId(m.id);
                        setPrompt(m.content);
                      }}
                    >
                      <Text style={{ color: theme.purple, fontSize: 11, fontWeight: '700' }}>
                        Edit
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <>
                      <TouchableOpacity onPress={() => speakText(m.content)}>
                        <Text style={{ color: theme.purple, fontSize: 11, fontWeight: '700' }}>
                          🔊 Speak
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={handleRegenerate}>
                        <Text style={{ color: theme.textSecondary, fontSize: 11, fontWeight: '700' }}>
                          ↻ Regenerate
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            </View>
          );
        })}

        {streamingReply ? (
          <View
            style={[
              styles.msgBubble,
              {
                alignSelf: 'flex-start',
                backgroundColor: theme.card,
                borderColor: theme.electricBlue,
                maxWidth: '90%',
              },
            ]}
          >
            <Text style={{ color: theme.electricBlue, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>
              ⚡ Streaming live tokens...
            </Text>
            <MarkdownMessageView content={streamingReply} />
          </View>
        ) : null}
      </ScrollView>

      {/* Pre-Send Credit Estimate & Attachment Strip */}
      <View style={styles.metaBar}>
        {attachedFile && (
          <TouchableOpacity onPress={() => setAttachedFile(null)}>
            <Text style={{ color: theme.electricBlue, fontSize: 11.5, fontWeight: '700' }}>
              📎 {attachedFile.filename} (✕)
            </Text>
          </TouchableOpacity>
        )}
        {editingMsgId && (
          <TouchableOpacity
            onPress={() => {
              setEditingMsgId(null);
              setPrompt('');
            }}
          >
            <Text style={{ color: theme.warning, fontSize: 11.5, fontWeight: '700' }}>
              ✎ Editing message (Cancel ✕)
            </Text>
          </TouchableOpacity>
        )}
        {estimatedCredits !== null && (
          <Text style={{ color: theme.textMuted, fontSize: 11.5, marginLeft: 'auto' }}>
            {t('estimatedCost')}: ~{estimatedCredits.toFixed(3)} credits
          </Text>
        )}
      </View>

      {/* Composer */}
      <View style={[styles.composer, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <TouchableOpacity onPress={pickAttachment} style={styles.attachBtn}>
          <Text style={{ fontSize: 18 }}>📎</Text>
        </TouchableOpacity>
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          multiline
          placeholder={t('typeMessage')}
          placeholderTextColor={theme.textMuted}
          style={[styles.chatInput, { color: theme.text }]}
        />
        <PrimaryButton
          label={editingMsgId ? 'Update' : t('send')}
          onPress={handleSend}
          loading={sending}
          disabled={!prompt.trim()}
        />
      </View>
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 8,
    flexWrap: 'wrap',
    gap: 8,
  },
  smallChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1 },
  renameInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  msgBubble: { padding: 14, borderRadius: 16, borderWidth: 1, gap: 6 },
  fallbackBanner: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
  },
  msgFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    gap: 12,
    flexWrap: 'wrap',
  },
  metaBar: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 10 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    padding: 8,
    gap: 8,
  },
  attachBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  chatInput: { flex: 1, maxHeight: 110, fontSize: 14, paddingHorizontal: 6, paddingVertical: 6 },
});

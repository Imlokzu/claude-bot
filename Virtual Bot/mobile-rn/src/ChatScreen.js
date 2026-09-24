import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { T } from './theme';
import { t } from './i18n';
import { clearConnection, getStatus, sendMessage } from './api';

/* A stable id per conversation keeps the bot's own history lined up with
   what is on screen; a fresh one starts a genuinely separate conversation. */
const newSessionId = () => `rn-${Date.now().toString(36)}`;

export function ChatScreen({ conn, onDisconnected }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(null);
  const [model, setModel] = useState('');
  const [session, setSession] = useState(newSessionId);
  const list = useRef(null);

  /* Polled rather than streamed: the panel learns this from an event stream,
     but that needs an EventSource the platform does not ship, and a wrong
     "connected" badge is worse than one that lags half a minute. */
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const status = await getStatus(conn);
        if (!cancelled) setOnline(status.mode !== 'offline');
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    check();
    const timer = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [conn]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setMessages((prev) => [...prev, { id: `u${Date.now()}`, role: 'user', text }]);
    setSending(true);
    try {
      const reply = await sendMessage(conn, text, session);
      setModel(reply.model || '');
      setMessages((prev) => [
        ...prev,
        { id: `b${Date.now()}`, role: 'bot', text: reply.reply || '' },
      ]);
    } catch (error) {
      // Shown in the thread rather than a toast: a failed turn is part of the
      // conversation's history, and hiding it makes the bot look like it
      // simply ignored the message.
      setMessages((prev) => [
        ...prev,
        { id: `e${Date.now()}`, role: 'error', text: `${t('chat.failed')}: ${error.message}` },
      ]);
    } finally {
      setSending(false);
    }
  }, [draft, sending, conn, session]);

  const forget = async () => {
    await clearConnection();
    onDisconnected();
  };

  const startNew = () => {
    setSession(newSessionId());
    setMessages([]);
    setModel('');
  };

  const renderItem = ({ item }) => (
    <View
      style={[
        s.bubble,
        item.role === 'user' && s.bubbleUser,
        item.role === 'error' && s.bubbleError,
      ]}
    >
      <Text style={[s.bubbleText, item.role === 'user' && s.bubbleTextUser]}>
        {item.text}
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={s.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={s.bar}>
        <View
          style={[
            s.dot,
            online === false && s.dotOff,
            online === null && s.dotIdle,
          ]}
        />
        <Text style={s.barText} numberOfLines={1}>
          {online === false ? t('status.offline') : (model || t('status.online'))}
        </Text>
        <Pressable onPress={startNew} hitSlop={8}>
          <Text style={s.barAction}>{t('chat.newSession')}</Text>
        </Pressable>
        <Pressable onPress={forget} hitSlop={8}>
          <Text style={s.barAction}>{t('chat.forget')}</Text>
        </Pressable>
      </View>

      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={s.listBody}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={<Text style={s.empty}>{t('chat.empty')}</Text>}
      />

      {sending ? (
        <View style={s.thinking}>
          <ActivityIndicator size="small" color={T.ink3} />
          <Text style={s.thinkingText}>{t('chat.thinking')}</Text>
        </View>
      ) : null}

      <View style={s.composer}>
        <TextInput
          style={s.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={T.ink3}
          multiline
          editable={!sending}
        />
        <Pressable
          style={({ pressed }) => [
            s.send,
            (sending || !draft.trim() || pressed) && s.sendDim,
          ]}
          onPress={send}
          disabled={sending || !draft.trim()}
        >
          <Text style={s.sendText}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: T.line,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.ok },
  dotOff: { backgroundColor: T.err },
  dotIdle: { backgroundColor: T.ink3 },
  barText: { flex: 1, color: T.ink2, fontSize: 12 },
  barAction: { color: T.accent, fontSize: 12 },

  listBody: { padding: 14, gap: 10 },
  empty: { color: T.ink3, fontSize: 13, textAlign: 'center', marginTop: 48 },
  bubble: {
    maxWidth: '86%', alignSelf: 'flex-start',
    backgroundColor: T.surface, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: T.surface2 },
  bubbleError: { backgroundColor: 'rgba(199,106,81,0.16)' },
  bubbleText: { color: T.ink, fontSize: 15, lineHeight: 21 },
  bubbleTextUser: { color: T.ink },

  thinking: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingBottom: 6,
  },
  thinkingText: { color: T.ink3, fontSize: 12.5 },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    padding: 12, borderTopWidth: 1, borderTopColor: T.line,
  },
  input: {
    flex: 1, maxHeight: 130,
    backgroundColor: T.surface, borderRadius: 12,
    borderWidth: 1, borderColor: T.line,
    color: T.ink, fontSize: 15,
    paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11,
  },
  send: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center',
  },
  sendDim: { opacity: 0.45 },
  sendText: { color: T.accentInk, fontSize: 19, fontWeight: '700' },
});

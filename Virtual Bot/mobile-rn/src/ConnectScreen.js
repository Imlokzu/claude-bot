import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { T } from './theme';
import { t } from './i18n';
import { getStatus, parseTarget, saveConnection } from './api';

/*
 * First screen: work out where the bot is and prove it answers before
 * committing. Storing an address that turns out to be dead would drop the
 * user straight into a chat screen that can never send anything.
 */
export function ConnectScreen({ onConnected }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [bad, setBad] = useState(false);

  const connect = async () => {
    const target = parseTarget(text);
    if (!target) {
      setBad(true);
      setNote(t('connect.bad'));
      return;
    }
    setBusy(true);
    setBad(false);
    setNote(t('connect.checking'));
    try {
      await getStatus(target);
      await saveConnection(target);
      onConnected(target);
    } catch {
      setBad(true);
      setNote(target.key ? t('connect.failed') : t('connect.noKey'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.inner}>
        <Text style={s.title}>{t('connect.title')}</Text>
        <Text style={s.lead}>{t('connect.lead')}</Text>
        <Text style={s.label}>{t('connect.label')}</Text>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder="https://…/dash/?key=…"
          placeholderTextColor={T.ink3}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={!busy}
          onSubmitEditing={connect}
        />
        <Pressable
          style={({ pressed }) => [s.button, (busy || pressed) && s.buttonDim]}
          onPress={connect}
          disabled={busy}
        >
          {busy
            ? <ActivityIndicator color={T.accentInk} />
            : <Text style={s.buttonText}>{t('connect.go')}</Text>}
        </Pressable>
        {note ? <Text style={[s.note, bad && s.noteBad]}>{note}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center' },
  inner: { padding: 22 },
  title: { color: T.ink, fontSize: 22, fontWeight: '600', marginBottom: 6 },
  lead: { color: T.ink2, fontSize: 13.5, lineHeight: 20, marginBottom: 24 },
  label: { color: T.ink3, fontSize: 11, letterSpacing: 0.6, marginBottom: 7 },
  input: {
    borderWidth: 1, borderColor: T.line, backgroundColor: T.surface,
    color: T.ink, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15,
  },
  button: {
    marginTop: 12, borderRadius: 10, backgroundColor: T.accent,
    paddingVertical: 14, alignItems: 'center',
  },
  buttonDim: { opacity: 0.6 },
  buttonText: { color: T.accentInk, fontSize: 15, fontWeight: '600' },
  note: { marginTop: 16, color: T.ink3, fontSize: 13, lineHeight: 19 },
  noteBad: { color: T.err },
});

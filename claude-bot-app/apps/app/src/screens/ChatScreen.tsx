/**
 * Головний і поки що єдиний екран: розмова.
 *
 * Дебаг-панель має вісім розділів, бо це стенд. Застосунок — ні: тут лише
 * чат і кодинг-режим, як і має бути в продукті. Решта (памʼять, сервіси,
 * логи, зір) лишається в панелі — це інструменти розробки, а не те, чим
 * користуються щодня.
 */
import React from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, shape, space, touchTarget, type ChatMode, type Message, type ModelOption } from '@claude-bot/core';
import { useApi } from '../api';
import { useTheme } from '../theme';
import { Bubble } from '../ui/Bubble';
import { Composer } from '../ui/Composer';
import { Icon } from '../ui/Icon';
import { Segmented } from '../ui/Segmented';

interface Row extends Message {
  key: string;
  /** Мозок, який реально відповів (щоб не приписувати відповідь обраній моделі). */
  brand?: string;
  error?: boolean;
}

export function ChatScreen() {
  const { palette, fonts } = useTheme();
  const { client, baseUrl } = useApi();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = React.useState<ChatMode>('chat');
  const [codeAvailable, setCodeAvailable] = React.useState(false);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [sessionId, setSessionId] = React.useState('');
  const [models, setModels] = React.useState<ModelOption[]>([]);
  const [selected, setSelected] = React.useState('');
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [bootError, setBootError] = React.useState('');
  const [activeBrain, setActiveBrain] = React.useState('');

  const listRef = React.useRef<FlatList<Row>>(null);

  // Стартове читання середовища. Помилка тут — не «нічого не працює», а
  // конкретна причина: інакше користувач бачить порожній екран без підказки.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [m, code] = await Promise.all([
          client.models(),
          client.codeStatus().catch(() => ({ available: false }) as { available: boolean }),
        ]);
        if (!alive) return;
        setModels(m.models);
        setSelected(m.selected);
        // «Хто відповів останнім» — окремо від «що обрано»: інакше екран
        // приписував би відповідь моделі, яка її не давала.
        if (m.active) setActiveBrain(m.active);
        setCodeAvailable(!!code.available);
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof ApiError ? e.message : String(e);
        setBootError(`Не вдалося звʼязатися з ботом (${baseUrl}): ${msg}`);
      }
    })();
    return () => { alive = false; };
  }, [client, baseUrl]);

  const pickModel = async (value: string) => {
    setPickerOpen(false);
    const previous = selected;
    setSelected(value); // оптимістично — щоб вибір не «залипав» до відповіді
    try {
      await client.selectModel(value);
    } catch {
      setSelected(previous);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setBusy(true);
    const mine: Row = { key: `u${Date.now()}`, role: 'user', content: text };
    setRows((r) => [...r, mine]);
    try {
      // Історію віддаємо самі: бекенд тримає її за session_id, але на першому
      // ході id ще немає, і без цього бот втратив би контекст.
      const history = rows.map((r) => ({ role: r.role, content: r.content }));
      const res = await client.chat({ message: text, session_id: sessionId, history });
      if (res.session_id && res.session_id !== sessionId) setSessionId(res.session_id);
      setRows((r) => [
        ...r,
        {
          key: `a${Date.now()}`,
          role: 'assistant',
          content: res.reply,
          emotion: res.emotion,
          brand: brandFor(res),
        },
      ]);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setRows((r) => [...r, { key: `e${Date.now()}`, role: 'assistant', content: msg, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  React.useEffect(() => {
    if (rows.length) listRef.current?.scrollToEnd({ animated: true });
  }, [rows.length]);

  const selectedLabel = models.find((m) => m.id === selected)?.label ?? '—';

  return (
    <View style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}>
      {/* ---- шапка ---- */}
      <View style={[styles.header, { borderBottomColor: palette.outlineVariant }]}>
        <View style={styles.headerTop}>
          <Text style={[styles.brand, { color: palette.primary, fontFamily: fonts.serif }]}>
            Клод Бот
          </Text>
          <Pressable
            onPress={() => { setRows([]); setSessionId(''); }}
            accessibilityRole="button"
            accessibilityLabel="Нова розмова"
            style={styles.iconBtn}
          >
            <Icon name="plus" size={22} color={palette.onSurfaceVariant} />
          </Pressable>
        </View>

        <View style={styles.headerControls}>
          {/* Перемикач показуємо лише коли кодинг реально доступний:
              мертва кнопка гірша за її відсутність. */}
          {codeAvailable && (
            <Segmented
              label="Режим розмови"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'chat', label: 'Чат', icon: 'chat' },
                { value: 'code', label: 'Код', icon: 'code' },
              ]}
            />
          )}
          <Pressable
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Модель: ${selectedLabel}. Змінити`}
            style={[styles.modelBtn, { borderColor: palette.outline }]}
          >
            <Text numberOfLines={1} style={[styles.modelText, { color: palette.onSurface, fontFamily: fonts.sans }]}>
              {selectedLabel}
            </Text>
          </Pressable>
          {/* Правда про те, хто відповідає насправді. Дебаг-панель показувала
              обрану модель навіть коли працював демо-режим — виглядало так,
              ніби це вона так відповіла. */}
          {activeBrain && activeBrain !== selectedLabel && (
            <Text style={[styles.liveBrain, { color: palette.onSurfaceVariant, fontFamily: fonts.sans }]}>
              {activeBrain}
            </Text>
          )}
        </View>
      </View>

      {/* ---- розмова ---- */}
      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {bootError ? (
          <View style={styles.center}>
            <Icon name="error" size={40} color={palette.error} />
            <Text style={[styles.errTitle, { color: palette.onSurface, fontFamily: fonts.serif }]}>
              Бот не відповідає
            </Text>
            <Text style={[styles.errText, { color: palette.onSurfaceVariant, fontFamily: fonts.sans }]}>
              {bootError}
            </Text>
            <Text style={[styles.errHint, { color: palette.onSurfaceVariant, fontFamily: fonts.mono }]}>
              Запустіть бекенд: cd "Virtual Bot" && ./start.sh
            </Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.center}>
            <View style={[styles.mark, { backgroundColor: palette.secondaryContainer }]}>
              <Icon name={mode === 'code' ? 'code' : 'chat'} size={30} color={palette.onSecondaryContainer} />
            </View>
            <Text style={[styles.emptyTitle, { color: palette.onSurface, fontFamily: fonts.serif }]}>
              {mode === 'code' ? 'Задача для агента' : 'Про що поговоримо?'}
            </Text>
            <Text style={[styles.emptyLead, { color: palette.onSurfaceVariant, fontFamily: fonts.sans }]}>
              {mode === 'code'
                ? 'Опишіть, що зробити з кодом — агент працює у робочій теці бота.'
                : 'Напишіть повідомлення внизу.'}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(r) => r.key}
            renderItem={({ item }) => (
              <Bubble role={item.role} content={item.content} brand={item.brand} error={item.error} />
            )}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {busy && (
          <View style={styles.typing}>
            <ActivityIndicator size="small" color={palette.primary} />
            <Text style={[styles.typingText, { color: palette.onSurfaceVariant, fontFamily: fonts.sans }]}>
              думає…
            </Text>
          </View>
        )}

        <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={send}
            busy={busy}
            placeholder={mode === 'code' ? 'Задача для агента…' : 'Повідомлення…'}
          />
        </View>
      </KeyboardAvoidingView>

      {/* ---- вибір моделі ---- */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setPickerOpen(false)} accessibilityLabel="Закрити" />
        <View style={[styles.sheet, { backgroundColor: palette.surfaceContainerLow, paddingBottom: Math.max(insets.bottom, space.lg) }]}>
          <View style={[styles.handle, { backgroundColor: palette.outline }]} />
          <Text style={[styles.sheetTitle, { color: palette.onSurfaceVariant, fontFamily: fonts.sans }]}>
            Модель
          </Text>
          <FlatList
            data={models}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => {
              const on = item.id === selected;
              return (
                <Pressable
                  onPress={() => pickModel(item.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[styles.modelRow, on ? { backgroundColor: palette.secondaryContainer } : null]}
                >
                  <Icon name="check" size={18} color={on ? palette.onSecondaryContainer : 'transparent'} weight={2.2} />
                  <Text style={[styles.modelRowText, { color: on ? palette.onSecondaryContainer : palette.onSurface, fontFamily: fonts.sans }]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

/** Підпис під бульбашкою: хто РЕАЛЬНО відповів. */
function brandFor(res: { mode?: string; model?: string }): string {
  const mode = res.mode || '';
  if (mode === 'demo') return 'демо-режим (мозок недоступний)';
  if (res.model) return res.model;
  return mode || 'Клод Бот';
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: 1, gap: space.sm },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: touchTarget },
  brand: { fontSize: 19, fontWeight: '600' },
  iconBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerControls: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  modelBtn: {
    flexShrink: 1, minWidth: 0, height: touchTarget, justifyContent: 'center',
    paddingHorizontal: space.md, borderWidth: 1, borderRadius: shape.full,
  },
  modelText: { fontSize: 13 },
  liveBrain: { fontSize: 11, opacity: 0.85 },
  body: { flex: 1, minHeight: 0 },
  list: { padding: space.md, paddingBottom: space.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  mark: { width: 64, height: 64, borderRadius: shape.full, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 22, fontWeight: '600' },
  emptyLead: { fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 340 },
  errTitle: { fontSize: 20, fontWeight: '600' },
  errText: { fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 380 },
  errHint: { fontSize: 12, marginTop: space.xs },
  typing: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.xs },
  typingText: { fontSize: 13 },
  composerWrap: { paddingHorizontal: space.md, paddingTop: space.xs },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.32)' },
  sheet: { maxHeight: '62%', borderTopLeftRadius: shape.xl, borderTopRightRadius: shape.xl, paddingHorizontal: space.sm },
  handle: { width: 32, height: 4, borderRadius: shape.full, alignSelf: 'center', marginVertical: space.sm, opacity: 0.5 },
  sheetTitle: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: space.md, paddingBottom: space.xs },
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.md, borderRadius: shape.md },
  modelRowText: { fontSize: 15, flex: 1 },
});

/**
 * Список розмов.
 *
 * На широкому екрані стоїть окремою колонкою, на телефоні — виїжджає
 * шухлядою з кнопки ☰. Це той самий компонент: різниця лише в тому, хто
 * його розміщує (див. ChatScreen).
 */
import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { shape, space, touchTarget, type SessionSummary } from '@claude-bot/core';
import { useTheme } from '../theme';
import { Icon } from './Icon';

interface Props {
  sessions: SessionSummary[];
  activeId: string;
  loading?: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  /** Заголовок над списком; на телефоні його малює сама шухляда. */
  showHeader?: boolean;
}

/** «5 хв тому» замість «1787295073»: у списку важлива свіжість, не точний час. */
function ago(unixSeconds: number): string {
  const diff = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (diff < 60) return 'щойно';
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m} хв тому`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} год тому`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'вчора' : `${d} дн тому`;
}

export function SessionList({
  sessions, activeId, loading, onOpen, onNew, onDelete, showHeader = true,
}: Props) {
  const { palette, fonts } = useTheme();
  const [confirmId, setConfirmId] = React.useState('');

  return (
    <View style={styles.root}>
      {showHeader && (
        <View style={styles.head}>
          <Text style={[styles.headText, { color: palette.onSurfaceVariant, fontFamily: fonts.sans }]}>
            Розмови
          </Text>
          <Pressable
            onPress={onNew}
            accessibilityRole="button"
            accessibilityLabel="Нова розмова"
            style={styles.headBtn}
          >
            <Icon name="plus" size={20} color={palette.onSurfaceVariant} />
          </Pressable>
        </View>
      )}

      {loading && sessions.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={palette.primary} />
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.empty, { color: palette.onSurfaceVariant, fontFamily: fonts.sans }]}>
            Ще немає розмов
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const on = item.id === activeId;
            const asking = confirmId === item.id;
            return (
              <View style={styles.rowWrap}>
                {/* Рядок — це View з ДВОМА сусідніми Pressable, а не
                    Pressable у Pressable: на вебі вкладена кнопка дає
                    невалідний HTML (<button> у <button>) і помилку
                    гідратації, а дотик на мобільному ловить не той шар. */}
                <View
                  style={[
                    styles.row,
                    on ? { backgroundColor: palette.secondaryContainer } : null,
                  ]}
                >
                  <Pressable
                    onPress={() => onOpen(item.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${item.title || 'Без назви'}, ${ago(item.updated)}`}
                    style={styles.rowText}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.title, {
                        color: on ? palette.onSecondaryContainer : palette.onSurface,
                        fontFamily: fonts.sans,
                        fontWeight: on ? '600' : '500',
                      }]}
                    >
                      {item.title || 'Без назви'}
                    </Text>
                    <Text
                      style={[styles.meta, {
                        color: on ? palette.onSecondaryContainer : palette.onSurfaceVariant,
                        fontFamily: fonts.sans,
                        opacity: on ? 0.8 : 1,
                      }]}
                    >
                      {ago(item.updated)}
                      {item.count ? ` · ${item.count}` : ''}
                    </Text>
                  </Pressable>
                  {/* Видалення у два кроки: розмову легко втратити випадковим
                      дотиком, а скасувати її вже нічим. */}
                  <Pressable
                    onPress={() => setConfirmId(asking ? '' : item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={asking ? 'Скасувати видалення' : `Видалити «${item.title}»`}
                    hitSlop={8}
                    style={styles.rowAction}
                  >
                    <Icon
                      name={asking ? 'close' : 'trash'}
                      size={16}
                      color={on ? palette.onSecondaryContainer : palette.onSurfaceVariant}
                    />
                  </Pressable>
                </View>

                {asking && (
                  <Pressable
                    onPress={() => { setConfirmId(''); onDelete(item.id); }}
                    accessibilityRole="button"
                    accessibilityLabel="Підтвердити видалення"
                    style={[styles.confirm, { backgroundColor: palette.error }]}
                  >
                    <Text style={[styles.confirmText, { color: palette.onPrimary, fontFamily: fonts.sans }]}>
                      Видалити назавжди
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingLeft: space.md, paddingRight: space.xs, minHeight: touchTarget,
  },
  headText: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  headBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  empty: { fontSize: 13 },
  list: { paddingHorizontal: space.xs, paddingBottom: space.md },
  rowWrap: { marginBottom: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    minHeight: 56, paddingHorizontal: space.md, borderRadius: shape.md, overflow: 'hidden',
  },
  rowText: { flex: 1, minWidth: 0, justifyContent: 'center', minHeight: 56, paddingVertical: 6 },
  title: { fontSize: 14 },
  meta: { fontSize: 11, marginTop: 2 },
  rowAction: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  confirm: {
    minHeight: touchTarget, borderRadius: shape.md, marginHorizontal: space.xs,
    marginTop: 2, alignItems: 'center', justifyContent: 'center',
  },
  confirmText: { fontSize: 13, fontWeight: '600' },
});

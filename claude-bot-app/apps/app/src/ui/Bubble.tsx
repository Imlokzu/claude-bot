/**
 * Бульбашка повідомлення.
 *
 * У дебаг-панелі і моє, і ботове повідомлення виглядали однаково — сірі
 * прямокутники ліворуч. Розрізняти, хто що сказав, — базова річ, тому тут
 * різниця тримається на ТРЬОХ ознаках, а не на одній: бік, колір і підпис.
 * Одного кольору мало: у чорно-білому режимі й при дальтонізмі він зникає.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { shape, space } from '@claude-bot/core';
import { useTheme } from '../theme';

interface Props {
  role: 'user' | 'assistant';
  content: string;
  /** Мозок, який реально відповів — щоб не думати, що це сказала обрана модель. */
  brand?: string;
  error?: boolean;
}

export function Bubble({ role, content, brand, error }: Props) {
  const { palette, fonts } = useTheme();
  const mine = role === 'user';
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={styles.col}>
        <Text
          style={[styles.who, { color: palette.onSurfaceVariant, fontFamily: fonts.sans }]}
        >
          {mine ? 'Ви' : brand || 'Клод Бот'}
        </Text>
        <View
          style={[
            styles.bubble,
            mine
              ? {
                  backgroundColor: palette.surfaceContainerHigh,
                  borderBottomRightRadius: shape.xs,
                }
              : {
                  backgroundColor: palette.secondaryContainer,
                  borderBottomLeftRadius: shape.xs,
                },
            error ? { backgroundColor: palette.error } : null,
          ]}
        >
          <Text
            selectable
            style={[
              styles.text,
              {
                color: error
                  ? palette.onPrimary
                  : mine
                    ? palette.onSurface
                    : palette.onSecondaryContainer,
                fontFamily: fonts.sans,
              },
            ]}
          >
            {content}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: space.md },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  // 86% — щоб довга репліка не тягнулася від краю до краю: рядок понад
  // ~75 символів читається помітно гірше.
  col: { maxWidth: '86%' },
  who: { fontSize: 11, letterSpacing: 0.4, marginBottom: 4, marginHorizontal: 4 },
  bubble: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: shape.lg,
  },
  text: { fontSize: 15, lineHeight: 23 },
});

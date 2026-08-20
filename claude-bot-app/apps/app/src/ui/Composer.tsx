/**
 * Смуга вводу. Поле росте до 6 рядків, далі прокручується — так довгий
 * текст видно, але композер не з'їдає весь екран.
 */
import React from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { shape, space, touchTarget } from '@claude-bot/core';
import { useTheme } from '../theme';
import { Icon } from './Icon';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder: string;
  busy?: boolean;
}

export function Composer({ value, onChange, onSend, placeholder, busy }: Props) {
  const { palette, fonts } = useTheme();
  const canSend = value.trim().length > 0 && !busy;
  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: palette.surfaceContainerLow, borderColor: palette.outlineVariant },
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.onSurfaceVariant}
        multiline
        // На вебі Enter надсилає, Shift+Enter — новий рядок. На телефоні
        // Enter завжди новий рядок: там надсилають кнопкою.
        onKeyPress={
          Platform.OS === 'web'
            ? (e) => {
                const ev = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
                if (ev.key === 'Enter' && !ev.shiftKey) {
                  e.preventDefault?.();
                  if (canSend) onSend();
                }
              }
            : undefined
        }
        style={[styles.input, { color: palette.onSurface, fontFamily: fonts.sans }]}
        accessibilityLabel="Повідомлення"
      />
      <Pressable
        onPress={onSend}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Надіслати"
        accessibilityState={{ disabled: !canSend }}
        style={[
          styles.send,
          {
            backgroundColor: canSend ? palette.primaryStrong : palette.surfaceContainerHigh,
          },
        ]}
      >
        <Icon
          name={busy ? 'stop' : 'send'}
          size={20}
          color={canSend ? palette.onPrimary : palette.onSurfaceVariant}
          weight={2}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.sm,
    borderWidth: 1,
    borderRadius: shape.xl,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: space.sm,
    paddingVertical: 10,
    maxHeight: 140,
    // Прибираємо власне обведення веб-інпута: рамку малює обгортка
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : null),
  },
  send: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

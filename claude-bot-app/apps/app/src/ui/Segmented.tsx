/**
 * Сегментований перемикач Material 3 — той самий компонент, що й «Чат / Код»
 * у веб-панелі.
 *
 * Обране позначає не лише колір, а й ГАЛОЧКА: заливка сама по собі нічого не
 * каже в чорно-білому режимі й людині з дальтонізмом. Це не декор, а те, що
 * робить вибір читабельним.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { shape, touchTarget } from '@claude-bot/core';
import { useTheme } from '../theme';
import { Icon, type IconName } from './Icon';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

interface Props<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Тягнути на всю доступну ширину (на телефоні так зручніше пальцем). */
  stretch?: boolean;
  label: string;
}

export function Segmented<T extends string>({
  options, value, onChange, stretch, label,
}: Props<T>) {
  const { palette } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[
        styles.wrap,
        { borderColor: palette.outline },
        stretch ? styles.stretch : null,
      ]}
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled: !!opt.disabled }}
            accessibilityLabel={opt.label}
            disabled={opt.disabled}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.seg,
              stretch ? styles.segStretch : null,
              // Розділювач між сегментами — крім останнього
              i < options.length - 1 ? { borderRightWidth: 1, borderRightColor: palette.outline } : null,
              active ? { backgroundColor: palette.secondaryContainer } : null,
              // state layer M3: натискання, а не зміна кольору фону
              pressed && !opt.disabled
                ? { backgroundColor: active ? palette.secondaryContainer : palette.surfaceContainerHigh }
                : null,
              opt.disabled ? styles.disabled : null,
            ]}
          >
            {active && (
              <Icon name="check" size={17} color={palette.onSecondaryContainer} weight={2.2} />
            )}
            {!active && opt.icon && (
              <Icon name={opt.icon} size={17} color={palette.onSurfaceVariant} />
            )}
            <Text
              style={[
                styles.text,
                {
                  color: active ? palette.onSecondaryContainer : palette.onSurfaceVariant,
                  fontWeight: active ? '600' : '500',
                },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: touchTarget,
    borderWidth: 1,
    borderRadius: shape.full,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  stretch: { alignSelf: 'stretch' },
  seg: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 18,
    minWidth: 74,
  },
  segStretch: { flex: 1, minWidth: 0 },
  text: { fontSize: 14 },
  disabled: { opacity: 0.38 },
});

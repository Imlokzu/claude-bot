/**
 * Клієнт бекенду, доступний усьому застосунку.
 *
 * Головна платформенна відмінність — АДРЕСА. У вебі бекенд на іншому порту
 * того ж хоста; у Expo Go на телефоні «localhost» вказує на сам телефон, тому
 * потрібна LAN-адреса компʼютера. Її беремо з EXPO_PUBLIC_API_URL, а якщо не
 * задано — витягуємо хост із адреси, з якої завантажився бандл Metro.
 */
import React from 'react';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { BotClient } from '@claude-bot/core';

const DEFAULT_PORT = 8100;

function resolveBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  if (Platform.OS === 'web') {
    // У вебі origin сторінки — це Metro (8081) або Electron, а не бекенд.
    return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_PORT}`;
  }

  // Expo Go: hostUri виглядає як "192.168.0.10:8081" — беремо звідти саме IP
  // компʼютера, бо «localhost» на телефоні означав би сам телефон.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost ??
    '';
  const host = hostUri.split(':')[0];
  if (host) return `http://${host}:${DEFAULT_PORT}`;

  // Останній відступ: емулятор Android бачить хост-машину як 10.0.2.2.
  return Platform.OS === 'android'
    ? `http://10.0.2.2:${DEFAULT_PORT}`
    : `http://127.0.0.1:${DEFAULT_PORT}`;
}

const ApiContext = React.createContext<{ client: BotClient; baseUrl: string } | null>(null);

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const value = React.useMemo(() => {
    const baseUrl = resolveBaseUrl();
    return { baseUrl, client: new BotClient({ baseUrl }) };
  }, []);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi() {
  const ctx = React.useContext(ApiContext);
  if (!ctx) throw new Error('useApi треба викликати всередині <ApiProvider>');
  return ctx;
}

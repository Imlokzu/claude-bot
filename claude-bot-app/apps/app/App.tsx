import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiProvider } from './src/api';
import { ThemeProvider, useTheme } from './src/theme';
import { ChatScreen } from './src/screens/ChatScreen';

/** Статусбар має слідувати за темою, тому живе під ThemeProvider. */
function Bar() {
  const { name } = useTheme();
  return <StatusBar style={name === 'dark' ? 'light' : 'dark'} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ApiProvider>
          <Bar />
          <ChatScreen />
        </ApiProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

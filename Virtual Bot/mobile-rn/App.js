import { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { T } from './src/theme';
import { loadConnection } from './src/api';
import { ConnectScreen } from './src/ConnectScreen';
import { ChatScreen } from './src/ChatScreen';

/*
 * Two screens and no router: the app either knows where the bot is or it is
 * asking. A navigation library would add a dependency to express one boolean.
 *
 * The stored address is not re-validated on launch. Checking first would put
 * a spinner in front of every start for a network round trip, and a stale
 * address surfaces soon enough as a failed send, which the chat screen shows
 * in the thread.
 */
export default function App() {
  const [conn, setConn] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadConnection().then((saved) => {
      setConn(saved);
      setReady(true);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        {!ready ? (
          <View style={s.centre}>
            <ActivityIndicator color={T.accent} />
          </View>
        ) : conn ? (
          <ChatScreen conn={conn} onDisconnected={() => setConn(null)} />
        ) : (
          <ConnectScreen onConnected={setConn} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

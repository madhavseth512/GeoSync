import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AuthScreen from './src/screens/AuthScreen';
import RoomScreen from './src/screens/RoomScreen';
import MapScreen from './src/screens/MapScreen';
import { getToken, isTokenExpired } from './src/lib/auth';
import { colors } from './src/lib/theme';

// Importing this registers the background location task with TaskManager. It
// MUST happen at module scope on app startup — the OS may launch the app
// headlessly to deliver a location, and the task has to already be defined.
import './src/lib/location-task';

const Stack = createNativeStackNavigator();

export default function App() {
  // null = still checking stored token; once known, set the initial route.
  const [initialRoute, setInitialRoute] = useState(null);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      // Valid token → skip login and land on the room screen (mirrors web boot).
      setInitialRoute(token && !isTokenExpired(token) ? 'Room' : 'Auth');
    })();
  }, []);

  if (!initialRoute) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Auth" component={AuthScreen} />
          <Stack.Screen name="Room" component={RoomScreen} />
          <Stack.Screen name="Map" component={MapScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});

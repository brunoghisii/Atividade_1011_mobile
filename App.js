import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { BottomNavigation, MD3DarkTheme, MD3LightTheme, PaperProvider } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import myColors from "./assets/colors.json";
import myColorsDark from "./assets/colorsDark.json";
import { loadSession, logout, setOnSessionEnd } from "./src/api";
import { AuthContext } from "./src/auth";
import { UiProvider } from "./src/ui";
import LoginScreen from "./src/screens/LoginScreen";
import AgendaScreen from "./src/screens/AgendaScreen";
import PatientsScreen from "./src/screens/PatientsScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import PortalHome from "./src/screens/portal/PortalHome";
import PortalBook from "./src/screens/portal/PortalBook";
import PortalHistory from "./src/screens/portal/PortalHistory";
import PortalAccount from "./src/screens/portal/PortalAccount";
import FirstAccess from "./src/screens/portal/FirstAccess";

const PATIENT_ROUTES = [
  { key: "home", title: "Início", focusedIcon: "home-heart", unfocusedIcon: "home-outline" },
  { key: "book", title: "Agendar", focusedIcon: "calendar-plus", unfocusedIcon: "calendar-plus" },
  { key: "history", title: "Sessões", focusedIcon: "history", unfocusedIcon: "history" },
  { key: "account", title: "Conta", focusedIcon: "account-circle", unfocusedIcon: "account-circle-outline" },
];

const ROUTES = [
  { key: "agenda", title: "Agenda", focusedIcon: "calendar-month", unfocusedIcon: "calendar-month-outline" },
  { key: "patients", title: "Pacientes", focusedIcon: "account-group", unfocusedIcon: "account-group-outline" },
  { key: "settings", title: "Ajustes", focusedIcon: "cog", unfocusedIcon: "cog-outline" },
];

export default function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [index, setIndex] = useState(0);

  const theme = useMemo(
    () =>
      darkMode
        ? { ...MD3DarkTheme, colors: { ...MD3DarkTheme.colors, ...myColorsDark.colors } }
        : { ...MD3LightTheme, colors: { ...MD3LightTheme.colors, ...myColors.colors } },
    [darkMode]
  );

  useEffect(() => {
    // Preferência visual (não sensível) fica no AsyncStorage; a sessão fica no SecureStore.
    AsyncStorage.getItem("darkMode").then((v) => v !== null && setDarkMode(v === "true")).catch(() => {});
    setOnSessionEnd(() => setUser(null));
    loadSession()
      .then((s) => setUser(s?.user ?? null))
      .finally(() => setBooting(false));
  }, []);

  function toggleDark() {
    const v = !darkMode;
    setDarkMode(v);
    AsyncStorage.setItem("darkMode", String(v)).catch(() => {});
  }

  async function signOut() {
    await logout();
    setUser(null);
    setIndex(0);
  }

  const auth = useMemo(() => ({ user, signOut }), [user]);

  let content;
  if (booting) {
    content = (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.colors.background }}>
        <ActivityIndicator size="large" />
      </View>
    );
  } else if (!user) {
    content = <LoginScreen onLogged={(u) => (setIndex(0), setUser(u))} />;
  } else if (user.role === "paciente" && user.mustChangePassword) {
    content = <FirstAccess onDone={setUser} />;
  } else if (user.role === "paciente") {
    content = (
      <BottomNavigation
        navigationState={{ index, routes: PATIENT_ROUTES }}
        onIndexChange={setIndex}
        renderScene={({ route }) => {
          if (route.key === "home") return <PortalHome onBook={() => setIndex(1)} />;
          if (route.key === "book") return <PortalBook onDone={() => setIndex(0)} />;
          if (route.key === "history") return <PortalHistory />;
          return <PortalAccount darkMode={darkMode} onToggleDark={toggleDark} />;
        }}
      />
    );
  } else {
    content = (
      <BottomNavigation
        navigationState={{ index, routes: ROUTES }}
        onIndexChange={setIndex}
        renderScene={({ route }) => {
          if (route.key === "agenda") return <AgendaScreen />;
          if (route.key === "patients") return <PatientsScreen />;
          return <SettingsScreen darkMode={darkMode} onToggleDark={toggleDark} />;
        }}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <AuthContext.Provider value={auth}>
          <UiProvider>
            <StatusBar style={darkMode ? "light" : "dark"} />
            {content}
          </UiProvider>
        </AuthContext.Provider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

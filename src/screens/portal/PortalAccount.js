import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Appbar, Card, List, Portal, Switch, Text, useTheme } from "react-native-paper";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { isoToBr } from "../../format";
import { maskPhone } from "../../validation";
import { PasswordDialog } from "../SettingsScreen";

export default function PortalAccount({ darkMode, onToggleDark }) {
  const theme = useTheme();
  const { user, signOut } = useAuth();
  const [me, setMe] = useState(null);
  const [pwdOpen, setPwdOpen] = useState(false);

  useEffect(() => {
    api("/portal/me").then(setMe).catch(() => {});
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.Content title="Minha conta" />
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ padding: 12 }}>
        <Card>
          <Card.Title title={me?.name ?? user.name} subtitle={user.email} />
          {me && (
            <Card.Content>
              <Text>Telefone: {maskPhone(me.phone)}</Text>
              {me.birth_date && <Text>Nascimento: {isoToBr(me.birth_date)}</Text>}
              {me.health_plan && <Text>Convênio: {me.health_plan}</Text>}
              <Text variant="bodySmall" style={{ marginTop: 6 }}>Para alterar seus dados, fale com a recepção.</Text>
            </Card.Content>
          )}
          <List.Item title="Modo escuro" left={(p) => <List.Icon {...p} icon="theme-light-dark" />}
            right={() => <Switch value={darkMode} onValueChange={onToggleDark} />} />
          <List.Item title="Alterar senha" left={(p) => <List.Icon {...p} icon="lock-reset" />} onPress={() => setPwdOpen(true)} />
          <List.Item title="Sair" left={(p) => <List.Icon {...p} icon="logout" />} onPress={signOut} />
        </Card>
      </ScrollView>
      <Portal>
        <PasswordDialog visible={pwdOpen} onDismiss={() => setPwdOpen(false)} />
      </Portal>
    </View>
  );
}

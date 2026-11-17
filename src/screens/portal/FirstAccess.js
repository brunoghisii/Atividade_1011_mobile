// Primeiro acesso do paciente: obrigatório trocar a senha provisória criada pela recepção.
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Appbar, Button, Text, useTheme } from "react-native-paper";
import { changePassword, loadSession } from "../../api";
import { useAuth } from "../../auth";
import { Field, useSubmit, useUi } from "../../ui";
import { passwordProblems } from "../../validation";

export default function FirstAccess({ onDone }) {
  const theme = useTheme();
  const { signOut } = useAuth();
  const { notify } = useUi();
  const [busy, run] = useSubmit();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [conf, setConf] = useState("");
  const problems = next ? passwordProblems(next) : [];

  async function save() {
    if (!cur || !next || problems.length) return notify("Crie uma senha forte");
    if (next !== conf) return notify("As senhas não conferem");
    await run(async () => {
      await changePassword(cur, next);
      const s = await loadSession();
      notify("Senha criada com sucesso!");
      onDone(s.user);
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.Content title="Primeiro acesso" />
        <Appbar.Action icon="logout" onPress={signOut} />
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Text>Por segurança, troque a senha provisória que a clínica enviou por uma senha só sua.</Text>
        <Field label="Senha provisória" value={cur} onChangeText={setCur} secureTextEntry maxLength={128} disabled={busy} />
        <Field label="Nova senha" value={next} onChangeText={setNext} secureTextEntry maxLength={128} disabled={busy}
          error={problems.length ? `Falta: ${problems.join(", ")}` : ""} />
        <Field label="Confirmar nova senha" value={conf} onChangeText={setConf} secureTextEntry maxLength={128} disabled={busy}
          error={conf && conf !== next ? "Não confere" : ""} />
        <Button mode="contained" style={{ marginTop: 16 }} onPress={save} loading={busy} disabled={busy}>
          Salvar e continuar
        </Button>
      </ScrollView>
    </View>
  );
}

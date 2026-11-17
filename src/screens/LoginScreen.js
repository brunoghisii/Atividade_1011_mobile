import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Button, Text, TextInput, useTheme } from "react-native-paper";
import { login, errorMessage } from "../api";
import { isEmail } from "../validation";
import { Field } from "../ui";

export default function LoginScreen({ onLogged }) {
  const theme = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);

  const emailError = touched && !isEmail(email) ? "Informe um e-mail válido" : "";
  const pwdError = touched && !password ? "Informe a senha" : "";

  async function submit() {
    setTouched(true);
    if (busy || !isEmail(email) || !password) return;
    setBusy(true);
    setError("");
    try {
      const user = await login(email.trim().toLowerCase(), password);
      setPassword("");
      onLogged(user);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.root, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.box}>
        <Text variant="headlineMedium" style={{ textAlign: "center", color: theme.colors.primary }}>
          Consultório
        </Text>
        <Text variant="bodyMedium" style={{ textAlign: "center", marginBottom: 16 }}>
          Acesse com seu usuário da clínica
        </Text>
        <Field
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          maxLength={200}
          disabled={busy}
          error={emailError}
        />
        <Field
          label="Senha"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!show}
          autoComplete="password"
          maxLength={128}
          disabled={busy}
          error={pwdError}
          onSubmitEditing={submit}
          right={<TextInput.Icon icon={show ? "eye-off" : "eye"} onPress={() => setShow(!show)} />}
        />
        {error ? <Text style={{ color: theme.colors.error, marginTop: 8 }}>{error}</Text> : null}
        <Button mode="contained" onPress={submit} loading={busy} disabled={busy} style={{ marginTop: 16 }}>
          Entrar
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center" },
  box: { padding: 24 },
});

import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Appbar, Button, Card, Chip, Dialog, Divider, List, Portal, Switch, Text, useTheme } from "react-native-paper";
import { api, changePassword, errorMessage } from "../api";
import { useAuth } from "../auth";
import { ROLES } from "../format";
import { Field, useSubmit, useUi } from "../ui";
import { isEmail, passwordProblems } from "../validation";

function PasswordDialog({ visible, onDismiss }) {
  const { notify } = useUi();
  const [busy, run] = useSubmit();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [conf, setConf] = useState("");
  const problems = next ? passwordProblems(next) : [];

  async function save() {
    if (!cur || problems.length || !next) return notify("Preencha uma senha forte");
    if (next !== conf) return notify("As senhas não conferem");
    await run(async () => {
      await changePassword(cur, next);
      notify("Senha alterada. Outras sessões foram encerradas.");
      setCur(""); setNext(""); setConf("");
      onDismiss();
    });
  }

  return (
    <Dialog visible={visible} onDismiss={() => !busy && onDismiss()}>
      <Dialog.Title>Alterar senha</Dialog.Title>
      <Dialog.Content>
        <Field label="Senha atual" value={cur} onChangeText={setCur} secureTextEntry disabled={busy} maxLength={128} />
        <Field label="Nova senha" value={next} onChangeText={setNext} secureTextEntry disabled={busy} maxLength={128}
          error={problems.length ? `Falta: ${problems.join(", ")}` : ""} />
        <Field label="Confirmar nova senha" value={conf} onChangeText={setConf} secureTextEntry disabled={busy} maxLength={128}
          error={conf && conf !== next ? "Não confere" : ""} />
      </Dialog.Content>
      <Dialog.Actions>
        <Button disabled={busy} onPress={onDismiss}>Cancelar</Button>
        <Button disabled={busy} loading={busy} onPress={save}>Salvar</Button>
      </Dialog.Actions>
    </Dialog>
  );
}

function UserDialog({ target, onDismiss, onSaved }) {
  const { notify } = useUi();
  const [busy, run] = useSubmit();
  const isNew = !target?.id;
  const [f, setF] = useState({});
  useEffect(() => {
    setF({ name: target?.name ?? "", email: target?.email ?? "", role: target?.role ?? "recepcao", password: "" });
  }, [target]);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const problems = f.password ? passwordProblems(f.password) : [];

  async function save() {
    if ((f.name ?? "").trim().length < 2) return notify("Informe o nome");
    if (isNew && !isEmail(f.email)) return notify("E-mail inválido");
    if ((isNew && !f.password) || problems.length) return notify("Defina uma senha forte");
    await run(async () => {
      const body = { name: f.name.trim(), role: f.role, ...(f.password ? { password: f.password } : {}) };
      if (isNew) await api("/users", { method: "POST", body: { ...body, email: f.email.trim() } });
      else await api(`/users/${target.id}`, { method: "PATCH", body });
      notify("Usuário salvo");
      onSaved();
    });
  }

  return (
    <Dialog visible={!!target} onDismiss={() => !busy && onDismiss()}>
      <Dialog.Title>{isNew ? "Novo usuário" : "Editar usuário"}</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Field label="Nome" value={f.name} onChangeText={set("name")} maxLength={120} disabled={busy} />
          {isNew && <Field label="E-mail" value={f.email} onChangeText={set("email")} autoCapitalize="none" keyboardType="email-address" maxLength={200} disabled={busy} />}
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {Object.entries(ROLES).map(([k, label]) => (
              <Chip key={k} selected={f.role === k} onPress={() => set("role")(k)} disabled={busy}>{label}</Chip>
            ))}
          </View>
          <Field label={isNew ? "Senha inicial" : "Nova senha (opcional)"} value={f.password} onChangeText={set("password")}
            secureTextEntry maxLength={128} disabled={busy} error={problems.length ? `Falta: ${problems.join(", ")}` : ""} />
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        <Button disabled={busy} onPress={onDismiss}>Cancelar</Button>
        <Button disabled={busy} loading={busy} onPress={save}>Salvar</Button>
      </Dialog.Actions>
    </Dialog>
  );
}

export default function SettingsScreen({ darkMode, onToggleDark }) {
  const theme = useTheme();
  const { user, signOut } = useAuth();
  const { notify, ask } = useUi();
  const [busy, run] = useSubmit();
  const [pwdOpen, setPwdOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [editUser, setEditUser] = useState(null);
  const isAdmin = user.role === "admin";

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setUsers(await api("/users"));
    } catch (e) {
      notify(errorMessage(e));
    }
  }, [isAdmin, notify]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function toggleActive(u) {
    const action = u.active ? "Desativar" : "Reativar";
    if (!(await ask(action, `${action} o acesso de ${u.name}?`, action))) return;
    await run(async () => {
      await api(`/users/${u.id}`, { method: "PATCH", body: { active: !u.active } });
      await loadUsers();
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.Content title="Ajustes" />
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 48 }}>
        <Card>
          <Card.Title title={user.name} subtitle={`${user.email} · ${ROLES[user.role]}`} />
          <List.Item title="Modo escuro" left={(p) => <List.Icon {...p} icon="theme-light-dark" />}
            right={() => <Switch value={darkMode} onValueChange={onToggleDark} />} />
          <List.Item title="Alterar senha" left={(p) => <List.Icon {...p} icon="lock-reset" />} onPress={() => setPwdOpen(true)} />
          <List.Item title="Sair" left={(p) => <List.Icon {...p} icon="logout" />} onPress={signOut} />
        </Card>

        {isAdmin && (
          <Card style={{ marginTop: 12 }}>
            <Card.Title title="Equipe" subtitle="Usuários com acesso ao sistema"
              right={() => <Button icon="account-plus" onPress={() => setEditUser({})}>Novo</Button>} />
            <Divider />
            {users.map((u) => (
              <List.Item
                key={u.id}
                title={u.name}
                titleStyle={!u.active && { textDecorationLine: "line-through" }}
                description={`${u.email} · ${ROLES[u.role]}${u.active ? "" : " · inativo"}`}
                onPress={() => setEditUser(u)}
                right={() =>
                  u.id !== user.id ? (
                    <Button compact disabled={busy} onPress={() => toggleActive(u)}>{u.active ? "Desativar" : "Reativar"}</Button>
                  ) : null
                }
              />
            ))}
          </Card>
        )}
        <Text variant="bodySmall" style={{ textAlign: "center", marginTop: 16 }}>
          Dados de pacientes são protegidos pela LGPD. Não compartilhe seu acesso.
        </Text>
      </ScrollView>
      <Portal>
        <PasswordDialog visible={pwdOpen} onDismiss={() => setPwdOpen(false)} />
        <UserDialog target={editUser} onDismiss={() => setEditUser(null)} onSaved={() => (setEditUser(null), loadUsers())} />
      </Portal>
    </View>
  );
}

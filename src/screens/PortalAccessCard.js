// Cartão (recepção/admin) para criar, redefinir ou bloquear o acesso do paciente ao app.
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Text } from "react-native-paper";
import { api, errorMessage } from "../api";
import { Field, useSubmit, useUi } from "../ui";
import { isEmail, passwordProblems } from "../validation";

export default function PortalAccessCard({ patient }) {
  const { notify, ask } = useUi();
  const [busy, run] = useSubmit();
  const [acc, setAcc] = useState(undefined);
  const [form, setForm] = useState(null); // null | "create" | "reset"
  const [email, setEmail] = useState(patient.email ?? "");
  const [pwd, setPwd] = useState("");
  const problems = pwd ? passwordProblems(pwd) : [];

  const load = useCallback(async () => {
    try {
      setAcc(await api(`/patients/${patient.id}/portal-account`));
    } catch (e) {
      notify(errorMessage(e));
    }
  }, [patient.id, notify]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (form === "create" && !isEmail(email)) return notify("E-mail inválido");
    if (!pwd || problems.length) return notify("Senha provisória fraca");
    await run(async () => {
      if (form === "create") {
        await api(`/patients/${patient.id}/portal-account`, { method: "POST", body: { email: email.trim(), password: pwd } });
      } else {
        await api(`/patients/${patient.id}/portal-account`, { method: "PATCH", body: { password: pwd } });
      }
      notify("Pronto! Informe a senha provisória ao paciente pessoalmente.");
      setForm(null);
      setPwd("");
      await load();
    });
  }

  async function toggle() {
    const action = acc.active ? "Bloquear" : "Desbloquear";
    if (!(await ask(action, `${action} o acesso do paciente ao app?`, action))) return;
    await run(async () => {
      await api(`/patients/${patient.id}/portal-account`, { method: "PATCH", body: { active: !acc.active } });
      await load();
    });
  }

  if (acc === undefined) return null;

  return (
    <Card style={{ marginTop: 12 }}>
      <Card.Title title="Acesso do paciente ao app" subtitle={
        acc ? `${acc.email} · ${acc.active ? (acc.must_change_password ? "aguardando 1º acesso" : "ativo") : "bloqueado"}` : "Sem acesso"
      } />
      {form && (
        <Card.Content>
          {form === "create" && (
            <Field label="E-mail de login" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" maxLength={200} disabled={busy} />
          )}
          <Field label="Senha provisória" value={pwd} onChangeText={setPwd} maxLength={128} disabled={busy}
            error={problems.length ? `Falta: ${problems.join(", ")}` : ""} />
          <Text variant="bodySmall">O paciente será obrigado a trocar no primeiro acesso.</Text>
        </Card.Content>
      )}
      <Card.Actions>
        {form ? (
          <>
            <Button disabled={busy} onPress={() => setForm(null)}>Cancelar</Button>
            <Button mode="contained" disabled={busy} loading={busy} onPress={save}>Salvar</Button>
          </>
        ) : acc ? (
          <>
            <Button disabled={busy} onPress={toggle}>{acc.active ? "Bloquear" : "Desbloquear"}</Button>
            <Button disabled={busy} onPress={() => setForm("reset")}>Redefinir senha</Button>
          </>
        ) : (
          <Button mode="contained" icon="cellphone-key" disabled={busy || !patient.active} onPress={() => setForm("create")}>Criar acesso</Button>
        )}
      </Card.Actions>
    </Card>
  );
}

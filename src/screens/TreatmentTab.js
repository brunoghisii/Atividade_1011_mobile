// Aba "Plano" da ficha do paciente: planos de tratamento (fisioterapia) e progresso.
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Button, Card, Chip, ProgressBar, Text } from "react-native-paper";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { Field, useSubmit, useUi } from "../ui";

const STATUS = { ativo: "Em andamento", concluido: "Concluído", suspenso: "Suspenso" };

export default function TreatmentTab({ patientId }) {
  const { user } = useAuth();
  const { notify } = useUi();
  const [busy, run] = useSubmit();
  const [plans, setPlans] = useState([]);
  const [creating, setCreating] = useState(false);
  const [pros, setPros] = useState([]);
  const [f, setF] = useState({ title: "", goals: "", total: "10", professional_id: "" });
  const canEdit = user.role === "profissional" || user.role === "admin";

  const load = useCallback(async () => {
    try {
      setPlans(await api(`/patients/${patientId}/plans`));
    } catch (e) {
      notify(errorMessage(e));
    }
  }, [patientId, notify]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (user.role === "admin") api("/users/professionals").then(setPros).catch(() => {});
  }, [user.role]);

  async function create() {
    const total = Number(f.total);
    if (f.title.trim().length < 3) return notify("Informe o nome do tratamento");
    if (!Number.isInteger(total) || total < 1 || total > 100) return notify("Sessões: entre 1 e 100");
    if (user.role === "admin" && !f.professional_id) return notify("Escolha o profissional responsável");
    await run(async () => {
      await api(`/patients/${patientId}/plans`, {
        method: "POST",
        body: {
          title: f.title.trim(),
          total_sessions: total,
          ...(f.goals.trim() ? { goals: f.goals.trim() } : {}),
          ...(user.role === "admin" ? { professional_id: f.professional_id } : {}),
        },
      });
      setCreating(false);
      setF({ title: "", goals: "", total: "10", professional_id: "" });
      notify("Plano criado. O paciente já vê o progresso no app.");
      await load();
    });
  }

  async function setStatus(p, status) {
    await run(async () => {
      await api(`/patients/${patientId}/plans/${p.id}`, { method: "PATCH", body: { status } });
      await load();
    });
  }

  return (
    <>
      {canEdit && !creating && (
        <Button icon="plus" mode="outlined" onPress={() => setCreating(true)} style={{ marginBottom: 12 }}>
          Novo plano de tratamento
        </Button>
      )}
      {creating && (
        <Card style={{ marginBottom: 12 }}>
          <Card.Content>
            <Field label="Tratamento (ex.: Reabilitação de joelho)" value={f.title} onChangeText={(v) => setF({ ...f, title: v })} maxLength={120} disabled={busy} />
            <Field label="Nº de sessões" value={f.total} onChangeText={(v) => setF({ ...f, total: v.replace(/\D/g, "").slice(0, 3) })} keyboardType="number-pad" disabled={busy} />
            <Field label="Objetivo (visível ao paciente)" value={f.goals} onChangeText={(v) => setF({ ...f, goals: v })} maxLength={1000} multiline disabled={busy} />
            {user.role === "admin" && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {pros.map((p) => (
                  <Chip key={p.id} selected={f.professional_id === p.id} onPress={() => setF({ ...f, professional_id: p.id })}>{p.name}</Chip>
                ))}
              </View>
            )}
          </Card.Content>
          <Card.Actions>
            <Button disabled={busy} onPress={() => setCreating(false)}>Cancelar</Button>
            <Button mode="contained" disabled={busy} loading={busy} onPress={create}>Criar</Button>
          </Card.Actions>
        </Card>
      )}
      {plans.length === 0 && <Text>Nenhum plano de tratamento.</Text>}
      {plans.map((p) => {
        const pct = Math.min(1, p.done_sessions / p.total_sessions);
        const mine = user.role === "admin" || p.professional_id === user.id;
        return (
          <Card key={p.id} style={{ marginBottom: 10 }}>
            <Card.Title title={p.title} subtitle={`${p.professional_name} · ${STATUS[p.status]}`} />
            <Card.Content>
              <ProgressBar progress={pct} style={{ height: 8, borderRadius: 4 }} />
              <Text style={{ marginTop: 6 }}>
                {p.done_sessions}/{p.total_sessions} sessões concluídas · {p.scheduled_sessions} agendada(s)
              </Text>
              {p.goals ? <Text variant="bodySmall">Objetivo: {p.goals}</Text> : null}
            </Card.Content>
            {canEdit && mine && (
              <Card.Actions>
                {p.status !== "ativo" && <Button disabled={busy} onPress={() => setStatus(p, "ativo")}>Reabrir</Button>}
                {p.status === "ativo" && <Button disabled={busy} onPress={() => setStatus(p, "suspenso")}>Suspender</Button>}
                {p.status === "ativo" && <Button disabled={busy} onPress={() => setStatus(p, "concluido")}>Dar alta</Button>}
              </Card.Actions>
            )}
          </Card>
        );
      })}
    </>
  );
}

import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { Appbar, Button, Card, Chip, ProgressBar, Text, useTheme } from "react-native-paper";
import { api, errorMessage } from "../../api";
import { useAuth } from "../../auth";
import { dateLabel, minToTime, STATUS, todayIso } from "../../format";
import { useSubmit, useUi } from "../../ui";

const PLAN_STATUS = { ativo: "Em andamento", concluido: "Concluído", suspenso: "Suspenso" };

export function upcoming(list) {
  const today = todayIso();
  return list
    .filter((a) => a.date >= today && ["agendado", "confirmado"].includes(a.status))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_min - b.start_min);
}

export default function PortalHome({ onBook }) {
  const theme = useTheme();
  const { user } = useAuth();
  const { notify, ask } = useUi();
  const [busy, run] = useSubmit();
  const [plans, setPlans] = useState([]);
  const [appts, setAppts] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, a] = await Promise.all([api("/portal/plans"), api("/portal/appointments")]);
      setPlans(p);
      setAppts(a);
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  async function act(a, action) {
    if (action === "cancel" && !(await ask("Cancelar consulta", `Cancelar ${dateLabel(a.date)} às ${minToTime(a.start_min)}?`, "Cancelar consulta"))) return;
    await run(async () => {
      await api(`/portal/appointments/${a.id}/${action}`, { method: "POST" });
      notify(action === "cancel" ? "Consulta cancelada" : "Presença confirmada. Até lá!");
      await load();
    });
  }

  const next = upcoming(appts);
  const lastGuidance = appts.find((a) => a.status === "concluido" && a.patient_guidance);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.Content title={`Olá, ${user.name?.split(" ")[0] ?? ""}`} />
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <Text variant="titleMedium" style={{ marginBottom: 8 }}>Meu tratamento</Text>
        {plans.length === 0 && !loading && <Text style={{ marginBottom: 12 }}>Nenhum tratamento cadastrado ainda.</Text>}
        {plans.map((p) => {
          const pct = Math.min(1, p.done_sessions / p.total_sessions);
          return (
            <Card key={p.id} style={{ marginBottom: 10 }}>
              <Card.Title title={p.title} subtitle={`${p.professional_name} · ${PLAN_STATUS[p.status]}`} />
              <Card.Content>
                <ProgressBar progress={pct} style={{ height: 10, borderRadius: 5 }} />
                <Text style={{ marginTop: 6 }}>
                  {p.done_sessions} de {p.total_sessions} sessões realizadas ({Math.round(pct * 100)}%)
                  {p.scheduled_sessions > 0 ? ` · ${p.scheduled_sessions} agendada(s)` : ""}
                </Text>
                {p.goals ? <Text variant="bodySmall" style={{ marginTop: 4 }}>Objetivo: {p.goals}</Text> : null}
              </Card.Content>
            </Card>
          );
        })}

        {lastGuidance && (
          <Card style={{ marginBottom: 10, backgroundColor: theme.colors.secondaryContainer }}>
            <Card.Title title="Última orientação" subtitle={`${dateLabel(lastGuidance.date)} · ${lastGuidance.professional_name}`} />
            <Card.Content><Text>{lastGuidance.patient_guidance}</Text></Card.Content>
          </Card>
        )}

        <Text variant="titleMedium" style={{ marginVertical: 8 }}>Próximas consultas</Text>
        {next.length === 0 && <Text>Nenhuma consulta marcada.</Text>}
        {next.map((a) => (
          <Card key={a.id} style={{ marginBottom: 10 }}>
            <Card.Title
              title={`${dateLabel(a.date)} · ${minToTime(a.start_min)}`}
              subtitle={`${a.professional_name}${a.plan_title ? " · " + a.plan_title : ""}`}
              right={() => <Chip compact icon={STATUS[a.status].icon} style={{ marginRight: 8 }}>{STATUS[a.status].label}</Chip>}
            />
            <Card.Actions>
              {a.status === "agendado" && <Button disabled={busy} onPress={() => act(a, "confirm")}>Confirmar presença</Button>}
              <Button disabled={busy} onPress={() => act(a, "cancel")}>Cancelar</Button>
            </Card.Actions>
          </Card>
        ))}
        <Button mode="contained" icon="calendar-plus" style={{ marginTop: 12 }} onPress={onBook}>
          Agendar sessão
        </Button>
      </ScrollView>
    </View>
  );
}

import { useCallback, useEffect, useState } from "react";
import { FlatList, Linking, RefreshControl, StyleSheet, View } from "react-native";
import { Appbar, Button, Card, Chip, Dialog, FAB, Menu, Portal, Text, useTheme } from "react-native-paper";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { addDays, dateLabel, minToTime, money, PAYMENT, STATUS, todayIso } from "../format";
import { useSubmit, useUi } from "../ui";
import AppointmentForm from "./AppointmentForm";
import PatientDetail from "./PatientDetail";

// Ações disponíveis por status e papel (espelha as regras do backend)
function actionsFor(a, role) {
  const desk = role === "admin" || role === "recepcao";
  const prof = role === "profissional" || role === "admin";
  const list = [];
  if (desk && a.status === "agendado") list.push(["confirmado", "Confirmar presença"]);
  if (prof && ["agendado", "confirmado"].includes(a.status)) list.push(["em_atendimento", "Iniciar atendimento"]);
  if (prof && a.status === "em_atendimento") list.push(["concluido", "Finalizar atendimento"]);
  if (desk && ["agendado", "confirmado"].includes(a.status)) {
    list.push(["faltou", "Marcar falta"], ["cancelado", "Cancelar"]);
  }
  if (desk && ["faltou", "cancelado"].includes(a.status)) list.push(["agendado", "Reativar"]);
  return list;
}

export default function AgendaScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { notify, ask } = useUi();
  const [busy, run] = useSubmit();
  const [date, setDate] = useState(todayIso());
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const [form, setForm] = useState(null); // null | {} (novo) | appointment (editar)
  const [payFor, setPayFor] = useState(null);
  const [patientId, setPatientId] = useState(null);
  const desk = user.role !== "profissional";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        api(`/appointments?date=${date}`),
        api(`/appointments/summary/day?date=${date}`),
      ]);
      setItems(list);
      setSummary(sum);
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [date, notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(a, status) {
    setMenuFor(null);
    if (["cancelado", "faltou"].includes(status)) {
      const ok = await ask("Confirmar", `${STATUS[status].label}: ${a.patient_name} às ${minToTime(a.start_min)}?`);
      if (!ok) return;
    }
    await run(async () => {
      await api(`/appointments/${a.id}/status`, { method: "PATCH", body: { status } });
      notify(`Status alterado para "${STATUS[status].label}"`);
      await load();
    });
  }

  async function pay(method) {
    const a = payFor;
    await run(async () => {
      await api(`/appointments/${a.id}/payment`, {
        method: "PATCH",
        body: method ? { paid: true, payment_method: method } : { paid: false },
      });
      setPayFor(null);
      notify(method ? "Pagamento registrado" : "Pagamento estornado");
      await load();
    });
  }

  if (patientId) return <PatientDetail id={patientId} onBack={() => (setPatientId(null), load())} />;
  if (form) {
    return (
      <AppointmentForm
        initial={form}
        date={date}
        onClose={(saved) => {
          setForm(null);
          if (saved) {
            setDate(saved.date);
            load();
          }
        }}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.Action icon="chevron-left" onPress={() => setDate(addDays(date, -1))} />
        <Appbar.Content title={dateLabel(date)} titleStyle={{ textAlign: "center" }} />
        <Appbar.Action icon="calendar-today" onPress={() => setDate(todayIso())} />
        <Appbar.Action icon="chevron-right" onPress={() => setDate(addDays(date, 1))} />
      </Appbar.Header>

      {summary && (
        <View style={styles.summary}>
          <Chip compact icon="calendar">{summary.total} total</Chip>
          <Chip compact icon="clock-outline">{summary.pending} a atender</Chip>
          <Chip compact icon="check-all">{summary.done} concluídas</Chip>
          {summary.no_show > 0 && <Chip compact icon="account-off">{summary.no_show} faltas</Chip>}
          {summary.received_cents !== undefined && (
            <Chip compact icon="cash">Recebido {money(summary.received_cents)}</Chip>
          )}
          {summary.receivable_cents > 0 && (
            <Chip compact icon="cash-clock">A receber {money(summary.receivable_cents)}</Chip>
          )}
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={
          !loading && <Text style={{ textAlign: "center", marginTop: 32 }}>Nenhuma consulta neste dia.</Text>
        }
        renderItem={({ item: a }) => {
          const st = STATUS[a.status];
          const actions = actionsFor(a, user.role);
          return (
            <Card style={[styles.card, { borderLeftColor: st.color }]} onPress={() => setPatientId(a.patient_id)}>
              <Card.Title
                title={`${minToTime(a.start_min)} · ${a.patient_name}`}
                subtitle={`${a.professional_name} · ${a.duration_min} min${a.reason ? " · " + a.reason : ""}`}
                right={() => (
                  <Menu
                    visible={menuFor === a.id}
                    onDismiss={() => setMenuFor(null)}
                    anchor={
                      <Button compact disabled={busy} onPress={() => setMenuFor(a.id)}>
                        Ações
                      </Button>
                    }
                  >
                    {actions.map(([s, label]) => (
                      <Menu.Item key={s} title={label} leadingIcon={STATUS[s].icon} onPress={() => changeStatus(a, s)} />
                    ))}
                    {desk && !["concluido", "cancelado", "faltou"].includes(a.status) && (
                      <Menu.Item title="Remarcar / editar" leadingIcon="pencil" onPress={() => (setMenuFor(null), setForm(a))} />
                    )}
                    {desk && a.status !== "cancelado" && (
                      <Menu.Item title="Pagamento" leadingIcon="cash" onPress={() => (setMenuFor(null), setPayFor(a))} />
                    )}
                    {desk && (
                      <Menu.Item
                        title="Ligar / WhatsApp"
                        leadingIcon="phone"
                        onPress={() => {
                          setMenuFor(null);
                          // número vem do banco, apenas dígitos — sem URL arbitrária
                          Linking.openURL(`https://wa.me/55${String(a.patient_phone).replace(/\D/g, "")}`);
                        }}
                      />
                    )}
                  </Menu>
                )}
              />
              <Card.Content style={styles.row}>
                <Chip compact icon={st.icon} textStyle={{ color: st.color }}>
                  {st.label}
                </Chip>
                {desk && a.price_cents > 0 && (
                  <Chip compact icon={a.paid ? "check-circle" : "cash-clock"}>
                    {money(a.price_cents)} {a.paid ? `· ${PAYMENT[a.payment_method] ?? "pago"}` : "· pendente"}
                  </Chip>
                )}
              </Card.Content>
            </Card>
          );
        }}
      />

      {desk && <FAB icon="plus" label="Agendar" style={styles.fab} onPress={() => setForm({})} />}

      <Portal>
        <Dialog visible={!!payFor} onDismiss={() => !busy && setPayFor(null)}>
          <Dialog.Title>Pagamento · {payFor && money(payFor.price_cents)}</Dialog.Title>
          <Dialog.Content style={styles.row}>
            {Object.entries(PAYMENT).map(([k, label]) => (
              <Chip key={k} disabled={busy} onPress={() => pay(k)} selected={payFor?.payment_method === k}>
                {label}
              </Chip>
            ))}
          </Dialog.Content>
          <Dialog.Actions>
            {payFor?.paid ? (
              <Button disabled={busy} onPress={() => pay(null)}>
                Estornar
              </Button>
            ) : null}
            <Button disabled={busy} onPress={() => setPayFor(null)}>
              Fechar
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 12, paddingTop: 8 },
  card: { marginBottom: 10, borderLeftWidth: 5 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  fab: { position: "absolute", right: 16, bottom: 16 },
});

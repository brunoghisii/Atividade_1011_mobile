import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { ActivityIndicator, Appbar, Button, Chip, Text, useTheme } from "react-native-paper";
import { api, errorMessage } from "../../api";
import { addDays, dateLabel, todayIso } from "../../format";
import { Field, useSubmit, useUi } from "../../ui";

// Próximos 20 dias úteis
function nextWorkDays(n = 20) {
  const out = [];
  let d = todayIso();
  while (out.length < n) {
    const [y, m, day] = d.split("-").map(Number);
    const wd = new Date(y, m - 1, day).getDay();
    if (wd !== 0 && wd !== 6) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export default function PortalBook({ onDone }) {
  const theme = useTheme();
  const { notify, ask } = useUi();
  const [busy, run] = useSubmit();
  const days = useMemo(() => nextWorkDays(), []);
  const [pros, setPros] = useState([]);
  const [pro, setPro] = useState(null);
  const [day, setDay] = useState(days[0]);
  const [slots, setSlots] = useState([]);
  const [slot, setSlot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    api("/portal/professionals")
      .then((l) => {
        setPros(l);
        if (l.length === 1) setPro(l[0]);
      })
      .catch((e) => notify(errorMessage(e)));
  }, [notify]);

  useEffect(() => {
    setSlot(null);
    if (!pro) return setSlots([]);
    let alive = true;
    setLoading(true);
    api(`/portal/availability?professionalId=${pro.id}&date=${day}`)
      .then((r) => alive && setSlots(r.slots))
      .catch((e) => notify(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [pro, day, notify]);

  async function book() {
    if (!pro || !slot) return notify("Escolha profissional, dia e horário");
    if (!(await ask("Confirmar agendamento", `${dateLabel(day)} às ${slot} com ${pro.name}?`, "Agendar"))) return;
    await run(async () => {
      await api("/portal/appointments", {
        method: "POST",
        body: { professional_id: pro.id, date: day, start: slot, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      });
      notify("Sessão agendada!");
      setReason("");
      onDone();
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.Content title="Agendar sessão" />
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <Text variant="titleSmall">1. Profissional</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 8 }}>
          {pros.map((p) => (
            <Chip key={p.id} icon="account" selected={pro?.id === p.id} onPress={() => setPro(p)} disabled={busy}>{p.name}</Chip>
          ))}
          {pros.length === 0 && <Text>Nenhum profissional disponível.</Text>}
        </View>

        <Text variant="titleSmall">2. Dia</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
          {days.map((d) => (
            <Chip key={d} selected={day === d} onPress={() => setDay(d)} style={{ marginRight: 6 }} disabled={busy}>
              {dateLabel(d).replace(/\/\d{4}$/, "")}
            </Chip>
          ))}
        </ScrollView>

        <Text variant="titleSmall">3. Horário (sessões de 1h)</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 8 }}>
          {loading ? <ActivityIndicator /> : null}
          {!loading && pro && slots.length === 0 && <Text>Sem horários livres neste dia. Tente outro.</Text>}
          {!pro && <Text>Escolha um profissional.</Text>}
          {!loading && slots.map((s) => (
            <Chip key={s} selected={slot === s} onPress={() => setSlot(s)} disabled={busy}>{s}</Chip>
          ))}
        </View>

        <Field label="Observação (opcional)" value={reason} onChangeText={setReason} maxLength={250} disabled={busy} />
        <Button mode="contained" style={{ marginTop: 16 }} onPress={book} loading={busy} disabled={busy || !slot}>
          Agendar
        </Button>
        <Text variant="bodySmall" style={{ marginTop: 12 }}>
          Agendamento com no mínimo 2h de antecedência. Cancelamentos pelo app até 12h antes; depois disso, ligue para a clínica.
        </Text>
      </ScrollView>
    </View>
  );
}

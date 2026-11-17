import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Appbar, Button, Chip, List, Text, useTheme } from "react-native-paper";
import { api } from "../api";
import { brToIso, isoToBr, minToTime } from "../format";
import { Field, useSubmit, useUi } from "../ui";
import { isDate, isTime, maskDateBr, maskMoney, maskTime, moneyToCents } from "../validation";

const DURATIONS = [15, 20, 30, 40, 50, 60, 90];

export default function AppointmentForm({ initial, date, onClose }) {
  const theme = useTheme();
  const { notify } = useUi();
  const [busy, run] = useSubmit();
  const editing = !!initial.id;

  const [professionals, setProfessionals] = useState([]);
  const [patient, setPatient] = useState(
    initial.patient_id ? { id: initial.patient_id, name: initial.patient_name } : null
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [f, setF] = useState({
    professional_id: initial.professional_id ?? "",
    date: isoToBr(initial.date ?? date),
    start: initial.start_min != null ? minToTime(initial.start_min) : "",
    duration_min: initial.duration_min ?? 30,
    reason: initial.reason ?? "",
    price: maskMoney(String(initial.price_cents ?? 0)),
  });
  const [errors, setErrors] = useState({});
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    api("/users/professionals")
      .then((list) => {
        setProfessionals(list);
        if (!initial.professional_id && list.length === 1) setF((s) => ({ ...s, professional_id: list[0].id }));
      })
      .catch(() => notify("Não foi possível carregar os profissionais"));
  }, []);

  // Busca de paciente com debounce
  useEffect(() => {
    if (patient || query.trim().length < 2) return setResults([]);
    const t = setTimeout(() => {
      api(`/patients?q=${encodeURIComponent(query.trim())}`).then(setResults).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [query, patient]);

  function validateForm() {
    const e = {};
    if (!patient) e.patient = "Selecione o paciente";
    if (!f.professional_id) e.professional = "Selecione o profissional";
    if (!isDate(brToIso(f.date))) e.date = "Data inválida (DD/MM/AAAA)";
    if (!isTime(f.start)) e.start = "Hora inválida (HH:MM)";
    else {
      const [h, m] = f.start.split(":").map(Number);
      const s = h * 60 + m;
      if (s < 360 || s + f.duration_min > 1320) e.start = "Fora do expediente (06:00–22:00)";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validateForm()) return;
    await run(async () => {
      const body = {
        professional_id: f.professional_id,
        date: brToIso(f.date),
        start: f.start,
        duration_min: f.duration_min,
        reason: f.reason.trim() || undefined,
        price_cents: moneyToCents(f.price),
      };
      const saved = editing
        ? await api(`/appointments/${initial.id}`, { method: "PATCH", body })
        : await api("/appointments", { method: "POST", body: { ...body, patient_id: patient.id } });
      notify(editing ? "Agendamento atualizado" : "Consulta agendada");
      onClose(saved);
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.BackAction disabled={busy} onPress={() => onClose(null)} />
        <Appbar.Content title={editing ? "Remarcar consulta" : "Nova consulta"} />
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Text variant="titleSmall">Paciente</Text>
        {patient ? (
          <Chip icon="account" onClose={editing || busy ? undefined : () => setPatient(null)} style={{ alignSelf: "flex-start", marginTop: 6 }}>
            {patient.name}
          </Chip>
        ) : (
          <>
            <Field label="Buscar por nome, CPF ou telefone" value={query} onChangeText={setQuery} maxLength={80} error={errors.patient} />
            {results.map((p) => (
              <List.Item key={p.id} title={p.name} description={p.phone} left={(pr) => <List.Icon {...pr} icon="account" />}
                onPress={() => (setPatient(p), setQuery(""))} />
            ))}
            {query.trim().length >= 2 && results.length === 0 && (
              <Text style={{ marginTop: 6 }}>Nenhum paciente encontrado. Cadastre na aba Pacientes.</Text>
            )}
          </>
        )}

        <Text variant="titleSmall" style={{ marginTop: 16 }}>Profissional</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {professionals.map((p) => (
            <Chip key={p.id} selected={f.professional_id === p.id} onPress={() => set("professional_id")(p.id)} disabled={busy}>
              {p.name}
            </Chip>
          ))}
          {professionals.length === 0 && <Text>Nenhum profissional ativo cadastrado.</Text>}
        </View>
        {errors.professional ? <Text style={{ color: theme.colors.error }}>{errors.professional}</Text> : null}

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="Data" value={f.date} onChangeText={(v) => set("date")(maskDateBr(v))} keyboardType="number-pad" error={errors.date} disabled={busy} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Hora" value={f.start} onChangeText={(v) => set("start")(maskTime(v))} keyboardType="number-pad" placeholder="09:30" error={errors.start} disabled={busy} />
          </View>
        </View>

        <Text variant="titleSmall" style={{ marginTop: 16 }}>Duração</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {DURATIONS.map((d) => (
            <Chip key={d} selected={f.duration_min === d} onPress={() => set("duration_min")(d)} disabled={busy}>
              {d} min
            </Chip>
          ))}
        </View>

        <Field label="Motivo / procedimento" value={f.reason} onChangeText={set("reason")} maxLength={250} disabled={busy} />
        <Field label="Valor (R$)" value={f.price} onChangeText={(v) => set("price")(maskMoney(v))} keyboardType="number-pad" disabled={busy} />

        <Button mode="contained" style={{ marginTop: 24 }} onPress={save} loading={busy} disabled={busy}>
          {editing ? "Salvar alterações" : "Agendar"}
        </Button>
      </ScrollView>
    </View>
  );
}

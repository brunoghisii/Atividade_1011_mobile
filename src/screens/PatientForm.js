import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Appbar, Button, useTheme } from "react-native-paper";
import { api } from "../api";
import { brToIso, isoToBr, todayIso } from "../format";
import { Field, useSubmit, useUi } from "../ui";
import { isDate, isEmail, isPhone, isValidCpf, maskCpf, maskDateBr, maskPhone } from "../validation";

export default function PatientForm({ initial = {}, onClose }) {
  const theme = useTheme();
  const { notify } = useUi();
  const [busy, run] = useSubmit();
  const editing = !!initial.id;
  const [f, setF] = useState({
    name: initial.name ?? "",
    cpf: maskCpf(initial.cpf ?? ""),
    birth_date: isoToBr(initial.birth_date),
    phone: maskPhone(initial.phone ?? ""),
    email: initial.email ?? "",
    health_plan: initial.health_plan ?? "",
    address: initial.address ?? "",
    notes: initial.notes ?? "",
  });
  const [errors, setErrors] = useState({});
  const set = (k, mask) => (v) => setF((s) => ({ ...s, [k]: mask ? mask(v) : v }));

  function validateForm() {
    const e = {};
    if (f.name.trim().length < 3) e.name = "Informe o nome completo";
    if (f.cpf && !isValidCpf(f.cpf)) e.cpf = "CPF inválido";
    if (f.birth_date) {
      const iso = brToIso(f.birth_date);
      if (!isDate(iso)) e.birth_date = "Data inválida (DD/MM/AAAA)";
      else if (iso > todayIso()) e.birth_date = "Data no futuro";
    }
    if (!isPhone(f.phone)) e.phone = "Telefone com DDD";
    if (f.email && !isEmail(f.email)) e.email = "E-mail inválido";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validateForm()) return;
    await run(async () => {
      const body = {
        name: f.name.trim(),
        cpf: f.cpf,
        birth_date: brToIso(f.birth_date),
        phone: f.phone,
        email: f.email.trim(),
        health_plan: f.health_plan.trim(),
        address: f.address.trim(),
        notes: f.notes.trim(),
      };
      const saved = editing
        ? await api(`/patients/${initial.id}`, { method: "PATCH", body })
        : await api("/patients", { method: "POST", body });
      notify(editing ? "Cadastro atualizado" : "Paciente cadastrado");
      onClose(saved);
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.BackAction disabled={busy} onPress={() => onClose(null)} />
        <Appbar.Content title={editing ? "Editar paciente" : "Novo paciente"} />
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Field label="Nome completo *" value={f.name} onChangeText={set("name")} maxLength={120} error={errors.name} disabled={busy} />
        <Field label="Telefone / WhatsApp *" value={f.phone} onChangeText={set("phone", maskPhone)} keyboardType="phone-pad" error={errors.phone} disabled={busy} />
        <Field label="CPF" value={f.cpf} onChangeText={set("cpf", maskCpf)} keyboardType="number-pad" error={errors.cpf} disabled={busy} />
        <Field label="Data de nascimento" value={f.birth_date} onChangeText={set("birth_date", maskDateBr)} keyboardType="number-pad" placeholder="DD/MM/AAAA" error={errors.birth_date} disabled={busy} />
        <Field label="E-mail" value={f.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" maxLength={200} error={errors.email} disabled={busy} />
        <Field label="Convênio" value={f.health_plan} onChangeText={set("health_plan")} maxLength={80} disabled={busy} />
        <Field label="Endereço" value={f.address} onChangeText={set("address")} maxLength={250} disabled={busy} />
        <Field label="Observações (alergias, preferências...)" value={f.notes} onChangeText={set("notes")} maxLength={1000} multiline disabled={busy} />
        <Button mode="contained" style={{ marginTop: 24 }} onPress={save} loading={busy} disabled={busy}>
          Salvar
        </Button>
      </ScrollView>
    </View>
  );
}

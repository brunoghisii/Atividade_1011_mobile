import { useCallback, useEffect, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Appbar, Button, Card, Divider, IconButton, List, SegmentedButtons, Text, useTheme } from "react-native-paper";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { age, dateLabel, isoToBr, minToTime, money, STATUS, todayIso } from "../format";
import { Field, useSubmit, useUi } from "../ui";
import { maskCpf, maskPhone } from "../validation";
import PatientForm from "./PatientForm";

const MAX_UPLOAD = 5 * 1024 * 1024;
const ALLOWED = ["application/pdf", "image/png", "image/jpeg"];

export default function PatientDetail({ id, onBack }) {
  const theme = useTheme();
  const { user } = useAuth();
  const { notify, ask } = useUi();
  const [busy, run] = useSubmit();
  const [tab, setTab] = useState("dados");
  const [patient, setPatient] = useState(null);
  const [history, setHistory] = useState([]);
  const [records, setRecords] = useState([]);
  const [files, setFiles] = useState([]);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);

  const desk = user.role !== "profissional";
  const clinical = user.role !== "recepcao"; // recepção não acessa prontuário

  const load = useCallback(async () => {
    try {
      setPatient(await api(`/patients/${id}`));
      setHistory(await api(`/patients/${id}/appointments`));
    } catch (e) {
      notify(errorMessage(e));
    }
  }, [id, notify]);

  const loadTab = useCallback(async () => {
    try {
      if (tab === "prontuario") setRecords(await api(`/patients/${id}/records`));
      if (tab === "anexos") setFiles(await api(`/patients/${id}/attachments`));
    } catch (e) {
      notify(errorMessage(e));
    }
  }, [tab, id, notify]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTab(); }, [loadTab]);

  async function addRecord() {
    if (note.trim().length < 3) return notify("Escreva a evolução do atendimento");
    const today = todayIso();
    const appt = history.find((h) => h.date === today && ["em_atendimento", "concluido"].includes(h.status));
    await run(async () => {
      await api(`/patients/${id}/records`, {
        method: "POST",
        body: { content: note.trim(), ...(appt ? { appointment_id: appt.id } : {}) },
      });
      setNote("");
      notify("Evolução registrada");
      await loadTab();
    });
  }

  async function upload() {
    const res = await DocumentPicker.getDocumentAsync({ type: ALLOWED, copyToCacheDirectory: true, multiple: false });
    if (res.canceled) return;
    const file = res.assets[0];
    // Validação no app (o servidor revalida pelo conteúdo real do arquivo)
    if (file.size > MAX_UPLOAD) return notify("Arquivo maior que 5 MB");
    if (file.mimeType && !ALLOWED.includes(file.mimeType)) return notify("Envie apenas PDF, PNG ou JPEG");
    await run(async () => {
      const form = new FormData();
      form.append("file", { uri: file.uri, name: file.name, type: file.mimeType || "application/octet-stream" });
      await api(`/patients/${id}/attachments`, { method: "POST", body: form, isForm: true });
      notify("Arquivo enviado");
      await loadTab();
    });
  }

  async function removeFile(f) {
    if (!(await ask("Excluir anexo", `Excluir "${f.original_name}"?`, "Excluir"))) return;
    await run(async () => {
      await api(`/patients/${id}/attachments/${f.id}`, { method: "DELETE" });
      await loadTab();
    });
  }

  if (editing) {
    return <PatientForm initial={patient} onClose={(saved) => (setEditing(false), saved && setPatient(saved))} />;
  }

  const tabs = [
    { value: "dados", label: "Dados" },
    { value: "consultas", label: "Consultas" },
    ...(clinical ? [{ value: "prontuario", label: "Prontuário" }] : []),
    { value: "anexos", label: "Anexos" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.BackAction onPress={onBack} />
        <Appbar.Content title={patient?.name ?? "Paciente"} />
        {desk && patient && <Appbar.Action icon="pencil" onPress={() => setEditing(true)} />}
      </Appbar.Header>
      <SegmentedButtons value={tab} onValueChange={setTab} buttons={tabs} style={{ margin: 12 }} density="small" />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {tab === "dados" && patient && (
          <Card>
            <Card.Content>
              <List.Item title="Telefone" description={maskPhone(patient.phone)} left={(p) => <List.Icon {...p} icon="phone" />}
                right={() => <IconButton icon="whatsapp" onPress={() => Linking.openURL(`https://wa.me/55${patient.phone}`)} />} />
              {patient.cpf && <List.Item title="CPF" description={maskCpf(patient.cpf)} left={(p) => <List.Icon {...p} icon="card-account-details" />} />}
              {patient.birth_date && <List.Item title="Nascimento" description={`${isoToBr(patient.birth_date)} (${age(patient.birth_date)} anos)`} left={(p) => <List.Icon {...p} icon="cake-variant" />} />}
              {patient.email && <List.Item title="E-mail" description={patient.email} left={(p) => <List.Icon {...p} icon="email" />} />}
              {patient.health_plan && <List.Item title="Convênio" description={patient.health_plan} left={(p) => <List.Icon {...p} icon="medical-bag" />} />}
              {patient.address && <List.Item title="Endereço" description={patient.address} left={(p) => <List.Icon {...p} icon="map-marker" />} />}
              {patient.notes && <List.Item title="Observações" description={patient.notes} descriptionNumberOfLines={10} left={(p) => <List.Icon {...p} icon="alert-circle-outline" />} />}
            </Card.Content>
          </Card>
        )}

        {tab === "consultas" &&
          (history.length === 0 ? (
            <Text>Nenhuma consulta registrada.</Text>
          ) : (
            history.map((h) => (
              <List.Item
                key={h.id}
                title={`${dateLabel(h.date)} · ${minToTime(h.start_min)}`}
                description={`${h.professional_name} · ${STATUS[h.status].label}${desk && h.price_cents ? ` · ${money(h.price_cents)} ${h.paid ? "pago" : "pendente"}` : ""}`}
                left={(p) => <List.Icon {...p} icon={STATUS[h.status].icon} color={STATUS[h.status].color} />}
              />
            ))
          ))}

        {tab === "prontuario" && (
          <>
            {user.role === "profissional" && (
              <Card style={{ marginBottom: 12 }}>
                <Card.Content>
                  <Field label="Nova evolução" value={note} onChangeText={setNote} multiline numberOfLines={5} maxLength={10000} disabled={busy} />
                  <Button mode="contained" style={{ marginTop: 8 }} onPress={addRecord} loading={busy} disabled={busy}>
                    Registrar
                  </Button>
                  <Text variant="bodySmall" style={{ marginTop: 6 }}>
                    Registros de prontuário não podem ser editados ou excluídos.
                  </Text>
                </Card.Content>
              </Card>
            )}
            {records.length === 0 && <Text>Nenhum registro no prontuário.</Text>}
            {records.map((r) => (
              <Card key={r.id} style={{ marginBottom: 8 }}>
                <Card.Title title={r.professional_name} subtitle={new Date(r.created_at + "Z").toLocaleString("pt-BR")} />
                <Card.Content>
                  <Text selectable>{r.content}</Text>
                </Card.Content>
              </Card>
            ))}
          </>
        )}

        {tab === "anexos" && (
          <>
            <Button icon="upload" mode="outlined" onPress={upload} loading={busy} disabled={busy}>
              Enviar documento (PDF, PNG, JPEG · até 5 MB)
            </Button>
            <Divider style={{ marginVertical: 8 }} />
            {files.length === 0 && <Text>Nenhum anexo.</Text>}
            {files.map((f) => (
              <List.Item
                key={f.id}
                title={f.original_name}
                description={`${(f.size / 1024).toFixed(0)} KB · ${new Date(f.created_at + "Z").toLocaleDateString("pt-BR")}`}
                left={(p) => <List.Icon {...p} icon={f.mime === "application/pdf" ? "file-pdf-box" : "file-image"} />}
                right={() => (desk ? <IconButton icon="delete" disabled={busy} onPress={() => removeFile(f)} /> : null)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { Appbar, FAB, List, Searchbar, Text, useTheme } from "react-native-paper";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { age } from "../format";
import { useUi } from "../ui";
import { maskPhone } from "../validation";
import PatientDetail from "./PatientDetail";
import PatientForm from "./PatientForm";

export default function PatientsScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { notify } = useUi();
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api(`/patients?q=${encodeURIComponent(q.trim())}`));
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [q, notify]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  if (openId) return <PatientDetail id={openId} onBack={() => (setOpenId(null), load())} />;
  if (creating) {
    return (
      <PatientForm
        onClose={(saved) => {
          setCreating(false);
          if (saved) setOpenId(saved.id);
        }}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.Content title="Pacientes" />
      </Appbar.Header>
      <Searchbar placeholder="Nome, CPF ou telefone" value={q} onChangeText={setQ} maxLength={80} style={{ margin: 12 }} />
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ paddingBottom: 96 }}
        ListEmptyComponent={!loading && <Text style={{ textAlign: "center", marginTop: 32 }}>Nenhum paciente.</Text>}
        renderItem={({ item: p }) => (
          <List.Item
            title={p.name}
            description={[maskPhone(p.phone), p.birth_date && `${age(p.birth_date)} anos`, p.health_plan]
              .filter(Boolean)
              .join(" · ")}
            left={(pr) => <List.Icon {...pr} icon="account" />}
            right={(pr) => <List.Icon {...pr} icon="chevron-right" />}
            onPress={() => setOpenId(p.id)}
          />
        )}
      />
      {user.role !== "profissional" && (
        <FAB icon="account-plus" label="Novo" style={{ position: "absolute", right: 16, bottom: 16 }} onPress={() => setCreating(true)} />
      )}
    </View>
  );
}

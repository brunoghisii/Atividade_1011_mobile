import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { Appbar, Card, Chip, Text, useTheme } from "react-native-paper";
import { api, errorMessage } from "../../api";
import { dateLabel, minToTime, STATUS } from "../../format";
import { useUi } from "../../ui";

export default function PortalHistory() {
  const theme = useTheme();
  const { notify } = useUi();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api("/portal/appointments"));
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.Content title="Minhas sessões" />
      </Appbar.Header>
      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading && <Text style={{ textAlign: "center", marginTop: 32 }}>Nenhuma sessão ainda.</Text>}
        renderItem={({ item: a }) => (
          <Card style={{ marginBottom: 10 }}>
            <Card.Title
              title={`${dateLabel(a.date)} · ${minToTime(a.start_min)}`}
              subtitle={`${a.professional_name}${a.plan_title ? " · " + a.plan_title : ""}`}
              right={() => (
                <Chip compact icon={STATUS[a.status].icon} textStyle={{ color: STATUS[a.status].color }} style={{ marginRight: 8 }}>
                  {STATUS[a.status].label}
                </Chip>
              )}
            />
            {a.patient_guidance ? (
              <Card.Content>
                <Text variant="labelLarge">Orientações do profissional</Text>
                <Text selectable>{a.patient_guidance}</Text>
              </Card.Content>
            ) : null}
          </Card>
        )}
      />
    </View>
  );
}

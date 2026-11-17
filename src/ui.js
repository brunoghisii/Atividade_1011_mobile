// Componentes compartilhados: avisos (snackbar), confirmação e hook de envio que bloqueia
// duplo clique / reenvio enquanto a requisição está em andamento.
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Button, Dialog, HelperText, Portal, Snackbar, Text, TextInput } from "react-native-paper";
import { errorMessage } from "./api";

const Ctx = createContext(null);

export function UiProvider({ children }) {
  const [snack, setSnack] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const notify = useCallback((msg) => setSnack(String(msg)), []);
  const ask = useCallback(
    (title, message, okLabel = "Confirmar") =>
      new Promise((resolve) => setConfirm({ title, message, okLabel, resolve })),
    []
  );
  const close = (v) => {
    confirm?.resolve(v);
    setConfirm(null);
  };

  return (
    <Ctx.Provider value={{ notify, ask }}>
      {children}
      <Portal>
        <Dialog visible={!!confirm} onDismiss={() => close(false)}>
          <Dialog.Title>{confirm?.title}</Dialog.Title>
          <Dialog.Content>
            <Text>{confirm?.message}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => close(false)}>Voltar</Button>
            <Button onPress={() => close(true)}>{confirm?.okLabel}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <Snackbar visible={!!snack} onDismiss={() => setSnack(null)} duration={4000}>
        {snack}
      </Snackbar>
    </Ctx.Provider>
  );
}

export const useUi = () => useContext(Ctx);

// Executa uma ação assíncrona garantindo que só exista UMA em andamento.
// `busy` deve ser usado para desabilitar botões/inputs durante o envio.
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const { notify } = useUi();
  const run = useCallback(
    async (fn) => {
      if (lock.current) return undefined;
      lock.current = true;
      setBusy(true);
      try {
        return await fn();
      } catch (e) {
        notify(errorMessage(e));
        return undefined;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [notify]
  );
  return [busy, run];
}

// Campo de texto com mensagem de erro
export function Field({ error, style, ...props }) {
  return (
    <>
      <TextInput mode="outlined" error={!!error} style={[{ marginTop: 8 }, style]} {...props} />
      {error ? <HelperText type="error">{error}</HelperText> : null}
    </>
  );
}

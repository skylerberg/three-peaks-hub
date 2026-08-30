import { Button, Rows, Text, Title } from '@canva/app-ui-kit';
import { auth } from '@canva/user';
import { useCallback, useEffect, useState } from 'react';
import { api, apiMessage, assertOk, setToken } from 'src/api';
import * as styles from 'styles/components.css';

interface HubUser {
  id: string;
  name: string;
  email: string;
}

type State =
  | { kind: 'checking' }
  | { kind: 'pairing'; code: string }
  | { kind: 'ready'; user: HubUser }
  | { kind: 'error'; message: string };

export const App = () => {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);

  // `switchAccount` asks the server for a code even where this Canva user is
  // already linked, which is the only way somebody signed into the wrong
  // account fixes it without leaving Canva.
  const connect = useCallback(async (switchAccount = false) => {
    setBusy(true);
    try {
      // Minted fresh every time rather than held. Canva's token lasts five
      // minutes, so a stored one is a token that has usually expired.
      const canvaToken = await auth.getCanvaUserToken();
      const result = assertOk(
        await api.POST('/api/canva-app/session', {
          body: { token: canvaToken, ...(switchAccount ? { switch_account: true } : {}) },
        })
      );

      if (result.linked) {
        setToken(result.token);
        setState({ kind: 'ready', user: result.user });
      } else {
        setToken(null);
        setState({ kind: 'pairing', code: result.pairing_code });
      }
    } catch (error) {
      setState({ kind: 'error', message: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void connect();
  }, [connect]);

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
        <Title size="small">Three Peaks</Title>

        {state.kind === 'checking' && <Text size="small">Connecting…</Text>}

        {state.kind === 'pairing' && (
          <Rows spacing="1u">
            <Text size="small">
              Enter this code on your account page at tools.threepeaksgames.com to connect Canva to
              your projects.
            </Text>
            <Title size="medium">{state.code}</Title>
            <Text size="small" tone="tertiary">
              The code lasts ten minutes. Asking again replaces it.
            </Text>
            <Button variant="primary" onClick={() => void connect()} disabled={busy} stretch>
              I have entered it
            </Button>
          </Rows>
        )}

        {state.kind === 'ready' && (
          <Rows spacing="1u">
            <Text size="small">Connected as {state.user.name}</Text>
            <Text size="small" tone="tertiary">
              Importing this design into a deck comes next.
            </Text>
            <Button variant="secondary" onClick={() => void connect(true)} disabled={busy} stretch>
              Use a different account
            </Button>
          </Rows>
        )}

        {state.kind === 'error' && (
          <Rows spacing="1u">
            <Text size="small">{state.message}</Text>
            <Button variant="primary" onClick={() => void connect()} disabled={busy} stretch>
              Try again
            </Button>
          </Rows>
        )}
      </Rows>
    </div>
  );
};

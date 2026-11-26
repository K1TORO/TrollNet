import { type Lang } from './i18n';
import { type Objective } from './api';

/**
 * Objective title/description/category come from the backend (ContentLibrary.cs) in English.
 * These dictionaries translate them on the client, keyed by the English source text. Anything
 * not found falls back to the English original, so new backend content still renders.
 */
const TITLE_PL: Record<string, string> = {
  'Operation Meme Storm': 'Operacja Memowa Burza',
  'The Bridge Toll': 'Myto na Moście',
  'Silent Lurker': 'Cichy Podglądacz',
  'Midnight Leak': 'Północny Wyciek',
  'Throne of the Cat Overlord': 'Tron Kociego Władcy',
  "The Admin's Vault": 'Skarbiec Admina',
  'The Dead Drop': 'Martwa Skrzynka',
  'The Shadow Decree': 'Cienisty Dekret',
  'The Open Push': 'Otwarty Push',
};

const DESCRIPTION_PL: Record<string, string> = {
  'A trending meme carries a hidden notice that only runs in your browser. Read it with the dev console (or an XSS payload) and submit the flag.':
    'Trendujący mem niesie ukryte powiadomienie, które działa tylko w Twojej przeglądarce. Odczytaj je konsolą deweloperską (lub ładunkiem XSS) i wyślij flagę.',
  'The bridge keeper pinned a private note to this post. There is no access check on it — read it by its id and submit the flag.':
    'Strażnik mostu przypiął do tego posta prywatną notatkę. Nie ma na niej żadnej kontroli dostępu — odczytaj ją po jej id i wyślij flagę.',
  'A quiet account hid a flag in a column the feed never shows. The search box speaks SQL — make it hand over everything.':
    'Ciche konto ukryło flagę w kolumnie, której feed nigdy nie pokazuje. Pole wyszukiwania mówi po SQL — zmuś je, by oddało wszystko.',
  "A careless endpoint returns every objective's secret to anyone who asks. Read this one's flag straight from the objectives API.":
    'Nieuważny endpoint zwraca sekret każdego zadania każdemu, kto zapyta. Odczytaj flagę tego zadania wprost z API zadań.',
  'The flag vault only answers to admins, but the token check is broken. Forge an alg:none admin token and open the vault.':
    'Skarbiec flag odpowiada tylko adminom, ale sprawdzanie tokenu jest zepsute. Podrób token admina alg:none i otwórz skarbiec.',
  'The admin credentials are committed in plain text. Sign in as admin, then open the flag vault with the reveal endpoint.':
    'Dane admina są zacommitowane otwartym tekstem. Zaloguj się jako admin, potem otwórz skarbiec flag endpointem ujawniającym.',
  'A bot dropped an internal link. Make the server\'s link-preview fetch it for you: the vault only answers requests from inside the network.':
    'Bot podrzucił wewnętrzny link. Niech podgląd linku serwera pobierze go za Ciebie: skarbiec odpowiada tylko na żądania z wnętrza sieci.',
  'The post composer trusts every field you send. Forge a privileged decree (isTrending/authorId) and the server leaks the decree\'s secret back to you.':
    'Kreator postów ufa każdemu polu, które wyślesz. Podrób uprzywilejowany dekret (isTrending/authorId), a serwer odeśle Ci sekret dekretu.',
  "The 'internal' post API is reachable without a login. Read this post through it to see the note the public feed hides.":
    '„Wewnętrzne” API postów jest osiągalne bez logowania. Odczytaj przez nie ten post, by zobaczyć notatkę, którą ukrywa publiczny feed.',
};

const CATEGORY_PL: Record<string, string> = {
  Recon: 'Rozpoznanie',
  Puzzle: 'Zagadka',
  Investigation: 'Śledztwo',
  Challenge: 'Wyzwanie',
};

function trMap(dict: Record<string, string>, lang: Lang, en: string): string {
  return lang === 'pl' ? dict[en] ?? en : en;
}

export function objectiveTitle(o: Objective, lang: Lang): string {
  return trMap(TITLE_PL, lang, o.title);
}

export function objectiveDescription(o: Objective, lang: Lang): string {
  return trMap(DESCRIPTION_PL, lang, o.description);
}

export function objectiveCategory(category: string, lang: Lang): string {
  return trMap(CATEGORY_PL, lang, category);
}

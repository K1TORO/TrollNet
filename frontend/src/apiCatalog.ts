/**
 * In-game reference of TrollNet's HTTP API and database schema.
 * In a real engagement this map takes a long time to build by hand; here players get it for free.
 * Keep in sync with src/Services/* (endpoints) and src/Services/* /Data (EF Core models).
 */

import { type Lang } from './i18n';

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

export interface Endpoint {
  method: HttpMethod;
  path: string;
  auth: string;
  request?: string;
  response: string;
  note?: string;
}

export interface ServiceApi {
  service: string;
  description: string;
  endpoints: Endpoint[];
}

export interface Column {
  name: string;
  type: string;
  nullable?: boolean;
  key?: 'PK' | 'FK' | 'UQ';
  note?: string;
}

export interface Table {
  name: string;
  columns: Column[];
  indexes?: string[];
}

export interface Database {
  name: string;
  owner: string;
  tables: Table[];
}

const BEARER = 'Bearer token';
const NONE = 'none';

export const API_CATALOG: ServiceApi[] = [
  {
    service: 'auth-service',
    description: 'Players, sign-in tokens (JWT, HS256).',
    endpoints: [
      { method: 'POST', path: '/api/auth/guest', auth: NONE, response: 'AuthResponse', note: 'Used by the web app on first visit.' },
      { method: 'POST', path: '/api/auth/register', auth: NONE, request: '{ username, password }', response: 'AuthResponse' },
      { method: 'POST', path: '/api/auth/login', auth: NONE, request: '{ username, password }', response: 'AuthResponse' },
      { method: 'GET', path: '/api/auth/me', auth: BEARER, response: 'UserDto' },
      { method: 'GET', path: '/api/auth/config', auth: NONE, response: '{ environment, adminUsername, adminPassword, warning }', note: 'VULN #16: debug endpoint leaks the admin credentials to anyone.' },
    ],
  },
  {
    service: 'social-service',
    description: 'Posts, comments, search and attachments.',
    endpoints: [
      { method: 'GET', path: '/api/posts?page=&pageSize=', auth: NONE, response: 'PostDto[]', note: 'Newest first, pageSize max 50.' },
      { method: 'GET', path: '/api/posts/trending', auth: NONE, response: 'PostDto[]' },
      { method: 'GET', path: '/api/posts/search?query=', auth: NONE, response: 'PostDto[]' },
      { method: 'GET', path: '/api/posts/{id}', auth: NONE, response: 'PostDetailDto' },
      { method: 'GET', path: '/api/posts/{id}/note', auth: NONE, response: 'PostNoteDto', note: 'VULN #03 (IDOR): no ownership check — returns the private systemNote.' },
      { method: 'GET', path: '/api/posts/attachment?name=', auth: NONE, response: 'text/plain file contents' },
      { method: 'POST', path: '/api/posts', auth: BEARER, request: '{ content, authorId?, authorName?, isTrending? }', response: 'CreatePostResponse (201)', note: 'VULN #04 (mass assignment): forging privileged fields echoes the decree systemNote.' },
      { method: 'DELETE', path: '/api/posts/{id}', auth: BEARER, response: '204 No Content' },
      { method: 'POST', path: '/api/posts/{id}/comments', auth: BEARER, request: '{ content }', response: 'CommentDto (201)' },
      { method: 'DELETE', path: '/api/comments/{id}', auth: BEARER, response: '204 No Content' },
      { method: 'POST', path: '/internal/posts', auth: NONE, request: '{ authorName, content, isTrending, systemNote? }', response: '{ id }', note: 'Service-to-service: used by the game engine.' },
      { method: 'GET', path: '/internal/posts/{id}', auth: NONE, response: 'InternalPostDto', note: 'VULN #08: unauthenticated — exposes the hidden systemNote.' },
      { method: 'DELETE', path: '/internal/posts/{id}', auth: NONE, response: '204 No Content', note: 'Service-to-service.' },
      { method: 'POST', path: '/internal/posts/{id}/comments', auth: NONE, request: '{ authorName, content }', response: '{ id }', note: 'Service-to-service.' },
    ],
  },
  {
    service: 'game-service',
    description: 'Game engine, objectives, flags and scores.',
    endpoints: [
      { method: 'GET', path: '/api/objectives', auth: NONE, response: 'ObjectiveDto[]', note: 'flag is null except for the DataLeak objective (#15).' },
      { method: 'POST', path: '/api/objectives/{id}/submit', auth: BEARER, request: '{ flag }', response: '{ correct, pointsAwarded, message }', note: 'XSS objectives reject a pasted flag — capture them via xss-proof.' },
      { method: 'POST', path: '/api/objectives/{id}/xss-proof', auth: BEARER, request: '{ flag }', response: '{ correct, pointsAwarded, message }', note: 'VULN #02: beacon a stored XSS payload hits; also checks a payload was stored.' },
      { method: 'POST', path: '/api/objectives/{id}/skip', auth: BEARER, response: 'ModeState', note: 'Give up on an objective (counts as a fail).' },
      { method: 'GET', path: '/api/objectives/{id}/flag', auth: `${BEARER} (Admin)`, response: '{ objectiveId, flag }', note: 'The vault (#13/#16): JWT signature is never checked.' },
      { method: 'GET', path: '/api/objectives/{id}/notice', auth: BEARER, response: '{ objectiveId, flag }', note: 'VULN #02 (XSS): the flag the page keeps in a JS-only variable.' },
      { method: 'GET', path: '/internal/vault/{id}', auth: NONE, response: '{ objectiveId, flag }', note: 'VULN #06 (SSRF): NOT routed by the gateway — reachable only from inside the network.' },
      { method: 'GET', path: '/api/scores/leaderboard', auth: NONE, response: 'ScoreDto[] (top 20)' },
      { method: 'GET', path: '/api/scores/me', auth: BEARER, response: 'ScoreDto' },
      { method: 'POST', path: '/api/link-preview', auth: NONE, request: '{ url }', response: '{ url, statusCode, bodyPreview }' },
      { method: 'GET', path: '/api/mode', auth: BEARER, response: 'ModeState', note: 'Educational vs Challenge mode + the current run state.' },
      { method: 'POST', path: '/api/mode', auth: BEARER, request: '{ mode }', response: 'ModeState', note: 'Switch mode; resets the fail counter.' },
    ],
  },
];

/** Response shapes referenced above. */
export const API_TYPES: { name: string; shape: string }[] = [
  { name: 'AuthResponse', shape: '{ token, expiresAt, user: UserDto }' },
  { name: 'UserDto', shape: '{ id, username, role }' },
  { name: 'PostDto', shape: '{ id, authorId, authorName, content, isTrending, createdAt, commentCount }' },
  { name: 'PostDetailDto', shape: '{ id, authorId, authorName, content, isTrending, createdAt, comments: CommentDto[] }' },
  { name: 'PostNoteDto', shape: '{ postId, systemNote }' },
  { name: 'InternalPostDto', shape: '{ id, authorId, authorName, content, isTrending, createdAt, systemNote }' },
  { name: 'CommentDto', shape: '{ id, postId, authorId, authorName, content, createdAt }' },
  {
    name: 'ObjectiveDto',
    shape:
      '{ id, title, description, category, tipId, vector, difficulty, points, targetPostId, createdAt, expiresAt, isCompleted, completedByUsername, flag (null unless DataLeak) }',
  },
  { name: 'ScoreDto', shape: '{ userId, username, points }' },
  { name: 'Error', shape: '{ error } or { errors: { field: [messages] } }' },
];

export const DATABASES: Database[] = [
  {
    name: 'trollnet_auth',
    owner: 'auth-service',
    tables: [
      {
        name: 'Users',
        columns: [
          { name: 'Id', type: 'integer', key: 'PK', note: 'identity' },
          { name: 'Username', type: 'varchar(32)' },
          { name: 'NormalizedUsername', type: 'varchar(32)', key: 'UQ', note: 'lower-case' },
          { name: 'PasswordHash', type: 'varchar(100)', note: 'BCrypt' },
          { name: 'Role', type: 'varchar(16)', note: 'User | Moderator | Admin' },
          { name: 'CreatedAt', type: 'timestamptz' },
        ],
        indexes: ['UNIQUE (NormalizedUsername)'],
      },
    ],
  },
  {
    name: 'trollnet_social',
    owner: 'social-service',
    tables: [
      {
        name: 'Posts',
        columns: [
          { name: 'Id', type: 'integer', key: 'PK', note: 'identity' },
          { name: 'AuthorId', type: 'integer', note: 'Users.Id (other DB); 0 = system' },
          { name: 'AuthorName', type: 'varchar(32)' },
          { name: 'Content', type: 'varchar(2000)' },
          { name: 'IsTrending', type: 'boolean' },
          { name: 'CreatedAt', type: 'timestamptz' },
        ],
        indexes: ['(CreatedAt)'],
      },
      {
        name: 'Comments',
        columns: [
          { name: 'Id', type: 'integer', key: 'PK', note: 'identity' },
          { name: 'PostId', type: 'integer', key: 'FK', note: 'Posts.Id, ON DELETE CASCADE' },
          { name: 'AuthorId', type: 'integer', note: 'Users.Id (other DB); 0 = system' },
          { name: 'AuthorName', type: 'varchar(32)' },
          { name: 'Content', type: 'varchar(1000)' },
          { name: 'CreatedAt', type: 'timestamptz' },
        ],
        indexes: ['(PostId, CreatedAt)'],
      },
    ],
  },
  {
    name: 'trollnet_game',
    owner: 'game-service',
    tables: [
      {
        name: 'Objectives',
        columns: [
          { name: 'Id', type: 'integer', key: 'PK', note: 'identity' },
          { name: 'Title', type: 'varchar(100)' },
          { name: 'Description', type: 'varchar(1000)' },
          { name: 'Category', type: 'varchar(50)' },
          { name: 'TipId', type: 'varchar(2)', note: 'links to the Tips page' },
          { name: 'Difficulty', type: 'integer', note: '1-3' },
          { name: 'Points', type: 'integer' },
          { name: 'TargetPostId', type: 'integer', nullable: true, note: 'Posts.Id (other DB)' },
          { name: 'TargetUserId', type: 'integer', nullable: true, note: 'Users.Id (other DB)' },
          { name: 'Flag', type: 'varchar(100)', note: 'TROLL{...}' },
          { name: 'CreatedAt', type: 'timestamptz' },
          { name: 'ExpiresAt', type: 'timestamptz', note: 'moderator review time' },
          { name: 'IsCompleted', type: 'boolean' },
          { name: 'CompletedByUserId', type: 'integer', nullable: true },
          { name: 'CompletedByUsername', type: 'varchar(32)', nullable: true },
          { name: 'CompletedAt', type: 'timestamptz', nullable: true },
        ],
        indexes: ['(IsCompleted, ExpiresAt)'],
      },
      {
        name: 'Scores',
        columns: [
          { name: 'UserId', type: 'integer', key: 'PK', note: 'Users.Id (other DB)' },
          { name: 'Username', type: 'varchar(32)' },
          { name: 'Points', type: 'integer' },
          { name: 'UpdatedAt', type: 'timestamptz' },
        ],
        indexes: ['(Points)'],
      },
    ],
  },
];

/**
 * Polish for the prose strings (service descriptions, endpoint notes, a few column notes).
 * Technical strings (type shapes, paths, auth, schema shorthand) are intentionally left out and
 * stay as-is in both languages.
 */
const PROSE_PL: Record<string, string> = {
  // service descriptions
  'Players, sign-in tokens (JWT, HS256).': 'Gracze, tokeny logowania (JWT, HS256).',
  'Posts, comments, search and attachments.': 'Posty, komentarze, wyszukiwanie i załączniki.',
  'Game engine, objectives, flags and scores.': 'Silnik gry, zadania, flagi i wyniki.',
  // endpoint notes
  'Used by the web app on first visit.': 'Używane przez aplikację webową przy pierwszej wizycie.',
  'Newest first, pageSize max 50.': 'Najnowsze pierwsze, pageSize maks. 50.',
  'VULN #03 (IDOR): no ownership check — returns the private systemNote.':
    'VULN #03 (IDOR): brak sprawdzenia własności — zwraca prywatny systemNote.',
  'VULN #04 (mass assignment): forging privileged fields echoes the decree systemNote.':
    'VULN #04 (mass assignment): podrobienie uprzywilejowanych pól odbija systemNote dekretu.',
  'Service-to-service: used by the game engine.': 'Usługa-do-usługi: używane przez silnik gry.',
  'VULN #08: unauthenticated — exposes the hidden systemNote.':
    'VULN #08: bez uwierzytelnienia — ujawnia ukryty systemNote.',
  'Service-to-service.': 'Usługa-do-usługi.',
  'flag is null except for the DataLeak objective (#15).': 'flag jest null poza zadaniem DataLeak (#15).',
  'The vault (#13/#16): JWT signature is never checked.': 'Skarbiec (#13/#16): podpis JWT nigdy nie jest sprawdzany.',
  'VULN #02 (XSS): the flag the page keeps in a JS-only variable.':
    'VULN #02 (XSS): flaga trzymana przez stronę w zmiennej tylko-JS.',
  'VULN #06 (SSRF): NOT routed by the gateway — reachable only from inside the network.':
    'VULN #06 (SSRF): NIE trasowane przez gateway — osiągalne tylko z wnętrza sieci.',
  'VULN #16: debug endpoint leaks the admin credentials to anyone.':
    'VULN #16: debugowy endpoint wycieka dane admina każdemu.',
  'XSS objectives reject a pasted flag — capture them via xss-proof.':
    'Zadania XSS odrzucają wklejoną flagę — zdobywa się je przez xss-proof.',
  'VULN #02: beacon a stored XSS payload hits; also checks a payload was stored.':
    'VULN #02: beacon, który trafia zapisany ładunek XSS; sprawdza też, że ładunek zapisano.',
  'Give up on an objective (counts as a fail).': 'Poddanie zadania (liczy się jako oblane).',
  'Educational vs Challenge mode + the current run state.': 'Tryb Edukacja vs Wyzwanie + stan bieżącego przebiegu.',
  'Switch mode; resets the fail counter.': 'Zmiana trybu; resetuje licznik oblań.',
  // db column notes (prose only)
  'lower-case': 'małe litery',
  'Users.Id (other DB); 0 = system': 'Users.Id (inna DB); 0 = system',
  'Users.Id (other DB)': 'Users.Id (inna DB)',
  'Posts.Id (other DB)': 'Posts.Id (inna DB)',
  'Posts.Id, ON DELETE CASCADE': 'Posts.Id, ON DELETE CASCADE',
  'links to the Tips page': 'łączy ze stroną Wskazówek',
  'moderator review time': 'czas przeglądu przez moderatora',
};

/** Translate one prose string if a Polish version exists; otherwise return it unchanged. */
function tr(lang: Lang, s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return lang === 'pl' ? PROSE_PL[s] ?? s : s;
}

/** API catalog with prose (description, note) resolved for the given language. */
export function getApiCatalog(lang: Lang): ServiceApi[] {
  return API_CATALOG.map((svc) => ({
    ...svc,
    description: tr(lang, svc.description) ?? svc.description,
    endpoints: svc.endpoints.map((e) => ({ ...e, note: tr(lang, e.note) })),
  }));
}

/** Database schema with column notes resolved for the given language. */
export function getDatabases(lang: Lang): Database[] {
  return DATABASES.map((db) => ({
    ...db,
    tables: db.tables.map((t) => ({
      ...t,
      columns: t.columns.map((c) => ({ ...c, note: tr(lang, c.note) })),
    })),
  }));
}

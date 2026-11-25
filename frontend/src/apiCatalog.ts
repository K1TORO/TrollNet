/**
 * In-game reference of TrollNet's HTTP API and database schema.
 * In a real engagement this map takes a long time to build by hand; here players get it for free.
 * Keep in sync with src/Services/* (endpoints) and src/Services/* /Data (EF Core models).
 */

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
      { method: 'POST', path: '/api/objectives/{id}/submit', auth: BEARER, request: '{ flag }', response: '{ correct, pointsAwarded, message }' },
      { method: 'GET', path: '/api/objectives/{id}/flag', auth: `${BEARER} (Admin)`, response: '{ objectiveId, flag }', note: 'The vault (#13/#16): JWT signature is never checked.' },
      { method: 'GET', path: '/api/objectives/{id}/notice', auth: BEARER, response: '{ objectiveId, flag }', note: 'VULN #02 (XSS): the flag the page keeps in a JS-only variable.' },
      { method: 'GET', path: '/internal/vault/{id}', auth: NONE, response: '{ objectiveId, flag }', note: 'VULN #06 (SSRF): NOT routed by the gateway — reachable only from inside the network.' },
      { method: 'GET', path: '/api/scores/leaderboard', auth: NONE, response: 'ScoreDto[] (top 20)' },
      { method: 'GET', path: '/api/scores/me', auth: BEARER, response: 'ScoreDto' },
      { method: 'POST', path: '/api/link-preview', auth: NONE, request: '{ url }', response: '{ url, statusCode, bodyPreview }' },
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

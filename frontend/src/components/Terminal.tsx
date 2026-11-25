import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { tokenStore } from '../api';

export interface TerminalFlag {
  flag: string;
  meaning: string;
}

const LOAD_EVENT = 'trollnet:terminal-load';

/** Puts a command into the side terminal's prompt (and opens the panel). */
export function loadIntoTerminal(command: string) {
  window.dispatchEvent(new CustomEvent<string>(LOAD_EVENT, { detail: command }));
}

/** Subscribe to loadIntoTerminal() calls. */
export function onTerminalLoad(handler: (command: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener(LOAD_EVENT, listener);
  return () => window.removeEventListener(LOAD_EVENT, listener);
}

type LineKind = 'input' | 'output' | 'error' | 'info';
interface Line {
  id: number;
  kind: LineKind;
  text: string;
}

const PROMPT = 'user@trollnet ~$';
const MAX_OUTPUT_CHARS = 20_000;

const HELP = `Available commands:
  curl [options] <url>   send an HTTP request to the TrollNet API
      -X, --request <M>      HTTP method (GET, POST, PUT, DELETE...)
      -H, --header <H>       add a header, e.g. -H "Content-Type: application/json"
      -d, --data <body>      request body (POST by default when present)
      --data-urlencode <d>   URL-encode the value (name=value) and send it
      -G, --get              put -d / --data-urlencode data into the URL query
      -i, --include          show response status and headers
  jq [-r] <filter>       pick fields from JSON: .  .name  .[0]  .[]  .[0].flag
  base64 [-d] <text>     encode text to base64url (-d decodes)
  echo <text>            print text
  NAME=value             set a variable, use it later as $NAME
  whoami                 show your guest token info
  history                list previous commands
  clear                  clear the screen
  help                   show this help

Pipes work: curl /api/objectives | jq '.[0].flag'
$TOKEN is your own session token. Up/Down arrows browse history.`;

const PIPE = Symbol('pipe');
type Word = string | typeof PIPE;

/**
 * Splits a command line into words, honouring '…' and "…" quotes and backslash escapes.
 * $VAR is expanded outside single quotes; an unquoted | separates pipeline stages.
 */
function tokenize(input: string, vars: Record<string, string>): Word[] {
  const out: Word[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let hasWord = false;
  const flush = () => {
    if (hasWord) out.push(cur);
    cur = '';
    hasWord = false;
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '$' && quote !== "'") {
      const m = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/.exec(input.slice(i));
      if (m) {
        cur += vars[m[1] ?? m[2]] ?? '';
        hasWord = true;
        i += m[0].length - 1;
        continue;
      }
    }
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && /["\\$`]/.test(input[i + 1] ?? '')) cur += input[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasWord = true;
    } else if (ch === '\\' && i + 1 < input.length) {
      cur += input[++i];
      hasWord = true;
    } else if (ch === '|') {
      flush();
      out.push(PIPE);
    } else if (/\s/.test(ch)) {
      flush();
    } else {
      cur += ch;
      hasWord = true;
    }
  }
  if (quote) throw new Error('unterminated quote');
  flush();
  return out;
}

/**
 * Cleans text copied from docs: drops surrounding `backticks`, a leading "$ " prompt,
 * and joins lines continued with a trailing backslash.
 */
function normalizeCommand(raw: string): string {
  let s = raw.replace(/\\\r?\n\s*/g, ' ').replace(/\r?\n/g, ' ').trim();
  if (s.length > 1 && s.startsWith('`') && s.endsWith('`')) s = s.slice(1, -1).trim();
  s = s.replace(/^\$\s+/, '');
  return s;
}

/** Absolute localhost URLs go through the page origin, so the dev proxy / nginx handles them. */
function resolveUrl(raw: string): string {
  let url = raw;
  if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) url = `http://${url}`;
  try {
    const parsed = new URL(url, window.location.origin);
    if (['localhost', '127.0.0.1'].includes(parsed.hostname) || parsed.origin === window.location.origin) {
      return parsed.pathname + parsed.search;
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

function prettyBody(text: string, contentType: string | null): string {
  let body = text;
  if (contentType?.includes('json') || /^\s*[[{]/.test(text)) {
    try {
      body = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* not JSON after all */
    }
  }
  return body;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const b64 = text.trim().replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** "name=value" → "name=<encoded value>"; "value" → "<encoded value>" (like curl). */
function urlEncodeData(d: string): string {
  const idx = d.indexOf('=');
  if (idx < 0) return encodeURIComponent(d);
  return `${d.slice(0, idx)}=${encodeURIComponent(d.slice(idx + 1))}`;
}

interface CmdResult {
  text: string;
  failed?: boolean;
}

async function runCurl(args: string[]): Promise<CmdResult> {
  let method: string | null = null;
  const data: string[] = [];
  let getMode = false;
  let include = false;
  let url: string | null = null;
  const headers = new Headers();

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => {
      const v = args[++i];
      if (v === undefined) throw new Error(`option ${a} needs a value`);
      return v;
    };
    switch (a) {
      case '-X':
      case '--request':
        method = next().toUpperCase();
        break;
      case '-H':
      case '--header': {
        const h = next();
        const idx = h.indexOf(':');
        if (idx < 1) throw new Error(`bad header "${h}" (use "Name: value")`);
        headers.append(h.slice(0, idx).trim(), h.slice(idx + 1).trim());
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
        data.push(next());
        break;
      case '--data-urlencode':
        data.push(urlEncodeData(next()));
        break;
      case '-G':
      case '--get':
        getMode = true;
        break;
      case '-i':
      case '--include':
        include = true;
        break;
      case '-s':
      case '--silent':
      case '-S':
      case '--show-error':
      case '-k':
      case '--insecure':
      case '-L':
      case '--location':
        break; // accepted for compatibility, no effect in the browser
      default:
        if (a.startsWith('-') && a.length > 1) throw new Error(`unsupported option ${a}`);
        url = a;
    }
  }

  if (!url) throw new Error('no URL given. Try: curl /api/posts');
  if (/<[^>]+>|\{[a-zA-Z]+\}/.test(url)) throw new Error('replace the <placeholders> / {id} in the URL first');

  let target = resolveUrl(url);
  let body: string | undefined = data.length > 0 ? data.join('&') : undefined;
  if (getMode && body !== undefined) {
    target += (target.includes('?') ? '&' : '?') + body;
    body = undefined;
  }
  method ??= getMode ? 'GET' : body !== undefined ? 'POST' : 'GET';
  if (body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
  }

  const res = await fetch(target, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body });
  const text = await res.text();

  let out = '';
  if (include) {
    const head = [`HTTP ${res.status} ${res.statusText}`];
    res.headers.forEach((v, k) => head.push(`${k}: ${v}`));
    out = `${head.join('\n')}\n\n`;
  }
  out += text || (include ? '' : `(empty body, HTTP ${res.status})`);
  return { text: out, failed: !res.ok };
}

/** Tiny jq: supports ., .key, ."key", .[n], .[] and chains of them. */
function runJq(args: string[], stdin: string): CmdResult {
  const raw = args.includes('-r') || args.includes('--raw-output');
  const filter = args.filter((a) => a !== '-r' && a !== '--raw-output')[0] ?? '.';
  let data: unknown;
  try {
    data = JSON.parse(stdin);
  } catch {
    throw new Error('input is not valid JSON');
  }

  const steps: (string | number | '[]')[] = [];
  const re = /\.?\[(\d+|-\d+)?\]|\.([A-Za-z_]\w*)|\."([^"]*)"|\./gy;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while (re.lastIndex < filter.length && (m = re.exec(filter))) {
    if (m[0].endsWith(']')) steps.push(m[1] === undefined ? '[]' : Number(m[1]));
    else if (m[2] !== undefined) steps.push(m[2]);
    else if (m[3] !== undefined) steps.push(m[3]);
  }
  if (re.lastIndex !== filter.length || !filter.startsWith('.')) {
    throw new Error(`unsupported filter "${filter}" (try .key, .[0], .[])`);
  }

  let values: unknown[] = [data];
  for (const step of steps) {
    values = values.flatMap((v) => {
      if (step === '[]') {
        if (Array.isArray(v)) return v;
        if (v && typeof v === 'object') return Object.values(v);
        throw new Error('cannot iterate over a non-array');
      }
      if (typeof step === 'number') {
        if (v == null) return [null];
        if (!Array.isArray(v)) throw new Error('cannot index a non-array with a number');
        return [v[step < 0 ? v.length + step : step] ?? null];
      }
      if (v == null) return [null];
      if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`cannot index ${Array.isArray(v) ? 'an array' : typeof v} with "${step}"`);
      return [(v as Record<string, unknown>)[step] ?? null];
    });
  }

  return {
    text: values.map((v) => (raw && typeof v === 'string' ? v : JSON.stringify(v, null, 2))).join('\n'),
  };
}

interface TerminalProps {
  title?: string;
  onClose?: () => void;
}

/** In-browser terminal: run curl requests against the API and see the responses. */
export function Terminal({ title = 'user@trollnet — bash', onClose }: TerminalProps) {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histPos, setHistPos] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const nextId = useRef(0);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const vars = useRef<Record<string, string>>({});
  const userVars = useRef<Record<string, string>>({});

  useEffect(() => {
    screenRef.current?.scrollTo({ top: screenRef.current.scrollHeight });
  }, [lines]);

  useEffect(
    () =>
      onTerminalLoad((command) => {
        setInput(command);
        setHistPos(null);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }),
    [],
  );

  function print(kind: LineKind, text: string) {
    setLines((prev) => [...prev, { id: nextId.current++, kind, text }]);
  }

  async function runStage(cmd: string, args: string[], stdin: string): Promise<CmdResult> {
    switch (cmd) {
      case 'help':
        return { text: HELP };
      case 'echo':
        return { text: args.join(' ') };
      case 'history':
        return { text: history.map((h, i) => `${String(i + 1).padStart(3)}  ${h}`).join('\n') };
      case 'whoami': {
        const token = vars.current.TOKEN;
        if (!token) throw new Error('no session token yet');
        let claims: string;
        try {
          claims = JSON.stringify(JSON.parse(fromBase64Url(token.split('.')[1] ?? '')), null, 2);
        } catch {
          claims = '(could not decode token payload)';
        }
        return { text: `token: ${token}\nclaims:\n${claims}` };
      }
      case 'base64': {
        const decode = args[0] === '-d' || args[0] === '--decode';
        const rest = decode ? args.slice(1) : args;
        const text = rest.length > 0 ? rest.join(' ') : stdin.trim();
        return { text: decode ? fromBase64Url(text) : toBase64Url(text) };
      }
      case 'jq':
        return runJq(args, stdin);
      case 'curl':
        return runCurl(args);
      default:
        throw new Error(`command not found (type "help")`);
    }
  }

  async function execute(raw: string) {
    const line = normalizeCommand(raw);
    print('input', line);
    if (!line) return;
    setHistory((h) => (h[h.length - 1] === line ? h : [...h, line]));
    setHistPos(null);

    // Your own session token is always available as $TOKEN unless you overwrite it.
    vars.current.TOKEN = userVars.current.TOKEN ?? tokenStore.get() ?? '';

    let words: Word[];
    try {
      words = tokenize(line, vars.current);
    } catch (err) {
      print('error', `bash: ${(err as Error).message}`);
      return;
    }

    // NAME=value assignment
    const assign = words.length === 1 && typeof words[0] === 'string' ? /^([A-Za-z_]\w*)=(.*)$/s.exec(words[0]) : null;
    if (assign) {
      userVars.current[assign[1]] = assign[2];
      vars.current[assign[1]] = assign[2];
      return;
    }

    const stages: string[][] = [[]];
    for (const w of words) {
      if (w === PIPE) stages.push([]);
      else stages[stages.length - 1].push(w);
    }
    if (stages.some((st) => st.length === 0)) {
      print('error', 'bash: syntax error near "|"');
      return;
    }
    if (stages.length === 1 && stages[0][0] === 'clear') {
      setLines([]);
      return;
    }

    setBusy(true);
    let result: CmdResult = { text: '' };
    let current = '';
    try {
      for (const [cmd, ...args] of stages) {
        current = cmd;
        result = await runStage(cmd, args, result.text);
      }
      let text = stages.length === 1 && stages[0][0] === 'curl' ? prettyBody(result.text, null) : result.text;
      if (text.length > MAX_OUTPUT_CHARS) text = `${text.slice(0, MAX_OUTPUT_CHARS)}\n… (truncated)`;
      const kind: LineKind = stages[0][0] === 'help' ? 'info' : result.failed ? 'error' : 'output';
      if (text) print(kind, text);
    } catch (err) {
      print('error', `${current}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text');
    if (!/[\r\n`]/.test(pasted)) return; // plain one-liners paste normally
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart ?? input.length;
    const end = el.selectionEnd ?? input.length;
    setInput(input.slice(0, start) + normalizeCommand(pasted) + input.slice(end));
  }

  // Only grab the input when the click isn't part of a text selection, so output stays selectable.
  function focusInputUnlessSelecting() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) inputRef.current?.focus();
  }

  async function copyLine(line: Line) {
    const flag = line.text.match(/TROLL\{[^}]*\}/)?.[0];
    try {
      await navigator.clipboard.writeText(flag ?? line.text);
      setCopiedId(line.id);
      window.setTimeout(() => setCopiedId((id) => (id === line.id ? null : id)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !busy) {
      const value = input;
      setInput('');
      void execute(value);
    } else if (e.key === 'ArrowUp' && history.length > 0) {
      e.preventDefault();
      const pos = histPos === null ? history.length - 1 : Math.max(0, histPos - 1);
      setHistPos(pos);
      setInput(history[pos]);
    } else if (e.key === 'ArrowDown' && histPos !== null) {
      e.preventDefault();
      const pos = histPos + 1;
      if (pos >= history.length) {
        setHistPos(null);
        setInput('');
      } else {
        setHistPos(pos);
        setInput(history[pos]);
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    }
  }

  return (
    <div className="terminal terminal-live">
      <div className="terminal-header">
        <span className="terminal-dot" aria-hidden />
        <span className="terminal-dot" aria-hidden />
        <span className="terminal-dot" aria-hidden />
        <span className="terminal-title">{title}</span>
        {onClose && (
          <button className="link small terminal-close" onClick={onClose} aria-label="Hide terminal">
            Hide
          </button>
        )}
      </div>
      <div className="terminal-screen" ref={screenRef} onClick={focusInputUnlessSelecting}>
        {lines.length === 0 && <div className="terminal-out info">Type "help" to see available commands.</div>}
        {lines.map((l) =>
          l.kind === 'input' ? (
            <div key={l.id} className="terminal-out">
              <span className="terminal-prompt">{PROMPT}</span> {l.text}
            </div>
          ) : (
            <div key={l.id} className="terminal-out-row">
              <pre className={`terminal-out ${l.kind}`}>{l.text}</pre>
              <button
                className="terminal-linecopy"
                title="Copy"
                onClick={(e) => {
                  e.stopPropagation();
                  void copyLine(l);
                }}
              >
                {copiedId === l.id ? '✓ copied' : /TROLL\{[^}]*\}/.test(l.text) ? 'copy flag' : 'copy'}
              </button>
            </div>
          ),
        )}
        <div className="terminal-input-row">
          <span className="terminal-prompt">{busy ? '…' : PROMPT}</span>
          <input
            ref={inputRef}
            className="terminal-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-label="Terminal command"
          />
        </div>
      </div>
    </div>
  );
}

interface CommandTemplateProps {
  title: string;
  command: string;
  description?: string;
  flags?: TerminalFlag[];
}

/** A curl template card for a tip; "Load into terminal" sends it to the side terminal. */
export function CommandTemplate({ title, command, description, flags }: CommandTemplateProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="terminal">
      <div className="terminal-header">
        <span className="terminal-dot" aria-hidden />
        <span className="terminal-dot" aria-hidden />
        <span className="terminal-dot" aria-hidden />
        <span className="terminal-title">{title}</span>
      </div>
      <div className="terminal-body">
        <p className="terminal-line">
          <span className="terminal-prompt">{PROMPT}</span> <code>{command}</code>
        </p>
        {description ? <p className="terminal-desc">{description}</p> : null}
        {flags && flags.length > 0 ? (
          <ul className="terminal-flags">
            {flags.map((f) => (
              <li key={f.flag}>
                <code>{f.flag}</code> — {f.meaning}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="terminal-actions">
          <button className="link small" onClick={() => loadIntoTerminal(command)}>
            Load into terminal
          </button>
          <button className="link small" onClick={copy}>
            {copied ? 'Copied!' : 'Copy command'}
          </button>
        </div>
      </div>
    </div>
  );
}

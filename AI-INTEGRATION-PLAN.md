# TrollNet — Plan integracji AI

Status: **Fazy 1 i 2 zaimplementowane i zweryfikowane na żywo** (lokalny model llama3.2:3b przez Ollamę). Faza 3 (desktop) do zrobienia.
Data: 2026-11-27.

## ✅ Faza 2 — AI generuje treść feedu (zweryfikowana)
- **ai-service**: nowy endpoint service-to-service `POST /internal/generate` (anonimowy, NIE trasowany przez gateway). ai-service dołączony do sieci `backend` (obok `frontend`), by game-service mógł go dosięgnąć.
- **game-service**: `AiContentClient` (→ `/internal/generate`), `AiPostCache` (bufor w pamięci) i `AiContentRefiller` (hosted service napełniający cache w tle, poza tickiem silnika). Ambient-posty w feedzie biorą post z cache AI, a przy braku/niedostępności → fallback do `ContentLibrary.AmbientPosts`. Config: `Services__Ai`.
- Opisy/treści zadań celowo NIE są generowane przez AI (niosą mechanikę puzzli).
- Zweryfikowane: generacja z sieci `backend` zwróciła realny trollowy post z modelu.

## ✅ Faza 1 — co już działa (decyzje: oba runtime / osobny ai-service / Tauri później / tutor+czat)
- **`src/Services/AiService/`** — nowy mikroserwis .NET: `/api/assistant/status|hint|chat`, klient OpenAI-compatible, guardraile (flaga nigdy nie trafia do modelu), rate-limit, timeout, auth JWT.
- **Gateway**: trasa `/api/assistant/*` → cluster `ai`. **docker-compose**: `ai-service` na sieci `frontend` (egress + `host.docker.internal` dla lokalnego modelu). **`.env`**: `AI_ENABLED/AI_BASE_URL/AI_MODEL/AI_API_KEY` (domyślnie OFF).
- **Frontend**: `components/AiTutor.tsx` (pływający czat), przycisk „🤖 Zapytaj AI o podpowiedź" na karcie zadania, `assistant.ts` (status + cache). Gdy AI OFF → UI chowa funkcje AI i działa bot heurystyczny.

### Jak włączyć
- **Lokalnie (Ollama):** `ollama pull llama3.2:3b`, w `.env`: `AI_ENABLED=true`, `AI_BASE_URL=http://host.docker.internal:11434/v1`, `AI_MODEL=llama3.2:3b` → `docker compose up -d --build ai-service gateway`.
- **Chmura:** `AI_ENABLED=true`, `AI_BASE_URL=https://api.openai.com/v1`, `AI_MODEL=gpt-4o-mini`, `AI_API_KEY=<klucz>`.
- **Obciążenie:** sprawdź po włączeniu `ps aux`/`docker stats` podczas pytania do AI (model liczy tylko na żądanie).

---
_Poniżej oryginalny plan (referencja)._

## 0. Po co to
Kryterium konkursu (`Requirements-for-lab.txt`): aplikacja **wspierająca edukację** + **element sztucznej inteligencji**.

- Edukacja — ✅ już spełnione (TrollNet uczy bezpieczeństwa webowego).
- AI — ❌ jeszcze nie: obecny „bot" to **lokalna heurystyka** (Levenshtein + regex), nie AI.

Ten plan dodaje **prawdziwy element AI**, nie zmieniając charakteru projektu.

> **Uwaga:** NIE trenujemy własnego modelu. Używamy gotowego, wytrenowanego modelu (lokalnie lub przez API). Zero trenowania, zero wiedzy ML.

---

## 1. Zasada naczelna: kod niezależny od dostawcy (pluggable runtime)

Całe AI przechodzi przez **jedną abstrakcję** — klienta gadającego ze standardem **OpenAI-compatible** (`POST /v1/chat/completions`). Dzięki temu ten sam kod działa z Ollama, OpenAI, llama.cpp, WebLLM-proxy itd. Runtime wybiera się **w konfiguracji**, bez zmian w kodzie.

```
Frontend ──▶ gateway ──▶ game-service ──▶ IAssistantClient ──▶ (BaseUrl z configu)
                                                               ├─ local: Ollama / llama.cpp
                                                               └─ cloud: OpenAI / zgodne API
```

**Fallback:** gdy AI nie jest skonfigurowane albo nie odpowiada → aplikacja wraca do obecnego bota-heurystyki. Aplikacja ZAWSZE działa, nawet bez AI.

---

## 2. Runtime AI — opcje (z myślą o „semi-desktop")

Ponieważ projekt ma trafić na semi-desktop, runtime musi być łatwy do spakowania. Opcje:

| Runtime | Prywatność | Obciążenie | Setup | Pod desktop |
|---|---|---|---|---|
| **Ollama (lokalny daemon)** | pełna (offline) | średnie (model 3B ~2–4 GB RAM, liczy na żądanie) | instalacja + `ollama pull` | wymaga instalacji/bundla Ollamy obok apki |
| **Chmurowe API (OpenAI/zgodne)** | słaba (dane wychodzą) | ~0 lokalnie | klucz API + internet | trywialne, ale dane małoletnich wychodzą |
| **llama.cpp (wbudowany serwer)** | pełna | średnie | spakować binarkę + model z apką | **najlepsze dla self-contained desktop** |
| **In-browser (WebLLM / transformers.js)** | pełna | w przeglądarce/webview (WebGPU), pobranie modelu ~1–2 GB | brak serwera/daemona | **świetne dla desktop/web — zero backendu AI** |

**Rekomendacja:** teraz zbudować **abstrakcję OpenAI-compatible** (punkt 1). Wtedy:
- na dziś dev → Ollama lokalnie albo klucz API (flip w configu),
- na semi-desktop → wybór między (a) **wbudowany llama.cpp/Ollama** lub (b) **WebLLM w webview** — decyzja przy pakowaniu, bez przepisywania logiki.

Decyzja o konkretnym runtime **nie blokuje** budowy — abstrakcja ją odracza.

---

## 3. Funkcje AI (Twój wybór: 1, 3, 4)

### 3.1 Tutor AI — adaptacyjne podpowiedzi
- Zastępuje/uzupełnia bota. Endpoint `POST /api/assistant/hint`.
- Wejście: `{ objectiveId, vector, mode, lastCommand?, lastError? }`.
- System-prompt: **sokratejsko, zwięźle, NIGDY nie podaje flagi**, dostosowuje się do trybu (w Wyzwaniu lżejsze podpowiedzi).
- **Guardrail twardy:** serwer NIGDY nie wysyła flagi do modelu — przekazuje tylko typ podatności + próbę gracza. Flaga fizycznie nie opuszcza serwera.

### 3.2 Czat „Zapytaj o bezpieczeństwo"
- Endpoint `POST /api/assistant/chat` (historia rozmowy).
- Panel czatu w aplikacji (w stylu paneli: panel + gradient tytułu + bevel; jak `ConfirmProvider`/terminal).
- Zakres: edukacja o bezpieczeństwie (CWE, alg:none, CSP, SQLi…). Odmawia tematów spoza zakresu i szkodliwych.

### 3.3 AI generuje treść
- Silnik gry (`GameEngineService`) opcjonalnie prosi AI o treść trollowych postów / opis zadania.
- Offline, z cache; **fallback do `ContentLibrary`** gdy AI niedostępne. Nie blokuje spawnu zadań.

---

## 4. Architektura i pliki (co powstanie)

### Backend (`game-service`, bez nowego serwisu na start)
- `Engine/Assistant/IAssistantClient.cs` — kontrakt (`HintAsync`, `ChatAsync`, `GenerateContentAsync`).
- `Engine/Assistant/OpenAiCompatibleClient.cs` — `HttpClient` → `BaseUrl/v1/chat/completions`, nagłówek `Authorization: Bearer <ApiKey>` (opcjonalny), timeout, retry, cancel.
- `Engine/Assistant/AssistantOptions.cs` — config (`Provider/BaseUrl/Model/ApiKey/Enabled/TimeoutSeconds`).
- `Engine/Assistant/PromptBuilder.cs` — system-prompty + **redakcja flagi**.
- `Endpoints/AssistantEndpoints.cs` — `/api/assistant/hint`, `/api/assistant/chat` (RequireAuthorization, rate-limit, timeout, fallback).
- DI + rejestracja w `Program.cs`.

### Gateway
- Nowa trasa `assistant` → cluster `game` (`/api/assistant/{**catch-all}`).

### Frontend
- `api.ts` — `assistantHint(...)`, `assistantChat(...)`; typy.
- `components/AiTutor.tsx` — panel czatu (styl aplikacji) + stan rozmowy.
- Wpięcie: przycisk „Zapytaj AI" na karcie zadania i/lub w bocie terminala; przy braku AI → stary bot heurystyczny.
- i18n PL/EN dla nowych stringów (wzorzec `pick/useLang`).

### Konfiguracja / `.env` / `docker-compose.yml`
```
ASSISTANT_ENABLED=true
ASSISTANT_BASE_URL=http://host.docker.internal:11434/v1   # Ollama lokalnie
ASSISTANT_MODEL=llama3.2:3b
ASSISTANT_API_KEY=                                         # puste dla Ollamy; klucz dla chmury
```
(dla chmury: `ASSISTANT_BASE_URL=https://api.openai.com/v1`, `ASSISTANT_MODEL=gpt-4o-mini`, `ASSISTANT_API_KEY=<klucz>` — klucz tylko w `.env` lokalnie, nigdy w repo).

---

## 5. Prywatność i bezpieczeństwo (przestrzeń z małoletnimi — zgodnie z zasadami org)
- **Domyślnie lokalnie** → dane NIE opuszczają maszyny.
- Do modelu nigdy nie trafiają: flagi, tokeny, dane osobowe. Tylko typ podatności + treść wpisana przez gracza.
- **Content-safety w system-prompcie:** asystent edukacyjny bezpieczeństwa; odmawia szkodliwych/pozatematycznych próśb; styl wspierający (ciekawość, szukanie rozwiązań).
- Rozmów z AI **nie zapisujemy** poza sesją.
- Rate-limit + timeout, żeby uniknąć nadużyć i zawieszeń UI.
- Jeśli wybrany runtime chmurowy — wyraźna informacja, że dane wychodzą do dostawcy (świadoma zgoda nauczyciela).

---

## 6. Kroki uruchomienia (dla każdego runtime)
**Lokalnie (Ollama):** zainstaluj Ollama → `ollama pull llama3.2:3b` → ustaw `ASSISTANT_*` → start. (Komendy mogę podać; w tej sesji instalację odpalisz przez `! ...`.)
**Chmura:** ustaw `BASE_URL` + `MODEL` + `API_KEY` w `.env` → start.
**Bez AI:** nic nie ustawiaj → działa bot heurystyczny (fallback).

---

## 7. Fazy wdrożenia
- **Faza 1 (PoC):** abstrakcja + tutor-podpowiedzi + czat Q&A + fallback. ⟵ tu zobaczysz efekt.
- **Faza 2:** generowanie treści przez AI (posty/opisy) z cache.
- **Faza 3 (przy pakowaniu desktop):** decyzja runtime — wbudowany llama.cpp vs WebLLM w webview.

---

## 8. Ryzyka i mitygacje
- *Słaba jakość małego modelu 3B* → dobre system-prompty; opcja większego modelu/chmury; fallback heurystyki.
- *Latencja / zawieszenie UI* → timeout + wskaźnik „AI myśli…" + fallback.
- *Wyciek flagi do modelu* → twarda redakcja po stronie serwera (flaga nigdy nie wysyłana).
- *Pakowanie desktop* → odroczone przez abstrakcję; rekomendacja WebLLM/llama.cpp.

---

## 9. Decyzje do potwierdzenia (zanim zacznę kodować)
1. **Runtime na pierwszy build:** Ollama lokalnie / klucz API / oba (przełącznik). *(Twoja uwaga: projekt idzie na semi-desktop — jeśli tak, rozważ WebLLM/llama.cpp w Fazie 3; na dev proponuję Ollama lub klucz.)*
2. **Gdzie kod AI:** w `game-service` (prościej) czy osobny `ai-service` (czyściej, ale więcej infra). Rekomendacja: `game-service` na start.
3. **Docelowa platforma desktop** (Electron / Tauri / inne) — wpływa na runtime w Fazie 3.
4. **Zakres pierwszego buildu:** sam tutor (PoC) czy od razu tutor + czat.

> Po Twojej akceptacji tego planu i odpowiedziach na p. 9 — zaczynam Fazę 1.

# TrollNet — opis funkcjonalności (na prezentację finałową)

**TrollNet** to gamifikowana aplikacja do **nauki bezpieczeństwa webowego** — parodia sieci społecznościowej („najprzyjaźniejszy most na infostradzie"), w której uczeń uczy się podatności, **realnie je wykorzystując** w bezpiecznym, lokalnym labie, z pomocą **asystenta AI**.

## Jak spełnia kryterium konkursu
- **Aplikacja wspierająca edukację** — uczy przez praktykę 15+ klas podatności z realnymi mechanizmami ataku i gotowymi lekcjami naprawy.
- **Element sztucznej inteligencji** — **🔮 Wyrocznia**: lokalny model językowy (`qwen2.5:3b`), który pełni rolę tutora i współtworzy treść. Działa **offline, na maszynie ucznia** — dane nie opuszczają komputera (ważne w pracy z osobami małoletnimi).

## Główne funkcje
- **Feed z zadaniami** — trendujące posty niosą zadania z licznikiem czasu; gracz zdobywa flagę, zanim „moderator" sprawdzi post. Pierwszy z poprawną flagą dostaje punkty.
- **Realne podatności do wykorzystania:** XSS (stored), SQL Injection, IDOR, SSRF, JWT `alg:none`, mass assignment, zaszyte dane logowania, brak uwierzytelnienia, wyciek danych i inne — każda z własną ścieżką exploitacji.
- **Dwa tryby (egzekwowane po stronie serwera):**
  - **Edukacja** — widoczne szablony poleceń i wyjaśnienia, punkty o połowę mniejsze, nieudane zadanie tylko zwiększa licznik.
  - **Wyzwanie** — bez podpowiedzi (zostają Wskazówki, dokumentacja API i terminal), pełne punkty, **4 oblane zadania kończą przebieg** i zapisują wynik.
- **Wbudowany terminal** (`curl`, `jq`, `base64`) — gracz wykonuje ataki wprost w aplikacji.
- **🔮 Wyrocznia (AI):**
  - **adaptacyjne podpowiedzi** — prowadzi sokratejsko i **nigdy nie zdradza flagi**,
  - **czat o bezpieczeństwie** — wyjaśnia pojęcia (CWE, `alg:none`, CSP…),
  - **generowanie treści** — tworzy świeże, „trollowe" posty w feedzie (z awaryjnym powrotem do treści statycznej).
- **Motyw trolowania** — zdobyty post zostaje „przejęty" (czerwony, 🔓 PWNED).
- **Dwujęzyczność PL/EN**, ranking, zakładka z mapą API i schematem bazy, pomoc kontekstowa.

## Architektura (skrót)
Mikroserwisy **.NET** (auth / social / game) za bramą **YARP**, frontend **React**, baza **PostgreSQL**, oraz **`ai-service`** mówiący standardem **OpenAI-compatible** do lokalnego modelu. Dzięki tej abstrakcji model można uruchomić lokalnie (Ollama / `llama.cpp`) albo w chmurze — **bez zmian w logice**. Jeśli AI jest niedostępne, aplikacja płynnie wraca do lokalnego bota heurystycznego — **zawsze działa**.

## Wartość edukacyjna i wychowawcza
Uczeń **uczy się przez działanie** w bezpiecznym środowisku, buduje postawę **ciekawości i poszukiwania rozwiązań**, a **Wyrocznia** wspiera go jak mentor — podpowiada kierunek zamiast podawać gotowca, dbając o rzeczywiste zrozumienie i zasady etycznego wykorzystania AI.

---
*Aplikacja działa lokalnie (wersja przeglądarkowa/kontenerowa; w przygotowaniu wersja binarna „semi-desktop" offline, z zapieczonym modelem). Instrukcje: `USAGE.md`, `RUN.md`, `BUILD.md`.*

# TrollNet — instrukcja korzystania

Jak grać i uczyć się w TrollNet. (Jak *uruchomić* aplikację — patrz `RUN.md`.)

## 1. Start
1. Uruchom aplikację i otwórz **http://localhost:8080**.
2. **Logowanie dzieje się automatycznie** — dostajesz konto gościa (np. `troll_48213`). Nic nie musisz zakładać.
3. (Opcjonalnie) „Sign in" u góry — potrzebne tylko do jednego zadania (konto admina).

## 2. Pasek górny
- **Zakładki:** Feed · Zadania · Wskazówki · API i DB · Ranking (· Dev, jeśli włączone).
- **Tryb:** przełącznik **Edukacja | Wyzwanie** + licznik oblań (`✗ n/4`).
- **Język:** przełącznik **PL | EN**.
- **Wynik:** liczba punktów; po prawej logowanie.
- **Prawy dolny róg:** **>_ Terminal** oraz **🔮 Wyrocznia** (asystent AI).

## 3. Tryby gry
| | **Edukacja** | **Wyzwanie** |
|---|---|---|
| Szablony i wyjaśnienia | widoczne | ukryte (zostają Wskazówki, API i DB, terminal, bot) |
| Punkty | o połowę mniejsze | pełne |
| Oblane zadanie | tylko licznik | **4 oblane = koniec**, wynik zapisany |

Przełączenie trybu **zeruje licznik oblań** i rozpoczyna świeży przebieg.

## 4. Jak zdobyć flagę (ogólny schemat)
1. Wejdź w **Zadania**, wybierz aktywne zadanie (ma licznik czasu).
2. Przeczytaj **„Jak przechwycić"** — opis metody + **szablon polecenia** (w trybie Edukacja).
3. **Uzupełnij luki** w szablonie (np. `<POST_ID>` numerem posta-celu z karty) i kliknij **„Załaduj do terminala"**.
4. Uruchom polecenie w terminalu, odczytaj flagę (`TROLL{...}`) i **wpisz ją w pole „TROLL{...}"** → **Wyślij flagę**.
5. Po zdobyciu post-cel zostaje „przejęty" (🔓 PWNED, czerwony).

Pomocne:
- **📌 (prawy górny róg karty)** — przypina zadanie na górze listy, żeby nie zgubiło się, gdy pojawią się nowe.
- **„Pomiń (poddaj się)"** — oznacza zadanie jako oblane (nie da się cofnąć).
- **„🔮 Zapytaj Wyrocznię o podpowiedź"** — adaptacyjna wskazówka (nigdy nie poda flagi).
- **„Potrzebujesz podpowiedzi? (#..)"** — otwiera dopasowaną Wskazówkę.

## 5. Szybkie wskazówki per podatność
- **XSS** (#02) — zadanie zalicza się, gdy **opublikujesz trwały ładunek** (np. `<img src=x onerror="window.__trollnetXss(ID)">`) i feed go wyrenderuje. Samo odczytanie flagi w konsoli nie wystarczy.
- **Wyciek danych** (#15) — `curl $API/api/objectives` albo otwórz tę ścieżkę w przeglądarce; znajdź pole `flag` dla swojego zadania.
- **Admin — zaszyte dane** (#16) — 4 ponumerowane komendy: wyciek loginu/hasła z `/api/auth/config` → logowanie → token → odczyt flagi.
- **Admin — `alg:none`** (#13) — zbuduj token (echo|base64), złóż `nagłówek.ładunek.` i otwórz skarbiec.
- **SSRF** (#06) — niech `link-preview` pobierze wewnętrzny skarbiec za Ciebie.
- **SQLi** (#01) — wstrzyknij warunek zawsze prawdziwy, by zrzucić ukrytą kolumnę.
- **IDOR / Missing Auth** (#03/#08) — odczytaj prywatną notatkę posta po jego numerze.
- **Mass assignment** (#04) — utwórz post z uprzywilejowanym polem; serwer odeśle sekret.

(Pełne wyjaśnienia „co/dlaczego/jak naprawić" — zakładka **Wskazówki**.)

## 6. Terminal
Komendy: `curl` (z `-X -H -d -G --data-urlencode -i`), `jq` (`.`, `.key`, `.[0]`, `.[]`), `base64 [-d]`, `echo`, `NAME=value` (zmienne, np. `$TOKEN`), `history`, `clear`, `help`. Potoki działają (`curl ... | jq ...`). `$TOKEN` to Twój token sesji (podstawia się sam). Przy błędzie **bot (🔮)** podpowie kierunek (zła komenda, 401/403, zły adres, niewypełniony placeholder).

## 7. 🔮 Wyrocznia (asystent AI)
- **Czat** (przycisk 🔮 w prawym dolnym rogu) — pytaj o pojęcia bezpieczeństwa (XSS, SQLi, CWE, `alg:none`, CSP…). Odpowiedź „wypisuje się" na żywo.
- **Podpowiedzi na kartach** — prowadzą do rozwiązania, **nie zdradzając flagi**.
- Działa po **polsku i angielsku** (zgodnie z przełącznikiem). Model jest lokalny — Twoje pytania nie wychodzą z maszyny. Gdy AI jest wyłączone, podpowiedzi daje lokalny bot heurystyczny.

## 8. Pozostałe zakładki
- **Wskazówki** — karty wszystkich podatności (prostym językiem: co, dlaczego działa, na co zwrócić uwagę, jak naprawić) z filtrem.
- **API i DB** — gotowa mapa endpointów i schemat bazy (rekonesans „za darmo").
- **Ranking** — najlepsi gracze.

---
*Wskazówka na pokaz: zacznij w trybie **Edukacja** (z szablonami), pokaż zdobycie 1–2 flag i czat z **Wyrocznią**, potem przełącz na **Wyzwanie**, by pokazać różnicę.*

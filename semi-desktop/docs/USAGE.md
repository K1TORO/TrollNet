# USAGE — instrukcja użytkownika TrollNet

TrollNet to grywalne laboratorium do nauki bezpieczeństwa webowego. W feedzie pojawiają się popularne posty;
każdy niesie zadanie z czasem. Zdobywasz **flagę** zadania (`TROLL{…}`), wykorzystując *podatność właściwą
danemu zadaniu*, a następnie przesyłasz ją na karcie, zanim moderator sprawdzi post.

## Początek

- Logowanie nie jest potrzebne — każde uruchomienie daje **gracza-gościa** z losową nazwą (np. `troll_48213`)
  i lokalnie pamięta Twój wynik.
- Język przełączasz w dowolnej chwili przełącznikiem **PL / EN** na górnym pasku.
- Dwa tryby (górny pasek):
  - **Edukacja** — pokazywane szablony i wyjaśnienia, punkty o połowę mniejsze. Najlepszy do nauki.
  - **Wyzwanie** — mniej podpowiedzi, pełne punkty, ograniczona liczba nieudanych prób.

## Zakładki

| Zakładka | Do czego służy |
|---|---|
| **Feed** | Feed społecznościowy. Popularne posty to aktywne zadania; możesz też publikować i komentować. |
| **Zadania** | Karty „capture-the-flag”: opis, odliczanie czasu, podpowiedź **Jak przechwycić** oraz przycisk **Uruchom w terminalu**. Zadanie można przypiąć na górze lub pominąć. |
| **Wskazówki** | Przystępne wyjaśnienia każdej klasy podatności (czym jest, dlaczego działa, jak naprawić). |
| **API i baza** | Endpointy API i schemat bazy danych — materiał referencyjny. |
| **Ranking** | Wyniki graczy. |

## Przechwytywanie flagi

1. Otwórz kartę w **Zadaniach** i przeczytaj **Jak przechwycić**.
2. Kliknij **Uruchom w terminalu** — wczyta dokładne polecenie do wbudowanego terminala dokowanego z boku.
3. Uruchom je, odczytaj wynik i skopiuj flagę `TROLL{…}`.
4. Wklej flagę w pole **Wpisz flagę** na karcie. Pierwsze poprawne zgłoszenie zdobywa punkty.

Niektóre zadania przechwytuje się inaczej — np. **Stored XSS** zalicza się, publikując ładunek, który
uruchomi się w feedzie, a nie przez wklejenie flagi. Karta zawsze wskazuje, jak dane zadanie zaliczyć.

## Wbudowany terminal

Zadokowany z boku strony, uruchamia `curl` wobec lokalnego API (plus `jq`, `base64`, `whoami`, historia oraz
`$TOKEN` dla Twojej sesji). Przycisk **Uruchom w terminalu** każdego zadania wstawia właściwe polecenie;
wiersze wyniku mają przyciski **kopiuj** / **kopiuj flagę**. Mały asystent komentuje błędne polecenia i
potwierdza, gdy pojawi się flaga.

## Wyrocznia (asystent AI)

Lokalny asystent-nauczyciel bezpieczeństwa, w rogu ekranu. Dwa sposoby użycia:
- **Zapytaj Wyrocznię o podpowiedź** przy otwartym zadaniu — jednozdaniowa wskazówka kierująca do właściwej
  *techniki* (nigdy nie podaje flagi).
- Otwórz panel **Wyroczni**, aby rozmawiać o pojęciach bezpieczeństwa (XSS, SQLi, SSRF, JWT/`alg:none`,
  CSP, CWE…).

Model działa w całości na Twoim komputerze — nic z tego, co wpiszesz, nie opuszcza maszyny. Pierwsza
odpowiedź jest wolniejsza, gdy model się ładuje. Jeśli Wyrocznia jest niedostępna, aplikacja korzysta z
wbudowanego asystenta heurystycznego.

## Nauczyciel / administrator

Konto nauczyciela **`admin` / `admin1234`** można zalogować z górnego paska; może ono ujawnić flagę dowolnego
zadania przez endpoint administratora — zapisane na stałe dane logowania są same w sobie jedną z lekcji.

## Reset

Usuń katalog `~/.local/share/TrollNet/`, aby wyczyścić graczy, wyniki i bazę gry oraz zacząć od nowa.

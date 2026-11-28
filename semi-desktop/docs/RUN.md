# RUN — uruchomienie TrollNet Desktop

Aplikacja jest samodzielna: po instalacji (lub uruchomieniu) działa w całości lokalnie — backend, baza danych
i model AI — **bez Dockera, bez .NET, bez Ollamy i bez połączenia z internetem**.

## Wymagania

- 64-bitowy Linux (x86-64). `.deb` jest dla Debian/Ubuntu/Kali; `.AppImage` jest niezależny od dystrybucji.
- ~2,5 GB wolnego miejsca na dysku i **~3–4 GB wolnej pamięci RAM** (model AI ładuje się do pamięci przy
  pierwszym użyciu).

## Wariant A — instalacja `.deb` (Debian/Ubuntu/Kali)

```bash
sudo dpkg -i TrollNet_0.1.0_amd64.deb
```
Następnie uruchom **TrollNet** z menu aplikacji (lub poleceniem `trollnet-desktop`).

## Wariant B — uruchomienie `.AppImage` (dowolny Linux)

```bash
chmod +x TrollNet_0.1.0_amd64.AppImage
./TrollNet_0.1.0_amd64.AppImage
```
Jeśli system nie ma FUSE, uruchom z flagą: `./TrollNet_0.1.0_amd64.AppImage --appimage-extract-and-run`.

## Pierwsze uruchomienie

- Otwiera się okno z napisem „Starting the local server…”, a po kilku sekundach ładuje się aplikacja.
- **Pierwsza** wiadomość do Wyroczni (🔮) zajmuje ~15–25 s, gdy model ładuje się do pamięci; kolejne są szybkie.
- Dane gracza (nazwa gościa, wynik, baza gry) są zapisywane w `~/.local/share/TrollNet/`.
  Usuń ten katalog, aby zacząć od czysta.

## Porty (tylko localhost)

Aplikacja nasłuchuje na `127.0.0.1:8080` (UI/API), `127.0.0.1:8081` (wewnętrzny) i `127.0.0.1:8090`
(lokalne AI). Jeśli port 8080 jest już zajęty przez inny program, najpierw go zamknij.

## Uwagi

- Aby zakończyć, zamknij okno — procesy backendu i AI zatrzymają się razem z nim.

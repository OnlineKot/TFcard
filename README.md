# 💳 TF CARD — bankowość mobilna (PWA)

Mobilna aplikacja bankowa w stylu Revolut. PWA instalowalna na ekran
początkowy iPhone/Androida, logowanie **kodem PIN**, panel administratora,
płatności **TF PAY** i subskrypcje **TF CARD PLUS / PRO**.
Dane synchronizują się między telefonami przez **Firebase**.

## ✨ Funkcje

- **Logowanie PIN-em** — klawiatura numeryczna (jak w prawdziwym banku)
- **Panel administratora** — ukryty: dotknij napisu **„TF CARD"** na ekranie
  logowania, potem wpisz PIN admina. Sterujesz wszystkimi kontami:
  uznawanie/obciążanie sald, zmiana planu, PIN-u, imienia, podgląd i usuwanie
- **TF PAY ⚡** — przelewy między kontami TF CARD
- **Karty 💳** — wirtualna karta, generowanie numeru
- **Subskrypcje ⭐** — `TF CARD` (free), `TF CARD PLUS` (14,99 zł/mc),
  `TF CARD PRO` (39,99 zł/mc). **Nadaje je administrator** — użytkownik wysyła
  prośbę o ulepszenie, admin zatwierdza jednym kliknięciem
- **Ulepszalna** — nowe wersje aplikacji wdrażają się i aktualizują
  automatycznie (service worker z auto-update)
- **PWA** — działa offline, instaluje się na ekran początkowy (iPhone/Android)
- **Brak startowej kasy** — nowe konta mają saldo 0 zł; pieniądze dodaje admin

## 🔑 Dane startowe

| Konto | PIN | Jak |
|-------|-----|-----|
| Użytkownik **Karol** | `1234` | wpisz PIN na ekranie logowania |
| **Administrator** | `0000` | dotknij napisu „TF CARD", potem wpisz PIN |

> PIN-y zmienisz w panelu admina (również PIN administratora).

## ☁️ Konfiguracja Firebase (sync na wielu telefonach)

Bez tego aplikacja działa lokalnie (tylko jeden telefon). Aby włączyć sync:

1. Wejdź na <https://console.firebase.google.com> → **Dodaj projekt**.
2. **Build → Realtime Database → Utwórz bazę danych** (lokalizacja
   `europe-west1`, tryb testowy na start).
3. **Project settings ⚙️ → Twoje aplikacje → Web (`</>`)** → zarejestruj
   i skopiuj `firebaseConfig`.
4. Wklej wartości do pliku [`firebase-config.js`](firebase-config.js)
   (najważniejszy `databaseURL`), zacommituj i wypchnij.

## 📱 Instalacja na iPhone

Otwórz stronę w Safari → **Udostępnij ⬆️** → **„Do ekranu początkowego"** →
**Dodaj**. Aplikacja pojawi się jak natywna (pełny ekran, ikona TF).

## 🌐 GitHub Pages

Wdrożenie automatyczne przez GitHub Actions
([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) przy każdym
pushu. Aktywacja: **Settings → Pages → Source: GitHub Actions**.
Adres: `https://<użytkownik>.github.io/TFcard/`.

## 🧱 Stos

Czysty HTML/CSS/JS (bez frameworków) + Firebase Realtime Database.
Brak kroku budowania — pliki statyczne.

> ⚠️ Projekt demonstracyjny. PIN-y przechowywane są jawnie w bazie — nie
> używaj prawdziwych danych ani pieniędzy.

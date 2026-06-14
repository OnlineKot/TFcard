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
- **Subskrypcje ⭐** — `TF CARD PLUS` (14,99 zł/mc) i `TF CARD PRO`
  (39,99 zł/mc) jako **dwie niezależne subskrypcje** (można mieć każdą osobno).
  **Nadaje je administrator** — użytkownik wysyła prośbę, admin zatwierdza
  jednym kliknięciem
- **Ulepszalna** — nowe wersje aplikacji wdrażają się i aktualizują
  automatycznie (service worker z auto-update)
- **PWA** — działa offline, instaluje się na ekran początkowy (iPhone/Android)
- **Brak startowej kasy** — nowe konta mają saldo 0 zł; pieniądze dodaje admin

## 🔑 Logowanie

| Konto | PIN | Jak |
|-------|-----|-----|
| **Administrator** | `951852` | dotknij napisu „TF CARD", potem wpisz PIN |
| Użytkownicy | — | zakłada je admin w **Kreatorze kont** (PIN 4–8 cyfr) |

Na start nie ma żadnych kont użytkowników — zaloguj się jako admin i utwórz je
w **Kreatorze kont** (imię, PIN, saldo startowe, subskrypcje PLUS/PRO).
PIN-y i PIN administratora zmienisz w panelu admina.

## ☁️ Firebase (sync na wielu telefonach)

Projekt: **tf-card**, baza: **Cloud Firestore**. Config jest już wpisany w
[`firebase-config.js`](firebase-config.js). Trzeba tylko **utworzyć bazę
Firestore** (jeśli jeszcze nie istnieje):

1. <https://console.firebase.google.com> → projekt **tf-card**.
2. **Build → Firestore Database → Utwórz bazę danych** → lokalizacja
   (np. `eur3`) → **tryb testowy** (na start, do testów).

Bez utworzonej bazy aplikacja działa lokalnie (localStorage, jeden telefon).

## 🔐 Bezpieczeństwo

- **Logowanie anonimowe (Firebase Auth)** — aplikacja loguje każde urządzenie
  anonimowo, a reguły Firestore wpuszczają tylko zalogowanych. Włącz w konsoli:
  **Authentication → Sign-in method → Anonymous → Włącz**.
- **Reguły Firestore** — skopiuj zawartość [`firestore.rules`](firestore.rules)
  do **Firestore Database → Rules → Opublikuj** (zastępują otwarty tryb testowy).
- PIN-y i PIN administratora (domyślnie `951852`) zmienisz w panelu admina.

> Uwaga: to aplikacja kliencka — pełne bezpieczeństwo danych wymagałoby
> backendu/Cloud Functions. Reguły + auth podnoszą poprzeczkę, ale nie używaj
> prawdziwych danych ani pieniędzy.

## 📊 Śledzenie (Firebase Analytics)

Włączone (`measurementId` z configu). Logowane zdarzenia:
`app_open`, `login`, `transfer`, `sub_request`, `sub_grant`, `account_create`.
Podgląd: **Firebase → Analytics → DebugView / Events**.

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

# 💳 TF CARD — aplikacja bankowa

Lekka, mobilna aplikacja bankowa (PWA-style) zbudowana w czystym HTML/CSS/JS.
Bez backendu — wszystkie dane przechowywane są lokalnie w `localStorage`
przeglądarki (demo / symulacja).

## ✨ Funkcje

- **Logowanie i rejestracja** użytkowników
- **TF PAY ⚡** — przelewy między kontami TF CARD oraz doładowania konta
- **Karty 💳** — wirtualna karta z numerem, generowanie nowego numeru
- **Subskrypcje ⭐**
  - `TF CARD` (STANDARD) — darmowy
  - `TF CARD PLUS` — 14,99 zł/mc (cashback 2%, wyższe limity)
  - `TF CARD PRO` — 39,99 zł/mc (cashback 5%, karta metalowa, doradca 24/7)
- **Panel administratora 🛡️** — zarządzanie użytkownikami: uznawanie/obciążanie
  sald, zmiana planu, usuwanie kont, statystyki

## 🔑 Konta testowe

| Rola  | Login           | Hasło      |
|-------|-----------------|------------|
| Admin | `admin`         | `admin123` |
| User  | `jan.kowalski`  | `demo`     |

## 🚀 Uruchomienie lokalne

Wystarczy otworzyć `index.html` w przeglądarce, lub:

```bash
python3 -m http.server 8000
# następnie otwórz http://localhost:8000
```

## 🌐 GitHub Pages

Aplikacja wdrażana jest automatycznie przez GitHub Actions
(`.github/workflows/deploy.yml`) przy każdym pushu.

**Aby aktywować Pages:** w repozytorium wejdź w
`Settings → Pages → Build and deployment → Source: GitHub Actions`.

Po wdrożeniu strona dostępna jest pod adresem:
`https://<użytkownik>.github.io/tfcard/`

> ⚠️ To projekt demonstracyjny — nie używaj prawdziwych danych. Hasła
> przechowywane są jawnie w `localStorage`, co jest niedopuszczalne w
> produkcji.

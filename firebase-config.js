/* =========================================================================
   KONFIGURACJA FIREBASE  —  wklej tutaj dane ze swojego projektu.

   Jak zdobyć (5 min, za darmo):
   1. Wejdź na https://console.firebase.google.com → "Dodaj projekt".
   2. W projekcie: Build → Realtime Database → "Utwórz bazę danych"
      → wybierz lokalizację (europe-west1) → tryb "test" (na start).
   3. Project settings (⚙️) → "Twoje aplikacje" → ikona Web (</>) →
      zarejestruj aplikację → skopiuj wartości z obiektu firebaseConfig
      i wklej je poniżej (najważniejsze: databaseURL).
   4. Zapisz plik, zacommituj i wypchnij — gotowe, sync działa na wszystkich
      telefonach.

   Dopóki widnieją tu wartości "PASTE_...", aplikacja działa lokalnie
   (localStorage, tylko na jednym telefonie) — żeby można było ją od razu
   przetestować.
   ========================================================================= */
window.FIREBASE_CONFIG = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT.firebaseapp.com",
  databaseURL: "https://PASTE_PROJECT-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "PASTE_PROJECT",
  storageBucket: "PASTE_PROJECT.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};

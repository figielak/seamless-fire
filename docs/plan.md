# NASA Space Apps 2026: plan projektu (wersja 3, Astro)

**Wyzwanie:** Harmonization of MODIS and VIIRS Hot Spots
**Projekt:** Seamless Fire · **Zespół:** Lone Pixel (solo)
**Wydarzenie:** NASA Space Apps Challenge Rzeszów 2026, 14–15 listopada
**Cel:** 1. miejsce lokalnie (5 000 zł) i projekt do portfolio

## 0. Twarde terminy i zasady (z regulaminu)

- **Start prac:** sobota 14.11, 10:00. Prace nad projektem wolno zacząć dopiero od startu (§3 ust. 5)
- **Koniec konkursu lokalnego: niedziela 15.11, 13:00.** O tej godzinie jury zaczyna obrady (§4 ust. 3–4)
- Zgłoszenie na stronie Space Apps otwiera się w sobotę o 9:00. Termin globalny (niedziela 23:59) nie dotyczy oceny lokalnej
- Wyniki: niedziela 16:00
- Zgłoszenie musi być **wysłane przed 13:00**, z zapasem
- Kod i analizy piszemy od nowa w trakcie wydarzenia. Wcześniejsze wnioski to wiedza, a nie gotowy produkt
- Przygotowanie przed startem (pobranie danych, środowisko, konta) jest dozwolone

## 1. Problem

Satelity od ponad 20 lat wykrywają punkty pożarów (hotspoty), ale zapis jest rozbity
na dwa instrumenty, których nie da się porównać wprost:

- **MODIS** (Terra od 2000, Aqua od 2002): piksel ok. 1 km, długi szereg, wycofywany w 2026–27
- **VIIRS** (S-NPP 2012 – 2.11.2026, NOAA-20 od 2018, NOAA-21 od 2023): piksel ok. 375 m,
  wykrywa znacznie więcej małych pożarów

Proste sklejenie szeregów dałoby sztuczny „wzrost” liczby pożarów w 2012 r.

**Produkt:** aplikacja webowa z kalendarzem aktywności pożarowej (od 2000 r. do dziś) dla
wybranego obszaru i zakresu dat, oparta na zharmonizowanych danych.
Odbiorcy: służby ratownicze, zarządcy terenów, naukowcy.
Pełny opis koncepcji: `koncepcja.md`.

## 2. Wymagania wyzwania (lista kontrolna)

- [ ] harmonizacja MODIS i VIIRS, tak aby sensor źródłowy przestał mieć znaczenie
- [ ] kalendarz aktywności pożarowej (lata × miesiące) od 2000 r. do dziś
- [ ] **wybór regionu**: lista krajów oraz prostokąt wpisany współrzędnymi
- [ ] **wybór zakresu dat**
- [ ] porównanie bieżącego miesiąca z medianą historyczną
- [ ] anomalie względem wielolecia
- [ ] dostępna skala kolorów (np. cividis lub viridis)
- [ ] **CSV z hotspotami** z danego wyszukiwania oraz CSV z danymi zagregowanymi
- [ ] pobieranie wykresów (wbudowany eksport PNG w Plotly)

## 3. Dane

| Dane                              | Zakres          | Status                    |
| --------------------------------- | --------------- | ------------------------- |
| MODIS, pliki krajowe              | 2000–2025       | ✅ PL, PT                  |
| VIIRS S-NPP, pliki krajowe        | 2012–2025       | ✅ PL, PT                  |
| VIIRS NOAA-20 (`jpss1`)           | 2018–2025       | ⬜ uzupełnić (potrzebny okres wspólny z S-NPP) |
| Pozostałe kraje (ES, GR, UA)      | 2000–2025       | ⬜ pobrać                  |
| 2026 (VIIRS S-NPP + NOAA-20, CSV) | 1.01–12.11.2026 | ✅ zamówienie w Archive Download |

**Kraje:** PL, PT, ES na pewno, GR i UA, jeśli zdążą się pobrać. Kanada odpada.
Kod piszemy ogólnie, a lista krajów to jedna zmienna.

**API FIRMS (odświeżanie):** odpada. Dane 2026 z Archive Download wystarczą.

Pułapki w danych:
- jawnie ustawiać `encoding` przy wczytywaniu CSV
- duplikaty plików z przeglądarki, np. `Poland(1).csv`: pomijać nazwy z „(”
- sprawdzić, czy dane 2026 mają kolumnę `type`
- przed publikacją sprawdzić rozmiar plików w repozytorium (limit GitHuba to 100 MB na plik)

## 4. Metoda (decyzje)

1. Filtr: `type == 0` (roślinność). W PL bez filtra ok. 3/4 detekcji VIIRS to przemysł.
   Rezerwa przy braku kolumny `type` (dane 2026): maska miejsc przemysłowych (siatka ok. 0,01°)
   zbudowana z lat 2012–2025
2. Miara: **komórko-dni**, czyli unikalne pary (komórka 0,1°, dzień) z pożarem;
   MODIS to Terra i Aqua razem
3. Format: w Pythonie komórka × dzień × sensor; na stronę trafia **komórka × miesiąc × sensor**
   (wystarczy do wyboru prostokąta i zakresu dat z dokładnością do miesiąca)
4. Skala docelowa: VIIRS S-NPP
5. Harmonizacja: **regresja log-log** `log1p(V) = a[pora roku] + b·log1p(M)`, osobno dla
   każdego kraju, kalibracja na latach 2012–2025. Model bez członu sezonowego (D) to przypadek,
   w którym wszystkie `a` są równe, więc strona obsługuje oba warianty jednym kodem.
   Dla krajów z małą liczbą pożarów wspólny model zapasowy
6. **Dowolny obszar:** przeglądarka najpierw sumuje surowe komórko-dni w prostokącie, a dopiero
   potem stosuje model. Regresja log-log nie jest addytywna, więc nie wolno sumować wartości
   zharmonizowanych osobno dla każdej komórki. Przy prostokącie mniejszym niż kraj widoczna
   uwaga o większej niepewności
7. Walidacja: leave-one-year-out (błąd roczny, log-RMSE), porównanie metod
   A (mnożnik globalny), B (mnożnik dla kraju), C (mnożnik kraj × miesiąc), D (log-log),
   E (log-log z członem sezonowym), test wsteczny
8. Lata 2000–2011: MODIS przeliczony modelem, przedział ok. 80% z odchylenia błędów
   walidacji (w skali log)
9. 2026: VIIRS S-NPP do 2.11, potem NOAA-20 × współczynnik policzony na latach 2018–2025
10. Anomalia: wygładzony stosunek `(x + k) / (mediana + k)`, mediana z ostatnich 10 pełnych lat.
    `k` zależy od skali obszaru (np. ułamek średniej mediany miesięcznej), a nie jest stałym 10,
    bo przy małym prostokącie 10 komórko-dni to bardzo dużo. Do tego percentyl miesiąca
    na tle tego samego miesiąca we wszystkich latach
11. Miesiące z danymi wstępnymi oznaczone w kalendarzu

## 5. Aplikacja (Astro, interfejs po angielsku)

### 5.1 Podział: Python liczy, Astro pokazuje

- **Python (lokalnie, `pipeline/`):** wczytanie danych, filtr, komórko-dni, harmonizacja,
  walidacja. Wynik to małe pliki JSON i CSV w `public/data/`
- **Astro i przeglądarka:** wczytuje pliki, filtruje obszar i daty, stosuje model, rysuje wykresy,
  generuje eksport. Strona statyczna, bez serwera
- **Hosting:** GitHub Pages (albo Netlify/Vercel). Strona statyczna nie zasypia, więc jury
  zobaczy ją od razu

### 5.2 Pliki danych (kontrakt Python → strona)

| Plik | Zawartość |
|---|---|
| `countries.json` | lista krajów: kod, nazwa, prostokąt kraju |
| `{kraj}/cells.json` | wiersze: komórka (indeks szer./dług. 0,1°), miesiąc, komórko-dni MODIS, komórko-dni VIIRS w skali S-NPP |
| `{kraj}/model.json` | parametry modelu (`a[4]`, `b`), niepewność z walidacji, współczynnik NOAA-20, wyniki porównania metod, udział odfiltrowanego przemysłu, data ostatnich danych |
| `{kraj}/hotspots/{rok}.csv` | hotspoty po filtrze (data, godzina, współrzędne, sensor, FRP) do eksportu |

### 5.3 Skrypt Pythona

1. Wczytanie plików z `data/raw/{KRAJ}/`, pominięcie nazw z „(”, rozpoznanie sensora po kolumnie
   `satellite`, a gdy jej brak, po nazwie pliku; usunięcie zduplikowanych wierszy
2. Filtr `type == 0` (albo maska przemysłowa dla danych bez `type`)
3. Komórko-dni dla każdego sensora (MODIS, S-NPP, NOAA-20)
4. Seria VIIRS: S-NPP do 2.11.2026, potem NOAA-20 × współczynnik
5. Walidacja metod A–E, wybór modelu, zapis parametrów i niepewności
6. Zapis plików z punktu 5.2

### 5.4 Strona

**Strona główna (wymagane):**
- wybór kraju, cztery pola prostokąta (W, S, E, N), gotowe przykłady (Podkarpacie, Biebrza,
  Algarve), zakres dat od–do (miesiąc i rok)
- **kalendarz** lata × miesiące (Plotly, skala cividis, kolory w skali logarytmicznej), lata
  2000–2011 oznaczone jako szacowane, miesiące wstępne zaznaczone
- **panel „Now”:** ostatni miesiąc na tle mediany i rozrzutu, percentyl
- **lista anomalii** (top 10)
- **eksport:** CSV z serią miesięczną, CSV z hotspotami w obszarze i zakresie dat,
  PNG wykresów (wbudowane w Plotly)

**Strona główna (mocne):**
- **przełącznik „raw / harmonized”** (sztuczny skok w 2012 r. i jego zniknięcie)
- **wykres roczny** z przedziałami niepewności dla lat 2000–2011
- **profil sezonu:** mediana i rozrzut dla każdego miesiąca, wybrany rok na tle
- **briefing obszaru:** zdania z szablonu (bez AI) na podstawie policzonych wskaźników

**Strona „Method”:** tabela porównania metod, wykres „przed i po” dla 2012 r., udział
odfiltrowanego przemysłu, ograniczenia.

**Opcjonalne:** mapa Leaflet z rysowaniem prostokąta, mapa komórek dla wybranego miesiąca.

### 5.5 Szczegóły techniczne

- czysty TypeScript w `<script>` komponentów Astro, bez Reacta (mniej konfiguracji)
- `plotly.js-dist-min`, ładowany raz
- ścieżki do danych przez `import.meta.env.BASE_URL` (wymagane przy GitHub Pages)
- dane zagregowane do komórka × miesiąc, żeby strona ładowała się szybko

**Gotowy przykład do demo:** Podkarpacie lub Bieszczady jako lokalny akcent dla jury
w Rzeszowie, do tego Biebrza 2020 i fale pożarów w Portugalii.

**Wdrożenie:** od razu po pierwszej działającej wersji, potem tylko aktualizacje.
Plan awaryjny: zrzuty ekranu i nagranie ekranu.

## 6. Zgłoszenie (wymagania)

**Strona projektu (wszystko po angielsku):**
- [ ] Project Name
- [ ] High-Level Project Summary
- [ ] Link to Project Demo (publiczny, bez logowania)
- [ ] Link to Final Project (strona na GitHub Pages i repozytorium GitHub, publiczne)
- [ ] Detailed Project Description: co robi, jak działa, korzyści, narzędzia
- [ ] Use of SI: LLM-y użyte do pisania kodu, nie do wymyślenia rozwiązania
- [ ] NASA Data: FIRMS (MODIS MCD14, VIIRS S-NPP/NOAA-20 375 m), z odnośnikami
- [ ] References: wszystkie biblioteki (pandas, numpy, Astro, Plotly, …) i źródła
- [ ] zrzuty ekranu aplikacji (JPG/PNG do 10 MB)
- [ ] zaznaczone oba checkboxy (Terms, Original Work), kliknięte „Submit for Judging”

**Demo: 7 slajdów (twardy limit, łącznie ze slajdem tytułowym), po angielsku:**
1. Tytuł: nazwa projektu, nazwa zespołu, imię i nazwisko, nazwa wyzwania
2. Problem: dwa sensory i sztuczny skok w 2012 r.
3. Pułapka: bez filtra 3/4 „pożarów” w PL to przemysł
4. Harmonizacja: porównanie metod, wybór na podstawie walidacji
5. Aplikacja: kalendarz i doświadczenie użytkownika (zrzut ekranu, przykład Podkarpacia)
6. Wynik: Biebrza 2020 i fale w PT widoczne niezależnie od sensora
7. Ograniczenia i przyszłość: niepewność 2000–2011, test wsteczny PT, koniec MODIS i S-NPP

**Repozytorium:**
- [ ] README po angielsku: opis, uruchomienie, metoda, źródła danych
- [ ] licencja open source (Apache 2.0)
- [ ] informacja o użyciu AI przy kodzie (README)
- [ ] brak zdjęć, nagrań i wizerunku osób poniżej 18 lat
- [ ] brak logo i elementów brandingu NASA w materiałach generowanych przez AI
- [ ] linki sprawdzone w oknie prywatnym

## 7. Kryteria oceny i odpowiedź projektu

Każde kryterium oceniane w skali 1–5:

| Kryterium | Jak projekt na nie odpowiada |
|---|---|
| Impact | jednolity obraz od 2000 r. dla służb i zarządców; przykład lokalny (Podkarpacie) |
| Creativity | model zależny od kraju i pory roku, filtr przemysłu, briefing w zdaniach |
| Validity | walidacja leave-one-year-out, porównanie metod, niepewność z walidacji, ograniczenia |
| Relevance | dane FIRMS jako rdzeń; spełnione wszystkie punkty wyzwania (pkt 2) |
| Presentation | 7 slajdów z jedną historią, przełącznik raw/harmonized jako oś demo |

## 8. Kolejność prac

**Przygotowanie**
- [x] pobrać brakujące dane: ES, GR, UA (MODIS 2000–2025, VIIRS S-NPP 2012–2025, NOAA-20 2018–2025)
- [x] konto na stronie Space Apps, zespół przypisany do wydarzenia w Rzeszowie
- [ ] repozytorium GitHub z włączonym GitHub Pages
- [ ] dokument ze zdjęciem na wydarzenie
- [x] środowisko Python: pandas, numpy
- [ ] środowisko Node: Astro, plotly.js-dist-min
- [x] kopia danych offline

**Etap 1: dane (Python)**
- wczytanie, filtr, komórko-dni
- `countries.json` i `cells.json` dla PL i PT

**Etap 2: harmonizacja (Python)**
- walidacja metod A–E, wybór modelu, `model.json`
- tabela i wykresy do strony „Method” i slajdów

**Etap 3: minimum strony i wdrożenie (Astro)**
- wybór kraju, kalendarz, panel „Now”
- **od razu wdrożenie na GitHub Pages**, sprawdzenie linku w oknie prywatnym

**Etap 4: dane uzupełniające (Python)**
- pozostałe kraje, dane 2026, pliki z hotspotami

**Etap 5: reszta wymagań (Astro)**
- prostokąt, zakres dat, eksport CSV, anomalie, wykres roczny

**Etap 6: elementy wyróżniające (Astro)**
- przełącznik raw/harmonized, profil sezonu, briefing, strona „Method”

**Etap 7: zgłoszenie**
- README, licencja, informacja o AI
- 7 slajdów, zrzuty ekranu, wypełniona strona projektu
- wysłanie z zapasem przed 13:00 w niedzielę

**Zasada priorytetów:** jeśli brakuje czasu, odpadają kolejno: mapa Leaflet → profil sezonu →
briefing → dane 2026 → kraje poza PL i PT. Zgłoszenie i działający link mają pierwszeństwo.

## 9. Ryzyka

| Ryzyko | Jak ograniczyć |
|---|---|
| Więcej pracy niż w Streamlit (drugi język, ręczny interfejs) | najpierw minimum z etapu 3 i wdrożenie, potem reszta |
| Błędne ścieżki na GitHub Pages | wdrożyć wcześnie, `BASE_URL` w ścieżkach, sprawdzić w oknie prywatnym |
| Duże pliki z hotspotami | podział na lata, sprawdzić limit 100 MB na plik |
| Ciężki Plotly (ok. 3,5 MB) | wersja `plotly.js-dist-min`, ładowana raz |
| Brak kolumny `type` w danych 2026 | maska miejsc przemysłowych z lat 2012–2025 |

## 10. Otwarte pytania

- czy GR i UA zdążą się pobrać?
- czy wariant z członem sezonowym (E) wygra w walidacji z D?
- przyczyna systematycznego błędu w teście wstecznym dla PT
- czy dane 2026 mają kolumnę `type`?

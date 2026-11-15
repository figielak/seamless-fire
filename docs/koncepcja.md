# Seamless Fire: koncepcja projektu

**Wyzwanie:** Harmonization of MODIS and VIIRS Hot Spots (NASA Space Apps Challenge 2026)
**Zespół:** Hot Spot (solo)

**W jednym zdaniu:** narzędzie, które z dwóch niespójnych zapisów satelitarnych robi jedną,
ciągłą historię pożarów od 2000 r. Pokazuje ją jako kalendarz z uczciwie zaznaczoną
niepewnością i odpowiada na pytanie: „czy to, co dzieje się teraz, jest normalne dla tego
miejsca i tej pory roku?”.

## 1. Problem

Służba ratownicza w marcu widzi na mapie FIRMS kilkadziesiąt hotspotów w swoim powiecie.
Z samych punktów na mapie nie wie:

- czy to dużo, czy typowo dla marca,
- czy podobnie było w latach 2003, 2012 albo 2020,
- czy coś się zmienia z dekady na dekadę.

Dziś odpowiedź wprost nie istnieje, z trzech powodów:

1. **Skok sensora.** VIIRS widzi kilka razy więcej pożarów niż MODIS (w testach w PL 4–5 razy).
   Każdy wykres sklejony z obu sensorów pokazuje fałszywy wzrost od 2012 r.
2. **Stosunek nie jest stały.** Zależy od kraju i od pory roku (w PL od ok. 3 w marcu do ok. 12
   w czerwcu), więc prosty mnożnik nie wystarcza.
3. **Szum przemysłowy.** W PL około 3/4 detekcji VIIRS to huty i elektrownie, które zawyżają
   statystyki i mylą przy szukaniu anomalii.

**Dlaczego teraz:** MODIS jest wycofywany, a S-NPP przestał przesyłać dane 2 listopada 2026.
Kto nie zharmonizuje zapisu dziś, straci ciągłość na dobre.

## 2. Architektura: trzy warstwy

### Warstwa A: silnik harmonizacji (rdzeń naukowy)

Przekształca surowe hotspoty w jeden szereg w „walucie VIIRS”:

1. **Czyszczenie:** zostają tylko detekcje roślinności (`type == 0`). Aplikacja pokazuje też,
   ile odfiltrowano, czyli jest przejrzysta, a nie ukrywa decyzji.
2. **Wspólna miara:** komórko-dni (komórka 0,1°, dzień). Wyrównuje różnicę rozdzielczości:
   jeden duży pożar to nie 50 pikseli VIIRS, tylko jedna komórka danego dnia.
3. **Model przejścia:** regresja log-log `log1p(VIIRS) = a + b·log1p(MODIS)` dla każdego kraju.
   Ponieważ stosunek zależy od pory roku, w walidacji warto sprawdzić wariant z **członem
   sezonowym** (osobno wiosna, lato, jesień i zima).
4. **Niepewność z walidacji:** przedział dla lat 2000–2011 liczony z błędów leave-one-year-out
   zamiast z góry przyjętych ±25%. Każda wartość przed 2012 r. ma uzasadniony zakres.
5. **Ciągłość po S-NPP:** przejście na NOAA-20 z korektą policzoną na wspólnym okresie
   2018–2025. To ten sam problem harmonizacji w mniejszej skali, który pokazuje, że metoda
   jest gotowa na kolejne zmiany sensorów.

**Wyjście:** jeden plik komórka × dzień z wartością zharmonizowaną, sensorem źródłowym
i przedziałem niepewności.

### Warstwa B: analityka (odpowiedzi na pytania użytkowników)

| Pytanie użytkownika | Wskaźnik |
|---|---|
| Kiedy w roku jest tu najwięcej pożarów? | profil sezonu: mediana i rozrzut dla każdego miesiąca |
| Które lata były najgorsze? | ranking lat, suma roczna z niepewnością |
| Czy ten miesiąc jest nietypowy? | stosunek do mediany, **percentyl** („2. najwyższy kwiecień od 2000 r.”) |
| Czy sezon się przesuwa? | początek, szczyt i koniec sezonu w każdym roku (np. dzień, w którym przekroczono 10% rocznej sumy) |
| Czy aktywność rośnie lub maleje? | trend wieloletni na danych zharmonizowanych, z uwagą o niepewności |
| Gdzie dokładnie się pali? | mapa komórek dla wybranego miesiąca |

Wskaźnik przesunięcia sezonu odpowiada wprost na tezę z opisu wyzwania, że zmienia się
charakter pożarów, i łączy się z hipotezą o zaniku wiosennego wypalania traw w Polsce.

### Warstwa C: aplikacja (produkt dla ludzi)

Ekran ma jedną ścieżkę: **wybierz obszar → zobacz historię → porównaj z teraz → pobierz.**

1. **Wybór obszaru:** kraj z listy, prostokąt ze współrzędnych albo gotowe przykłady
   (Podkarpacie, Biebrza, Algarve). Do tego zakres dat.
2. **Kalendarz pożarów** (główny widok): lata × miesiące, dostępna skala kolorów, lata
   2000–2011 oznaczone jako szacowane, miesiące wstępne zaznaczone.
3. **Przełącznik „surowe / zharmonizowane”:** jeden klik pokazuje sztuczny skok w 2012 r.,
   drugi pokazuje, że po harmonizacji znika. Najmocniejszy moment demo.
4. **Panel „Teraz”:** bieżący miesiąc na tle mediany i rozrzutu z historii, z percentylem.
5. **Briefing obszaru:** kilka zdań wygenerowanych z szablonu, bez AI, np.:
   > W kwietniu 2020 w tym obszarze wykryto 3,4 razy więcej aktywności niż mediana z lat
   > 2015–2024. To najwyższa wartość dla kwietnia od 2000 r. Sezon zaczął się 12 dni
   > wcześniej niż przeciętnie.
6. **Eksport:** CSV z hotspotami, CSV z szeregiem zharmonizowanym (z przedziałami), PNG
   kalendarza.
7. **Zakładka „Method”:** porównanie metod, walidacja, ograniczenia.

## 3. Użytkownicy i scenariusze

- **Komendant straży w Podkarpackiem, luty:** sprawdza profil sezonu i widzi, że od lat szczyt
  przypada na marzec i kwiecień (wypalanie traw). Planuje dyżury i kampanię informacyjną.
- **Dyrekcja Biebrzańskiego Parku Narodowego:** kalendarz pokazuje, że kwiecień 2020 był
  wyjątkowy na tle 25 lat, a nie tylko ostatnich 10. To argument w rozmowie o finansowaniu
  prewencji.
- **Naukowiec:** pobiera zharmonizowany szereg z przedziałami i nie musi sam rozwiązywać
  problemu sensorów.
- **Planista w Portugalii:** porównuje bieżący sierpień z medianą i od razu widzi, czy sezon
  jest powyżej normy.

## 4. Wyróżniki

1. **Harmonizacja wybrana na podstawie walidacji**, a nie założona z góry (4 metody, wybór
   na danych).
2. **Niepewność pokazana wprost**, a nie ukryta.
3. **Filtr przemysłu**, z liczbami, które zaskakują (3/4 detekcji VIIRS w PL).
4. **Odpowiedź w zdaniach**, a nie tylko wykresy (briefing obszaru).
5. **Gotowość na koniec sensorów:** ta sama metoda obsługuje przejście S-NPP → NOAA-20.

## 5. Powiązanie z kryteriami oceny

| Kryterium | Odpowiedź projektu |
|---|---|
| Impact | jednolita historia od 2000 r. dla służb i zarządców; przykład lokalny (Podkarpacie) |
| Creativity | model zależny od kraju i pory roku, filtr przemysłu, briefing w zdaniach |
| Validity | walidacja leave-one-year-out, porównanie metod, niepewność z walidacji, ograniczenia |
| Relevance | dane FIRMS (MODIS, VIIRS S-NPP, NOAA-20) jako rdzeń; wszystkie punkty wyzwania |
| Presentation | przełącznik surowe/zharmonizowane jako oś demo, konkretne scenariusze użytkowników |

## 6. Zakres w trzech poziomach

| Poziom | Zawartość |
|---|---|
| **Obowiązkowy** | warstwa A (bez członu sezonowego), kalendarz, panel „Teraz”, wybór obszaru i dat, eksport CSV, zakładka „Method” |
| **Mocny** | przełącznik surowe/zharmonizowane, percentyle, briefing obszaru, gotowe przykłady, niepewność z walidacji |
| **Dodatkowy** | człon sezonowy w modelu, przesunięcie sezonu, mapa komórek, rysowanie obszaru na mapie |

Poziom obowiązkowy spełnia wymagania wyzwania. Poziom mocny daje przewagę w ocenie
i jest tani, bo to głównie praca na danych, które i tak powstają. Poziom dodatkowy tylko
wtedy, gdy wszystko wcześniej działa i jest wdrożone.

> **Status: second opinion only, not followed.** Independent plan written by Codex without
> knowledge of our data or decisions. The project follows `CLAUDE.md` and `docs/plan.md`.
> Read it for ideas and blind spots; adopting anything that touches the method needs the
> user's approval (log it in `DECISIONS.md`).
>
> **Main differences from our plan**
> - Generic 48 h team plan (3–4 people, React + FastAPI + DuckDB backend). We are solo, 24 h,
>   static Astro site on GitHub Pages.
> - One demo region (Gran Chaco). We use country files (PL, PT, ES, GR, UA, AU).
> - Target scale MODIS (Terra only), `H = k × V`, linear, no intercept, hard sensor switch date.
>   We use VIIRS S-NPP scale, Terra+Aqua, log model with seasonal terms (D/E), MODIS → VIIRS.
> - 1 km equal-area grid. We use a 0.1° grid.
> - Fixed train/test split (later years as test). We use LOYO + backtest, compare A–E.
> - No industrial filtering (`type`). For us this is critical (PL ~73% of VIIRS is `type == 2`).
>
> **Ideas worth considering (not adopted)**
> - Calendar: show "no data" differently from zero; a text/tooltip version of the values.
> - Anomaly: leave the evaluated year out of its own baseline; no anomaly with < 5 baseline
>   years; no anomaly for a partial month ("Now" panel = last complete month).
> - Custom area: test the model on a few sub-areas before trusting it for rectangles
>   (relates to our point 7, "higher uncertainty" note).
> - A pass/fail gate fixed before validation (e.g. error reduction on held-out years).
> - Wording: a hotspot is not a fire; no burned area; anomaly is not a forecast.
> - 3-minute pitch outline (section 13).

# Seamless Fire — plan projektu na hackathon

## 1. Cel i założenia

Zbudować aplikację webową, która odpowiada na pytanie: **„Czy aktywność pożarowa w wybranym regionie i miesiącu jest nietypowa na tle jego historii?”**

Podstawą jest załączony opis wyzwania: połączenie historycznych detekcji MODIS z obserwacjami VIIRS, pokazanie sezonowości i anomalii w kalendarzu oraz umożliwienie pobrania wyników. Plan powstał niezależnie od istniejących materiałów w `.planning`.

Założenia organizacyjne, które można dostosować przed startem:

- Czas: 48 godzin, z przerwami i zamrożeniem funkcjonalności przed końcem.
- Zespół: 3–4 osoby; przy dwóch osobach ograniczamy zakres według sekcji 12.
- Demonstrator: jeden region z rzeczywistymi danymi, szerokim zakresem historycznym i okresem wspólnych obserwacji obu sensorów.
- Docelowo: historia od początku lat 2000 do ostatniego dostępnego okresu. Faktyczny zakres demonstratora wynika z pobranych i sprawdzonych danych, a nie z daty systemowej.
- Interfejs demonstracyjny po angielsku, dokumentacja projektu po polsku; nazwy produktów i jednostki spójne w obu językach.

**Warunek sukcesu:** użytkownik wybiera obszar, widzi wieloletni kalendarz, wskazuje nietypowy miesiąc, porównuje go z typowym sezonem i pobiera dane. Zespół potrafi pokazać na odłożonych danych, czy harmonizacja zmniejsza różnice między sensorami.

## 2. Użytkownik i wartość projektu

Głównym użytkownikiem jest analityk wspierający zarządzanie kryzysowe lub gospodarkę terenami. Potrzebuje szybko zorientować się, kiedy zwykle występuje zwiększona aktywność i czy ostatni dostępny okres odbiega od historii.

Przykładowa ścieżka:

1. Wybiera zapisany region albo rysuje prostokąt wewnątrz przygotowanego obszaru danych.
2. Ustawia lata i ogląda kalendarz: wiersze to lata, kolumny to miesiące.
3. Przełącza widok między aktywnością a odchyleniem od typowego miesiąca.
4. Wskazuje miesiąc; mapa i wykres sezonowy pokazują jego szczegóły.
5. Pobiera CSV z wynikami i źródłowymi hotspotami oraz obraz kalendarza.

Wyróżnikiem projektu jest **jawnie opisana i sprawdzona próba zapewnienia porównywalności w czasie**. Sama mapa hotspotów nie rozwiązuje problemu zmiany sensora.

Detekcja hotspotu nie oznacza osobnego pożaru. Jeden pożar może dawać wiele detekcji. Aplikacja nie będzie nazywać liczby hotspotów „liczbą pożarów”, wyliczać z nich powierzchni spalonej ani przedstawiać historycznej anomalii jako prognozy zagrożenia.

## 3. Zakres MVP

| Element | Zakres na hackathon | Kryterium odbioru |
| --- | --- | --- |
| Dane | Jeden region, MODIS i jedna wybrana platforma VIIRS, wieloletnia historia | Manifest źródeł, rzeczywisty zakres dat i raport kompletności pobrania |
| Harmonizacja | Wspólna siatka, agregacja do dni i miesięcy, prosta kalibracja regionalna | Wynik porównania przed i po korekcie na odłożonych latach |
| Wybór obszaru | Zapisany region i prostokąt ograniczony do obszaru danych | Zmiana obszaru aktualizuje wszystkie wyniki |
| Kalendarz | Macierz rok × miesiąc, aktywność i anomalia | Braki danych są odróżnione od zera, jednostka jest widoczna |
| Sezonowość | Wybrany rok na tle mediany i zakresu międzykwartylowego | Porównanie korzysta z tej samej metryki i obszaru |
| Mapa | Hotspoty zaznaczonego miesiąca | Widoczny sensor i legenda; ograniczona liczba renderowanych punktów |
| Eksport | CSV miesięczny, CSV hotspotów i PNG kalendarza | Pliki odzwierciedlają aktywne filtry i zawierają opis metody |
| Transparentność | Panel „Data & method” | Źródła, platformy, zakres kalibracji, walidacja i ograniczenia |

Poza MVP: globalny import całego archiwum, konta użytkowników, alerty operacyjne, predykcja pożarów, aplikacja mobilna, dowolne wielokąty, wykrywanie przyczyn pożaru, analiza strat i rozbudowane modele uczenia maszynowego.

## 4. Dane i pierwsza bramka decyzyjna

### Źródła

NASA FIRMS udostępnia archiwalne dane hotspotów oraz oddzielne zasoby dla ostatnich obserwacji. Historyczną serię pobieramy z archiwum; nie zakładamy, że endpoint najnowszych detekcji dostarczy całą historię. Archiwum zastępuje dane NRT produktami standardowymi, dlatego zapisujemy rodzaj i wersję produktu oraz datę pobrania. Źródła: [FIRMS Archive Download](https://firms.modaps.eosdis.nasa.gov/download/) i [FIRMS Active Fire Data](https://firms.modaps.eosdis.nasa.gov/content/active_fire/).

MODIS i VIIRS mają różną nominalną rozdzielczość detekcji, odpowiednio około 1 km i 375 m. To jedna z przyczyn, dla których ich surowych liczników nie należy bezpośrednio sklejać w szereg. Źródło: [legenda mapy NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/map/index.html).

### Wybór regionu

Pierwszy kandydat: ograniczony fragment środkowej Ameryki Południowej, np. obszar w Argentynie lub granicach Gran Chaco. To propozycja demonstracyjna, a nie założenie o potwierdzonej dostępności danych czy sile sezonowości.

W pierwszych czterech godzinach wybieramy region, dla którego uda się uzyskać:

- wieloletnie dane MODIS i wspólny okres z VIIRS;
- co najmniej pięć kompletnych lat wspólnych danych do prototypowej kalibracji i walidacji; preferowane osiem lub więcej;
- możliwy do przetworzenia lokalnie wolumen;
- kilka podobszarów do sprawdzenia, czy korekta działa również poza agregatem całego regionu.

Przed implementacją widoków potwierdzamy sposób pobierania, ewentualną autoryzację, strukturę plików, dostępne daty i ograniczenia wykorzystania. Jeśli dostęp do pełnego archiwum zajmie zbyt długo, zmniejszamy obszar geograficzny przed skróceniem historii.

### Kontrakt danych

Znormalizowany rekord detekcji zawiera co najmniej:

`source_id`, `sensor`, `platform`, `product_version`, `processing_type`, `acquired_at_utc`, `latitude`, `longitude`, `confidence_raw`, `quality_class`, `frp`, `daynight`, `source_file`.

Pola nieobecne w konkretnym produkcie pozostają puste. Nie dopisujemy sztucznych wartości. Manifest opisuje jednostki, mapowanie nazw pól i reguły filtrowania dla każdego produktu.

Pipeline:

1. Zachowuje niezmienione pliki wejściowe i ich sumy kontrolne.
2. Normalizuje daty do UTC, nazwy kolumn oraz identyfikatory sensorów i platform.
3. Odrzuca rekordy z niepoprawnymi współrzędnymi lub czasem; raportuje ich liczbę.
4. Usuwa duplikaty wynikające z ponownego importu tych samych rekordów. Nie traktuje dwóch prawidłowych obserwacji różnych platform jako błędu importu.
5. Stosuje jawne, właściwe dla produktu filtry jakości. Skale `confidence` MODIS i VIIRS wymagają osobnych reguł.
6. Nadaje identyfikator komórki siatki i agreguje obserwacje.
7. Zapisuje Parquet, manifest i raport jakości.

Brak rekordu nie dowodzi braku pożaru. Rozróżniamy kompletność pobranego archiwum od możliwości obserwacji powierzchni: same dane punktowe nie dostarczą pełnej informacji o zachmurzeniu, przelotach i niewykrytych zdarzeniach.

## 5. Harmonizacja: minimalna metoda, którą można zweryfikować

### 5.1. Co mierzymy

Zachowujemy dwa odrębne rodzaje wartości:

- **Surowa liczba detekcji** — rzeczywista liczba rekordów po opisanych filtrach, osobno dla sensorów. To licznik do kontroli i eksportu.
- **Harmonizowany wskaźnik aktywności** — oszacowana liczba aktywnych komórko-dni w skali referencyjnego MODIS. Może być ułamkowa i nie jest liczbą zaobserwowanych hotspotów.

Aktywny komórko-dzień oznacza, że w danej komórce siatki wystąpiła przynajmniej jedna zaakceptowana detekcja danego sensora w danym dniu UTC. Kilka detekcji tego samego sensora w tej komórce i dniu daje jedną jednostkę. Suma takich jednostek w miesiącu opisuje przestrzenną i czasową obecność wykrytej aktywności.

To świadomy kompromis: ogranicza wpływ liczby punktów, ale nie usuwa różnic czułości, godzin przelotu ani warunków obserwacji. Nie twierdzimy, że sama agregacja jest pełną harmonizacją.

### 5.2. Stabilne źródła i wspólna siatka

1. Wybieramy jedną platformę MODIS jako odniesienie; kandydatem jest Terra, po sprawdzeniu ciągłości archiwum.
2. Wybieramy jedną platformę VIIRS, na podstawie dostępności wspólnego okresu i zakresu danych demonstracyjnych.
3. Nie sumujemy bez kontroli kolejnych satelitów, ponieważ rozbudowa konstelacji może sztucznie zwiększyć liczbę detekcji.
4. Dla regionalnego MVP tworzymy siatkę 1 km × 1 km w odpowiednim układzie równopowierzchniowym; układ zapisujemy w metadanych. Rozmiar siatki jest parametrem metody, a nie deklaracją dokładności lokalizacji.
5. Oba produkty agregujemy identycznie do komórko-dni i następnie do miesięcy.

Siatka referencyjna i kalibracja dotyczą przygotowanego regionu. Ekspansja na inne regiony wymaga ponownej walidacji.

### 5.3. Korekta na wspólnym okresie

Dla każdego pełnego miesiąca wspólnych danych wyznaczamy:

- `M_t` — liczbę aktywnych komórko-dni MODIS;
- `V_t` — liczbę aktywnych komórko-dni VIIRS.

Najprostszy model to nieujemny współczynnik `k`, dopasowany tylko na latach treningowych przez minimalizację sumy `(M_t - k × V_t)²`, bez wyrazu wolnego. Jeśli suma `V_t²` jest zerowa lub dane nie spełniają minimalnych warunków jakości, model jest niedostępny.

Wynik dla okresu po przełączeniu źródła:

`H_t = k × V_t`

Wartość referencyjna przed przełączeniem:

`H_t = M_t`

Jedna konfiguracja określa datę przełączenia na początku pełnego miesiąca. W okresie wspólnym publikujemy jeden wybrany szereg, a równoległe obserwacje służą do walidacji. Nie dodajemy MODIS i VIIRS do siebie i nie wypełniamy luk innym sensorem bez oznaczenia zmiany źródła.

Model jest prostą kalibracją empiryczną, nie rekonstrukcją niewykrytych pożarów. Współczynnik i data przełączenia są wersjonowane. Nie dopasowujemy ich ponownie przy każdej zmianie filtra użytkownika.

### 5.4. Obszary wybierane na mapie

W MVP prostokąt użytkownika wybiera komórki według położenia ich środków. Mapa pokazuje wynikową maskę, aby przybliżenie granic było widoczne. Dla bardzo małego obszaru wyświetlamy komunikat o niewystarczającej skali analizy.

Ten sam regionalny współczynnik stosujemy do sumy komórko-dni wybranego podobszaru. Jest to założenie wymagające sprawdzenia na kilku podobszarach, a nie gwarancja lokalnej dokładności. Gdy walidacja przestrzenna zawiedzie, harmonizowany kalendarz ograniczamy do zweryfikowanych presetów, a swobodny wybór służy eksploracji surowych detekcji.

CSV hotspotów korzysta z tej samej maski komórek i zakresu czasu co analiza. Metadane podają zarówno żądany prostokąt, jak i faktycznie analizowaną maskę.

### 5.5. Walidacja i bramka jakości

- Dzielimy wspólne dane według pełnych lat: wcześniejsze do uczenia, co najmniej dwa późniejsze do testu. Nie losujemy sąsiednich miesięcy między zbiorami.
- Przed dopasowaniem zamrażamy testowe lata i podobszary.
- Porównujemy `V_t` oraz `k × V_t` z `M_t`, raportując MAE, średni błąd ze znakiem i zgodność sezonowego maksimum.
- Pokazujemy dwa proste wykresy: szeregi obu sensorów i rozrzut wartości przed/po korekcie.
- Sprawdzamy wynik w sezonie wysokiej i niskiej aktywności oraz w kilku podobszarach. Sam dobry wynik dla całego regionu nie wystarcza.
- Robimy małą analizę wrażliwości na wielkość siatki, np. 1 km i 2 km, o ile pozwala na to czas.

Proponowana bramka inżynierska: przynajmniej 15% redukcji MAE w testowych latach dla całego regionu, bez większego błędu systematycznego i bez pogorszenia MAE o ponad 10% w żadnym z trzech ustalonych podobszarów. Są to ustalone z góry kryteria demonstratora, nie naukowy standard ani obietnica wyniku. Przy zerowym błędzie bazowym oceniamy błędy bezwzględne zamiast procentów.

Jeśli bramka nie zostanie spełniona, pokazujemy dwa szeregi sensorów i wynik eksperymentu, bez etykiety potwierdzonej ciągłości. Taki wariant jest uczciwym demonstratorem, ale oznacza **niepełne wykonanie głównego celu wyzwania**. Nie ukrywamy tego na prezentacji.

Przedział międzykwartylowy historii opisuje zmienność aktywności, nie niepewność modelu. Pełna kwantyfikacja niepewności oraz korekta dostępności obserwacji pozostają rozszerzeniem po hackathonie.

## 6. Kalendarz, sezonowość i anomalie

Podstawowa jednostka czasu: miesiąc. Dzienne dane utrzymujemy w warstwie przetwarzania, aby możliwe były późniejsze rozszerzenia.

Dla każdego miesiąca roku wyznaczamy medianę i kwartyle z kompletnego, jawnie wybranego okresu bazowego. Preferujemy co najmniej dziesięć pełnych lat; przy mniej niż pięciu nie pokazujemy oceny anomalii. Z porównania wyłączamy oceniany rok.

Wartości w panelu szczegółów:

- aktywność w wybranym miesiącu;
- historyczna mediana tego samego miesiąca;
- różnica bezwzględna względem mediany;
- różnica procentowa, tylko gdy mediana jest większa od zera;
- percentyl empiryczny względem miesięcy bazowych, z podaną liczbą obserwacji;
- surowe liczniki MODIS i VIIRS jako osobne dane źródłowe.

Próg powyżej 90. percentyla może oznaczać „historycznie wysoka aktywność”. To opis pozycji w zbiorze porównawczym, nie prawdopodobieństwo pożaru ani operacyjny poziom alarmowy. Przy małej próbie zaznaczamy ograniczoną rozdzielczość percentyli.

Niepełnego ostatniego miesiąca nie porównujemy z całymi miesiącami poprzednich lat. W MVP oznaczamy go jako częściowy i wyłączamy jego ocenę anomalii; główne porównanie obejmuje ostatni pełny dostępny miesiąc. Porównanie „do tego samego dnia miesiąca” jest rozszerzeniem.

Zasady prezentacji:

- Sekwencyjna skala barw dla aktywności; rozbieżna, wycentrowana na zerze dla odchylenia.
- Bez zależności wyłącznie od rozróżniania czerwieni i zieleni.
- Puste lub kreskowane pole oznacza brak danych; zero ma własny, jednoznaczny opis „0 wykrytych aktywnych komórko-dni”.
- W obrębie jednego widoku wszystkie lata mają wspólną skalę, zamiast osobnego skalowania każdego wiersza.
- Tooltip, fokus klawiatury i tabela tekstowa udostępniają te same wartości.
- Zmiana sensora, lata bazowe i niepełne okresy pozostają widoczne.

## 7. Układ aplikacji

Jeden główny ekran, bez rozbudowanej nawigacji:

1. **Pasek filtrów:** obszar, lata, tryb aktywność/anomalia, jednostka i ostatnia dostępna data.
2. **Mapa:** wybór prostokąta i detekcje zaznaczonego miesiąca.
3. **Kalendarz:** główny element analityczny, z widocznym całym zakresem historii.
4. **Szczegóły miesiąca:** bieżąca wartość, mediana, odchylenie i wykres sezonowy.
5. **Eksport oraz „Data & method”:** dane, wizualizacja i krótki opis tego, jak powstał wynik.

Na węższym ekranie elementy układają się pionowo. Najpierw realizujemy czytelny widok desktopowy, który będzie używany w prezentacji. Interfejs musi mieć stany ładowania, braku wyników, obszaru poza pokryciem, błędu danych i niedostępnej kalibracji.

## 8. Architektura demonstratora

Proponowany zestaw, jeśli projekt nie ma już działającej infrastruktury:

| Warstwa | Propozycja | Uzasadnienie |
| --- | --- | --- |
| Frontend | React + TypeScript + Vite | Mała aplikacja, szybkie iteracje |
| Mapa | MapLibre GL JS | Warstwy punktowe i wybór obszaru |
| Wykresy | Apache ECharts | Kalendarz macierzowy, wykres sezonowy i eksport obrazu |
| Przetwarzanie | Python, pandas, PyArrow, pyproj | Import, agregacja i przygotowanie danych przestrzennych |
| API | FastAPI | Wspólna logika filtrów i eksportów |
| Przechowywanie | Parquet + DuckDB | Zapytania do regionalnego zestawu bez osobnego serwera bazy |
| Uruchomienie | Jeden backend z gotowym frontendem i lokalnymi plikami danych | Prosty deploy i możliwość pokazu offline |

Przepływ:

`FIRMS → import i kontrola jakości → siatka i komórko-dni → kalibracja → Parquet/DuckDB → API → mapa, kalendarz i eksport`

Cięższe obliczenia wykonujemy przed prezentacją. Zapytanie użytkownika filtruje gotowe agregaty; nie uruchamia pobierania archiwum ani uczenia modelu.

Minimalne zasoby API:

- `GET /api/metadata` — zakres pokrycia, daty, presety, wersja metody i wynik walidacji.
- `GET /api/calendar` — miesięczna aktywność, anomalia i status danych dla obszaru.
- `GET /api/seasonality` — przebieg wybranego roku i statystyki bazowe.
- `GET /api/hotspots` — punkty wybranego miesiąca, z limitem lub agregacją dla mapy.
- `GET /api/export` — pełny eksport miesięczny albo źródłowy zgodny z filtrami.

Każda odpowiedź analityczna podaje jednostkę, maskę obszaru, okres bazowy i wersję danych. Limit punktów na mapie nie ogranicza obliczeń ani pełnego eksportu. Ten fakt jest widoczny przy warstwie mapowej.

CSV miesięczny zawiera m.in. miesiąc, źródłowy sensor, surowy licznik, aktywne komórko-dni, harmonizowaną wartość, medianę, odchylenie, percentyl i status kompletności. Do eksportu dołączamy metadane z filtrami, źródłami, siatką i współczynnikiem kalibracji. CSV hotspotów zachowuje pochodzenie każdego rekordu i nie udaje zbioru „skorygowanych punktów”.

## 9. Harmonogram 48 godzin

| Czas od startu | Praca | Rezultat / bramka |
| --- | --- | --- |
| 0–4 h | Dostęp do danych, wybór regionu, kontrakt pól i metryk, szkic ekranu | Rzeczywista próbka obu sensorów; decyzja o wykonalnym zakresie |
| 4–12 h | Import historii, kontrola jakości, siatka; równolegle szkielet UI na oznaczonej próbce | Działający przepływ od danych do pierwszego kalendarza |
| 12–20 h | Kalibracja, testowe lata, walidacja podobszarów; API i spójne filtry | Raport harmonizacji i decyzja o sposobie prezentowania wyników |
| 20–30 h | Mapa, szczegóły miesiąca, sezonowość, anomalie i eksport | Pełna ścieżka użytkownika na rzeczywistych danych |
| 30–38 h | Integracja, brakujące stany, dostępność, testy i wydajność | Gotowy zakres MVP, bez nowych funkcji po 38 h |
| 38–44 h | Deployment, lokalny wariant demonstracyjny, opis metody, slajdy | Działający adres i sprawdzona kopia lokalna |
| 44–48 h | Próby prezentacji, nagranie zapasowe, poprawki blokujących błędów | Powtarzalne demo i komplet materiałów zgłoszeniowych |

To okna pracy całego zespołu, nie plan nieprzerwanej pracy pojedynczej osoby. Przerwy i przekazywanie kontekstu planujemy wewnątrz bloków.

Podział odpowiedzialności przy czterech osobach:

- **Dane i metoda:** import, harmonizacja, walidacja i ograniczenia naukowe.
- **Backend:** schematy, agregacje dla AOI, API, eksporty i uruchomienie.
- **Frontend:** mapa, kalendarz, wykres sezonowy i obsługa stanów.
- **Integracja i prezentacja:** test ścieżki, dostępność, dokumentacja, historia demonstracyjna i pitch.

Przy trzech osobach integrację i prezentację dzielimy między wszystkich. Kontrakt danych i jeden wspólny przykład zapytania ustalamy w pierwszych czterech godzinach, aby uniknąć późnego łączenia niezgodnych komponentów.

## 10. Testy i definicja ukończenia

Testujemy ryzyka merytoryczne i główną ścieżkę produktu, zamiast zwiększać liczbę testów bez potrzeby.

### Dane i obliczenia

- Powtórny import tych samych plików nie zmienia wyników.
- Kilka detekcji w tej samej komórce i dniu daje jeden aktywny komórko-dzień danego sensora.
- Miesiące na granicy roku i daty UTC agregują się prawidłowo.
- Przełączenie źródła nie sumuje nakładających się sensorów.
- Lata testowe nie trafiają do dopasowania współczynnika.
- Zerowa mediana, brak danych i częściowy miesiąc nie tworzą błędnych procentów ani fałszywych anomalii.
- API, kalendarz i eksport korzystają z tej samej maski przestrzennej i filtrów.

### Produkt i demonstracja

- Automatyczny test głównej ścieżki: wybór regionu → zmiana lat → miesiąc → pobranie CSV.
- Ręczne sprawdzenie legendy, klawiatury, tooltipów i pustego wyniku.
- Kontrola poprawności kilku miesięcy względem niezależnego przeliczenia danych wejściowych.
- Orientacyjny budżet: pierwszy użyteczny widok do 5 sekund, kolejne zapytanie do 2 sekund dla przygotowanego regionu. Mierzymy na sprzęcie i środowisku pokazu; zapisujemy warunki pomiaru.
- Próba uruchomienia bez dostępu do FIRMS. Dla mapy bez internetu zapewniamy lokalny obrys regionu, aby brak kafelków nie blokował analizy.

MVP jest ukończone, gdy działa cała ścieżka, eksport jest zgodny z ekranem, rzeczywiste źródła i ograniczenia są jawne, a demonstracja harmonizacji ma raport z odłożonych danych. Cel pełnej harmonizacji uznajemy za osiągnięty tylko po przejściu bramki z sekcji 5.

## 11. Ryzyka i reakcje

| Ryzyko | Wczesny sygnał | Działanie |
| --- | --- | --- |
| Trudny dostęp do archiwum | Brak rzeczywistych próbek po 4 h | Zmniejszyć region i sprawdzić oficjalną alternatywną ścieżkę dostępu; nie zastępować danych udawanym wynikiem |
| Zbyt duży wolumen | Import blokuje pracę nad prototypem | Przyciąć geograficznie, partycjonować pliki i preagregować |
| Korekta nie przenosi się między latami | Brak poprawy na odłożonym okresie | Pokazać oddzielne sensory i niespełnioną bramkę; zachować wynik eksperymentu |
| Korekta działa tylko dla całego regionu | Duży błąd w podobszarach | Udostępnić harmonizację tylko dla zweryfikowanych presetów |
| Braki wyglądają jak spadek aktywności | Nagły spadek równoległy do luki w plikach | Oznaczyć okres jako niedostępny i wyłączyć anomalię |
| Skok po zmianie satelity | Zmiana źródła lub składu konstelacji | Stały wybór platform; nowa platforma wymaga osobnej kalibracji |
| Punkty obejmują inne źródła ciepła | Utrzymujące się hotspoty o niejasnym charakterze | Wyjaśnić zakres produktu; nie klasyfikować automatycznie przyczyny |
| Problemy z siecią podczas oceny | Niedostępne API lub kafelki | Lokalny zestaw danych, obrys regionu i nagrany scenariusz |
| Przekroczenie czasu | Niedziałająca pełna ścieżka po 30 h | Uruchomić redukcję zakresu i zamrozić dodatki |

## 12. Kolejność redukcji i rozszerzania zakresu

Jeżeli czasu brakuje, usuwamy kolejno:

1. Eksport PNG, zachowując CSV.
2. Swobodne rysowanie prostokąta, zachowując zweryfikowane presety.
3. Szczegółową warstwę punktową mapy, zachowując granice AOI.
4. Dodatkowe regiony i optymalizację mobilną.

Nie usuwamy rzeczywistych danych obu sensorów, jawnych jednostek, walidacji, kalendarza ani informacji o brakach. Jeśli tych elementów nie da się dostarczyć, opisujemy wynik jako częściowy prototyp.

Po ukończeniu MVP można dodać, w tej kolejności:

1. Porównanie bieżącego miesiąca z analogicznym fragmentem miesięcy historycznych.
2. Drugi region i niezależną walidację przenoszenia metody.
3. Wielokąt AOI i sprawniejszą obsługę dużych zapytań.
4. Osobną kalibrację następnej platformy VIIRS.
5. Informację o dostępności obserwacji, bardziej szczegółowy model sezonowy i ocenę niepewności.

Każde rozszerzenie musi utrzymać działającą demonstrację i nie może przesunąć pracy nad prezentacją na ostatnie minuty.

## 13. Scenariusz prezentacji: około 3 minut

- **0:00–0:30 — problem:** długi zapis satelitarny pochodzi z różnych sensorów; wzrost liczby punktów może wynikać ze zmiany pomiaru.
- **0:30–1:10 — działający produkt:** wybór regionu, wieloletni kalendarz, wskazanie sezonu zwiększonej aktywności.
- **1:10–1:50 — pytanie użytkownika:** wybrany pełny miesiąc na tle mediany i rozkładu historycznego; eksport danych.
- **1:50–2:30 — dowód techniczny:** porównanie sensorów przed i po korekcie, rzeczywisty wynik na odłożonych latach, jednostka metryki.
- **2:30–3:00 — wartość i granice:** szybsze rozpoznawanie sezonowości i odchyleń; zakres zweryfikowanego regionu oraz następny krok rozwoju.

Miesiąc do pokazania wybieramy po analizie rzeczywistych danych. Nie zakładamy z góry, że znajdziemy rekordową anomalię ani że kalibracja osiągnie określony wynik.

## 14. Pakiet końcowy

- Działająca aplikacja oraz instrukcja lokalnego uruchomienia.
- Pipeline od plików FIRMS do danych aplikacji, z wersjonowaną konfiguracją.
- Manifest źródeł, licencji/atrybucji, dat pobrania i faktycznego pokrycia.
- Krótki opis metody, podział trening/test oraz raport walidacji z wykresami.
- Przykładowe eksporty zgodne z demonstracją.
- Slajdy i krótkie nagranie zapasowe.
- Lista ograniczeń i niewykonanych rozszerzeń, wyraźnie oddzielona od działających funkcji.

**Pierwsza rzecz do wykonania:** pobrać rzeczywiste próbki obu sensorów dla jednego regionu i policzyć wspólne miesięczne agregaty. Wynik tej próby rozstrzyga zakres danych, kalibrację i uczciwą obietnicę całego demonstratora.

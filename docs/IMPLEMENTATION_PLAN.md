# Chesscare plan implementacije

## MVP personalizirane analize - zavrsni opseg

Kriterij zavrsetka: korisnik moze ucitati vise PGN partija, povezati ih s
profilom, analizirati Stockfishem, spremiti rezultate, vidjeti ponavljajuce
slabosti, dobiti tri prioriteta i otvoriti dokaznu poziciju za svaki zakljucak.

- [x] Postojeci tok importa, migracije, profila, Stockfish poslova i spremanja
  rezultata potvrden je domenskim i UI testovima.
- [x] Definiran je minimalni read-only izlaz prioriteta: rang, konkretan opis,
  velicina uzorka, prosjecni gubitak i dokazne pozicije s partijom, plyjem,
  FEN-om te odigranim i preporucenim potezom.
- [x] Domenski izvjestaj izvodi najvise tri prioriteta iz ponavljajucih slabosti.
- [x] Personalizirani dashboard prikazuje prioritete i otvara dokaznu poziciju.
- [x] MVP regresija potvrduje cijeli tok od vise partija do dokazivih prioriteta.
- [x] Zavrsni testovi, lint i build prolaze.

## Pravila provedbe

- Svaka faza mora zadržati postojeće ponašanje dok nije pokrivena testovima.
- Migracije podataka moraju biti povratno kompatibilne i ne smiju brisati stare
  `localStorage` zapise.
- Domenska logika mora biti neovisna o Reactu, pregledniku i Stockfish workeru.
- Svaki rezultat analize mora navesti verziju enginea i postavke s kojima je
  nastao.
- UI se spaja na novi sloj tek nakon što su adapteri provjereni na stvarnim PGN
  primjerima.

## Faza 1: podatkovni model

### 1.1. Osnovni tipovi i validacija

- Uvesti verziju domenske sheme.
- Definirati dopuštene boje, rezultate, faze partije, statuse analize i vrste
  evaluacije.
- Uvesti zajedničke provjere obaveznih stringova, brojeva, datuma i enumeracija.

Provjera:

- Jedinični testovi prihvaćaju ispravne vrijednosti.
- Neispravni i nepotpuni podaci daju jasnu grešku.
- Model nema ovisnost o Reactu, DOM-u ili `localStorageu`.

### 1.2. Igrač

- Model `Player` s trajnim ID-em, prikaznim imenom i aliasima iz PGN zaglavlja.
- Normalizirati alias samo za usporedbu; sačuvati izvorni prikaz.
- Omogućiti kasnije spajanje više PGN imena u jedan profil.

Provjera:

- Duplikati aliasa ne ulaze u model.
- Razlike u velikim/malim slovima i višestrukim razmacima daju isti ključ.
- Vrijeme stvaranja i izmjene ostaje serijalizabilno.

### 1.3. Partija

- Model `Game` čuva izvorni PGN odvojeno od izvedenih metapodataka.
- Čuvati normalizirana zaglavlja, ID-eve bijelog i crnog igrača, rezultat,
  izvor importa i fingerprint sadržaja.
- Ne mijenjati izvorni PGN tijekom analize.

Provjera:

- Standardni i nepotpuni PGN headeri mogu se predstaviti modelom.
- Rezultat i veze prema igračima su validirani.
- Serijalizacija i ponovna izgradnja ne mijenjaju podatke.

### 1.4. Rezultati analize

- `AnalysisRun` predstavlja jedan ponovljiv posao analize.
- `MoveAnalysis` predstavlja rezultat jednog poteza.
- Evaluaciju spremati iz eksplicitne perspektive bijelog.
- Svaki potez povezati s partijom, analizom i, kada je poznat, igračem.

Provjera:

- Napredak analize ne može biti negativan niti veći od ukupnog broja pozicija.
- Završena analiza mora imati vrijeme završetka.
- Ply, boja, FEN, odigrani potez i evaluacije su validirani.

## Faza 2: adapteri za postojeće podatke

### 2.1. Adapter starog `savedGames` zapisa

- Pretvoriti `{id, title, pgn}` u novi `Game` bez promjene starog zapisa.
- Iz PGN headera izgraditi prijedloge igrača.
- Testirati adapter na jednoj i više partija, nedostajućim headerima te
  nestandardnoj početnoj FEN poziciji.

Provjera:

- Postojeći Import, Trening i Statistika i dalje čitaju stari format.
- Novi adapter daje isti naslov i PGN kao postojeći UI.

### 2.2. Repozitoriji

- Uvesti sučelja za igrače, partije, analize i rezultate poteza.
- Prvo napraviti `localStorage` implementaciju uz odvojene ključeve i verziju.
- Nakon provjere volumena prijeći na IndexedDB bez promjene domenskog API-ja.

Provjera:

- CRUD testovi nad memorijskim repozitorijem.
- Migracija je idempotentna.
- Prekid migracije ostavlja stare podatke čitljivima.

## Faza 3: izdvajanje postojećeg PGN ponašanja

### 3.1. PGN servis

- Izdvojiti dijeljenje višepartijskog PGN-a, `loadPgn`, generiranje naslova i
  izvoz zbirke.
- Sačuvati postojeće ponašanje importa prije bilo kakvog poboljšanja parsera.
- Dodati regresijske primjere za komentare, NAG oznake, varijante i `SetUp/FEN`.

### 3.2. Servis pozicije

- Centralizirati rekonstrukciju FEN-a po plyju.
- Poštovati početni FEN partije.
- Koristiti isti servis u Importu, Treningu i analizi.

Provjera:

- FEN svakog plyja odgovara izravnoj reprodukciji kroz `chess.js`.
- Grananje iz povijesne pozicije ne mijenja originalnu partiju.

## Faza 4: Stockfish servis i trajni poslovi

### 4.1. UCI/Worker adapter

- Izdvojiti pokretanje, handshake, slanje naredbi i parsiranje poruka.
- Dodati kontrolirano zaustavljanje, timeout i otkazivanje.
- Odvojiti live MultiPV analizu od batch analize partija.

### 4.2. Cache evaluacija

- Ključ cachea: FEN, engine, verzija, dubina i relevantne UCI postavke.
- Spremati rezultat nakon svake pozicije.
- Nastaviti nepotpunu analizu bez ponavljanja gotovih pozicija.

Provjera:

- Ponovljena analiza s istim postavkama koristi cache.
- Promjena dubine ili verzije enginea ne koristi nekompatibilan rezultat.
- Otkazivanje uredno završava worker i čuva dovršeni napredak.

## Faza 5: personalizirana agregacija

### 5.1. Identitet ciljnog igrača

- Korisnik bira vlastiti profil i potvrđuje PGN aliase.
- Svaki potez se veže uz profil prema boji u konkretnoj partiji.
- Neprepoznata imena ostaju nerazriješena, bez automatskog pogrešnog spajanja.

### 5.2. Izvedene metrike

- Agregirati po boji, fazi, otvaranju, rezultatu i vremenskom razdoblju.
- Prikazati veličinu uzorka uz svaki zaključak.
- Odvojiti sirove rezultate enginea od heuristika preciznosti i stila.

Provjera:

- Ručno izračunati mali skup partija daje iste agregate.
- Isti igrač pod dva potvrđena aliasa ima jedan profil.
- Protivnički potezi ne ulaze u osobnu statistiku.

## Faza 6: personalizirani trening

- Iz `MoveAnalysis` zapisa generirati trening pozicije.
- Čuvati izvorni FEN, odigrani potez, preporučeni potez, izvor partije i ply.
- Uvesti rezultat pokušaja i raspored ponavljanja.
- Povezati zadatak s izvornom partijom i analizom radi provjerljivosti.

Provjera:

- Rješavanje treninga ne mijenja spremljenu partiju.
- Ponovljena pogreška povećava prioritet odgovarajućeg motiva.
- Brisanje trening zapisa ne briše partiju ni rezultat analize.

## Faza 7: postupno spajanje UI-ja

Redoslijed:

1. Čitanje novog modela na zasebnom razvojnom prikazu.
2. Biblioteka partija preko repozitorija.
3. Status i nastavak analitičkih poslova.
4. Profil igrača i personalizirani dashboard.
5. Trening generiran iz spremljenih rezultata.
6. Tek nakon regresijskih provjera ukloniti stari put podataka.

Završna provjera svake UI etape:

- `npm run lint`
- `npm run build`
- ručni import jedne i više partija
- spremanje trenutačne i cijele zbirke
- ponovno učitavanje kartice
- učitavanje partije u Trening
- live Stockfish analiza
- batch Statistika analiza

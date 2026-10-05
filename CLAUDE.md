# Kedjebygget (tjänsteversion)

Lagneutral version av Kedjebygget som ska kunna användas av andra tränare. Utgår från
KTH-versionen i `C:\Users\felix\Desktop\LAGUPPSTÄLLNING HEMSIDA` (kopierad 2026-10-05). Den
versionen är tränarens skarpa verktyg och ska **inte** ändras härifrån — det här är ett separat projekt.

## Nuläge

Samma kod som KTH-versionen utan KTH-specifika delar (logga, kalenderfil, PowerShell/Node-synk).
Inget byggsteg, ingen backend. Öppna `index.html` direkt.

| Fil | Innehåll |
|---|---|
| `index.html` | Uppställningsvy, aktivitetsvy, närvaro- och exportdialog. |
| `styles.css` | All stil, färger som tokens på `:root`, mörkt läge. |
| `ics.js` | Kalenderparser (global `ICS`, eller `module.exports` i Node). |
| `app.js` | Applogik. Vanligt skript, **inte** ES-modul — moduler blockeras över `file://`. |

**localStorage-nyckeln är `kedjebygget-tjanst-v1`.** Sidor från `file://` delar lagring i Chrome;
KTH-versionen använder `kedjebygget-v1`. Byt aldrig till samma nyckel — då skriver apparna över varandra.

Laget ligger i `S.team = {name, logo, cal}`: `logo` är en data-URI (nerskalad till 400 px), `cal` är
normaliserad https-länk (`calUrl()`). Saknas `S.team.name` öppnas lagdialogen vid start och går inte att stänga.
`calUrl()` gör om lagets hemsida (`laget.se/<lag>`, `svenskalag.se/<lag>`) till kalenderflödet. Kalendern
hämtas med `fetch` vid varje start (`sync(true)`) och via "Hämta kalender"-dialogen; filimport finns kvar som reserv.

## Mål: testversion för 5–10 tränare (validering)

1. **Lagval vid första start**: lagnamn, egen logga (uppladdning → data-URI, se `KEDJE_LOGO`),
   kalenderlänk.
2. **Kalenderlänk**: tränaren klistrar in prenumerationslänken (eller bara lagnamnet för laget.se /
   Svenska lag). Appen hämtar vid varje start. `webcal://` → `https://`.
3. **"Tyck till"-knapp** till ett formulär.
4. Publiceras gratis (Netlify Drop / GitHub Pages). Data stannar i varje testares webbläsare.

Mät: använder de den 3 aktiviteter i rad utan påminnelse? Följ upp efter 1 och 3 veckor.

## Kalenderplattformar (testat 2026-10-05)

| Plattform | Flöde | CORS |
|---|---|---|
| laget.se | `https://cal.laget.se/<lag>.ics` | `Access-Control-Allow-Origin: *` → hämtas direkt i webbläsaren |
| Svenska lag | `https://cal.svenskalag.se/<lag>` (lagets URL-namn) | Saknas → kräver proxy |
| SportAdmin/Sportnik | `https://www.sportnik.com/group/<nr>/almanac/ics` | Saknas → kräver proxy |
| IdrottOnline | Har prenumeration/ICS enligt support, format ej verifierat | Okänt |
| Spond | Ingen publik länk — synkar via appen till telefonens kalender | Går inte |

Proxy-förslag: Cloudflare Worker (gratis), som bara hämtar från en vitlista av kalenderdomäner.
Tränaren skapar själv kontot.

Plattformsspecifikt att generalisera: typ (laget.se har `CATEGORIES`, andra kräver gissning — låt
tränaren ändra typ per aktivitet), samlingstid (`gatherOf` i `ics.js` är laget.se-format),
närvaroinklistring (`parseAttendance` är byggd för laget.se:s kallelselista).

## Domänregler (ärvda, viktiga)

- Femmor: en spelare har högst en plats totalt över alla femmor (`place()` enforcear).
- PP, BP, övertid, forcering: samma spelare får finnas i flera enheter, men inte två gånger i samma.
- Enheter räknas per uppställning via `unitsOf(set)`; övertid/forcering bara på match. Använd aldrig en fast lista.
- Positionsetiketter begränsar inte placering.
- Träningsexport: femmor heter bara sin färg (ingen rangordning), målvakter utan Start/Back-up.

## Längre sikt (efter validering)

Konton + molnlagring (EU), lag/roller, server-synk av kalender, GDPR (barns data i ungdomslag),
dela-länk till spelare, konfigurerbara enheter för andra sporter.

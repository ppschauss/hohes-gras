# Externe Einrichtung (Cloudflare + BotFather)

Bot: **@OtakupulsePokeBot** ("OtakuPulse Poké Game")
Geplante Domain: **poke.otakupulse.de**
Container-Port auf dem Unraid-Host: **3010**

## 1. Cloudflare Zero Trust — Public Hostname

Dashboard → **Zero Trust** → **Networks** → **Tunnels** → Tunnel `Unraid-Cloudflared-Tunnel`
→ **Configure** → Reiter **Public Hostname** → **Add a public hostname**

| Feld | Wert |
|---|---|
| Subdomain | `poke` |
| Domain | `otakupulse.de` |
| Path | *(leer lassen)* |
| Type | `HTTP` |
| URL | `192.168.0.161:3010` *(oder `172.17.0.1:3010`)* |

**Beides funktioniert** — nachgemessen aus dem laufenden cloudflared-Container:

```
172.17.0.1:3010     -> 200
192.168.0.161:3010  -> 200
```

`cloudflared` hängt in der normalen Docker-Bridge (172.17.0.8) und erreicht die Host-IP ganz
normal übers LAN. Nimm `192.168.0.161`, wenn du es konsistent zu deinen anderen Diensten halten
willst. `172.17.0.1` (das Gateway der Default-Bridge) hat nur zwei kleine Vorteile: der Weg
bleibt lokal statt über LAN und zurück, und er überlebt eine geänderte Host-IP.

⚠️ **Anders bei NPM:** der Nginx Proxy Manager läuft als macvlan-Container direkt am `br0`
(192.168.0.163). macvlan-Interfaces können ihren eigenen Elternhost per Design nicht erreichen —
von dort schlägt `192.168.0.161` fehl (gemessen: keine Antwort), `172.17.0.1` liefert 200. Für den
internen Namen `pokemon.internal` musst du daher `172.17.0.1:3010` eintragen.

Unter **Additional application settings** nichts umstellen; die Defaults passen (kein TLS zum
Origin nötig, weil die Strecke Container→Host lokal ist).

Der DNS-Record `poke.otakupulse.de` (CNAME auf `<tunnel-id>.cfargotunnel.com`, proxied) wird
beim Speichern automatisch angelegt. Falls schon ein Record `poke` existiert: vorher löschen.

## 2. Cloudflare — Einstellungen für diesen Hostnamen

**Speed → Optimization:** `Rocket Loader` muss **aus** sein. Er verschiebt Script-Ausführung und
bricht das Telegram-WebApp-SDK, das synchron vor dem ersten Paint laufen muss.
(Ist Rocket Loader zonenweit an, stattdessen eine Configuration Rule anlegen:
*If hostname equals `poke.otakupulse.de` → Rocket Loader: Off*.)

**Caching → Cache Rules → Create rule:**
- Name: `poke-api-no-cache`
- Wenn: `Hostname equals poke.otakupulse.de` **and** `URI Path starts with /api/`
- Dann: **Bypass cache**

Grund: Spielstand-Antworten dürfen nie aus dem Edge-Cache kommen, und die Live-Updates
(Server-Sent Events) vertragen keine Zwischenspeicherung.

Der statische Teil (`/assets/*`, Sprites) darf gecacht werden — dafür ist nichts zu tun,
Cloudflare macht das ab Werk anhand der Dateiendungen.

**Nicht nötig:** Cloudflare Access / WAF-Regeln. Der Zugang läuft über signierte
Telegram-Daten; eine zusätzliche Access-Policy würde die Mini-App aussperren, weil der
Telegram-Client kein Cloudflare-Login-Cookie mitbringt.

## 3. BotFather

Chat mit **@BotFather**, jeweils den Bot `@OtakupulsePokeBot` auswählen:

| Kommando | Eingabe | Wofür |
|---|---|---|
| `/setmenubutton` | Text `Spielen`, URL `https://poke.otakupulse.de` | Der Button unten links im Chat öffnet die Mini-App |
| `/setdomain` | `poke.otakupulse.de` | Verknüpft die Domain mit dem Bot |
| `/setinline` | Platzhalter z. B. `Trainerkarte teilen…` | Nötig ab P5 für die teilbare Trainerkarte |
| `/setdescription` | frei | Text im leeren Chat vor dem Start |
| `/setabouttext` | frei | Text im Bot-Profil |
| `/setuserpic` | Bild | Profilbild |

**`/setprivacy` bitte auf `Enabled` lassen** (Standard). Die Gruppen-Raids in P6 laufen über
Inline-Buttons, und Button-Klicks erreichen den Bot unabhängig vom Privacy-Modus. Er muss dafür
also nicht alle Gruppennachrichten mitlesen — weniger Rechte, gleiche Funktion.

`/setcommands` übernehme ich später automatisch aus dem Code, das musst du nicht tippen.

## 4. Was ich noch von dir brauche

**Deine numerische Telegram-User-ID** für `ADMIN_TELEGRAM_ID` in `secrets.env` — damit bist du
im Spiel Admin. Zwei Wege:
- @userinfobot anschreiben, er antwortet mit der ID, oder
- einfach `/start` an @OtakupulsePokeBot schicken, sobald der Container läuft — ich lese die ID
  dann aus dem Log und trage sie ein.

## Prüfen, ob es funktioniert hat

Sobald der Container läuft:
```
curl -s https://poke.otakupulse.de/api/health
```
Erwartete Antwort: `{"ok":true,...}`. Kommt stattdessen ein Cloudflare-Fehler 502/1033,
stimmt die Service-URL im Tunnel nicht.

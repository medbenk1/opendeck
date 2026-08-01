# Teams Contact (OpenDeck / OpenAction)

Plugin importable : cherche un contact Teams/Graph, affiche sa photo sur la touche,
**simple clic = chat**, **double clic = appel audio**.

## Installation

1. Copie le dossier `com.contactretriever.teams.sdPlugin` dans le repertoire plugins d'OpenDeck :
   - Linux : `~/.config/opendeck/plugins/`
   - macOS : `~/Library/Application Support/opendeck/plugins/`
   - Flatpak : `~/.var/app/me.amankhanna.opendeck/config/opendeck/plugins/`
2. Redemarre OpenDeck (ou reactive le plugin).
3. **Node.js >= 22** requis (WebSocket natif pour le plugin + capture CDP).

Aucune compilation. Dossier pret a l'emploi.

## Usage

1. Glisse l'action **Teams Contact** sur une touche.
2. Tokens (property inspector) — **voie par defaut** :
   - clique **Capturer via Chrome**
   - une fenetre Chrome (profil dedie) ouvre Teams ; connecte-toi si demande
   - tape un nom dans la barre de recherche Teams si le statut le demande
   - les 2 JWT sont enregistres automatiquement (~1 h)
3. Alternative : ouvre **Saisie manuelle** et colle les 2 tokens (procedure F12 ci-dessous).
4. Cherche un nom, clique un resultat → photo assignee a la touche.
5. **Clic** → chat · **Double clic** (~400 ms) → appel audio.

### Capture CLI (meme logique CDP)

```bash
cd plugins/com.contactretriever.teams.sdPlugin
node lib/grab_tokens.mjs
node lib/grab_tokens.mjs --timeout 300
node lib/grab_tokens.mjs --port 9223 --clone-profile
```

Ecrit `token.txt` + `skype_token.txt` dans le cwd. `--clone-profile` (Windows) copie cookies du profil Chrome habituel pour eviter un re-login.

## Tokens (~1 h)

| Source | `aud` attendu | Role |
|---|---|---|
| Graph / Substrate (Authorization) | `https://graph.microsoft.com` **ou** `https://outlook.office.com/search` | recherche |
| Cookie `authtoken` | `https://api.spaces.skype.com` | photo `profilepicturev2` |

### Alternative manuelle (F12)

1. Ouvre https://teams.microsoft.com , `F12` → Network, Preserve log.
2. **Recherche** : filtre Graph ou `substrate.office.com` → header `Authorization` → JWT apres `Bearer `
3. **Photo** : filtre `profilepicturev2` → Cookies → `authtoken` → JWT entre `Bearer=` et `&origin`
4. Verifie `aud` sur https://jwt.ms

`TEAMS_PART` (defaut `emea-02`) = segment dans `…/api/mt/part/<part>/…`.

## Compatibilite recherche

- Graph → `/me/people`, puis `/users` si vide
- Substrate (Powerbar) → suggestions People
- Audience inconnue → tente Graph puis Substrate

Photos : Teams `profilepicturev2` si token Skype, sinon Graph `/photo/$value`.

## Securite

Tokens = secrets de session. Stockes en clair dans les global settings OpenDeck.
Profil Chrome dedie : `%LOCALAPPDATA%/contact-retriever/chrome-profile` (Windows).
Ne pas committer. Expiration ~1 h.

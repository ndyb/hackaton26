# Hackaton26 — Skansen + Confluence Sync

## Arbeidsmodell

Prosjektet bruker **Agent of Empires (AoE)** på Titan. Hver Claude-sesjon får en egen git **worktree** med en Age of Empires-sivilisasjon som branchnavn (Saracens, Burmese, Wu, osv). Arbeid merges tilbake til main.

- **Repo:** `/home/aoe/hackaton26/` (main)
- **Worktrees:** `/home/aoe/hackaton26-worktrees/<Branch>/`
- **Deploy:** Docker-image bygges via GitHub Actions, deployes via titan-repoet
- **Produksjon:** hackaton.550141.xyz

Når du starter en ny sesjon: les denne filen, sjekk `git log --oneline -20` for siste arbeid, og sjekk `git diff main..HEAD` for hva din branch har/mangler.

## Prosjekter

### 1. Skansen — Norsk tale-til-tekst

Webapp for transkribering av norsk tale, med server-side og browser-side modeller.

- **Backend:** Python/FastAPI + pywhispercpp (whisper.cpp)
- **Frontend:** Vanilla JS, AudioWorklet for mikrofon, Transformers.js for browser-transkribering
- **Modeller:** Server bruker nb-whisper-medium (whisper.cpp), browser bruker nb-whisper-small-beta (ONNX direkte fra HuggingFace CDN)
- **Filer:** `main.py`, `static/`, `Dockerfile`, `.github/workflows/docker.yml`
- **Docker:** ghcr.io, tagget med git SHA + `latest`

### 2. Confluence Sync — Toveis Confluence/Markdown-synk

CLI-verktøy for å speile Confluence-spaces som lokale Markdown-filer med frontmatter. Inkluderer Jira CLI.

- **Backend:** Python, Atlassian Cloud API
- **Filer:** `src/confluence_sync/`, `tests/`
- **Kommandoer:** `auth`, `pull`, `push`, `status`, `jira list/show/create/comment/update`, `page list/get/create/update/delete`
- **Auth:** API-token, lagres i `~/.confluence-sync/config.yaml`

## Versjonering

Alle applikasjoner SKAL ha et synlig versjonsnummer.

- Git SHA bakes inn i Docker-imaget (`BUILD_SHA` build arg)
- `/api/health` returnerer `version` (git SHA)
- UI-en viser versjonen i footer
- Docker-image tagges med git SHA + `latest`

## Konvensjoner

- Norsk i UI og brukervendt tekst, engelsk i kode og commits
- Ingen secrets i kode eller Docker-image — alt via env vars eller volume mounts
- Python 3.11+, uv som package manager
- Proaktiv: ikke stopp og spør om neste steg er åpenbart — bare gjør det

## Kjente problemer / beslutninger

- **Browser-modell:** Hentes direkte fra HuggingFace CDN. Tidligere forsøk med lokal `/hf`-proxy feilet (path-mismatch med Transformers.js). Ikke gjeninnfør proxy uten skikkelig URL-rewriting.
- **AoE mangler SSH-nøkler:** Push fra containeren kan feile. Bruk HTTPS eller be Nick pushe manuelt.
- **Saracens-branch er bak main:** Mangler hele Confluence Sync, tester, Jira CLI, og Skansen-fixes. Trenger merge/rebase fra main.

## Prosjektstatus (2026-05-20)

- Skansen: fungerer i prod, TTS med Piper nylig lagt til
- Confluence Sync: MVP ferdig (pull, push, status, conflict detection, Jira CLI)
- Neste: se BRAINSTORMING.md for ideer

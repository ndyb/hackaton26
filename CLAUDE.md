# Skansen – Hackaton26

## Versjonering

Alle applikasjoner SKAL ha et synlig versjonsnummer slik at vi kan verifisere hvilken versjon som kjører i produksjon.

- Git SHA bakes inn i Docker-imaget ved bygg (`BUILD_SHA` build arg)
- `/api/health` returnerer `version` (git SHA)
- UI-en viser versjonen i footer
- Docker-image tagges med git SHA i tillegg til `latest`

## Arkitektur

- **Backend:** Python/FastAPI med pywhispercpp (whisper.cpp)
- **Frontend:** Vanilla JS, AudioWorklet for mikrofon, Transformers.js for browser-transkribering
- **Modeller:** Server bruker nb-whisper-medium (whisper.cpp), browser bruker nb-whisper-small-beta (ONNX)
- **Deploy:** Docker-image på ghcr.io, deployes via titan-repoet til hackaton.550141.xyz

## Konvensjoner

- Norsk i UI, engelsk i kode og commits
- Ingen secrets i kode eller Docker-image — alt via env vars eller volume mounts
- ONNX-modellfiler serveres fra /models-volume, ikke bakt inn i image

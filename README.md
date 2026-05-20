# Skansen – Norsk tale-til-tekst

Webapp som lytter på mikrofonen og transkriberer norsk tale til tekst ved hjelp av Whisper.

## Kjøring

```bash
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8765
```

Åpne http://localhost:8765 i nettleseren.

## Bruk

- Klikk "Ta opp" eller trykk mellomrom for å starte/stoppe opptak
- Transkripsjonen vises automatisk når opptaket er ferdig
- Klikk "Kopier" for å kopiere teksten til utklippstavlen

## Arkitektur

- **Backend:** Python/FastAPI med pywhispercpp (whisper.cpp-bindinger)
- **Frontend:** Vanilla JS med AudioWorklet for mikrofonopptak
- **Modell:** nb-whisper-medium (norsk Whisper, kvantisert q5_0)

## Fremtidige utvidelser

- Slack-integrasjon
- Jira/Confluence-integrasjon
- LLM-basert oppsummering og strukturering
- Sanntids-strømming av transkribering

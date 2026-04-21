# Security Notes

## Secrets

- Do not commit `.env` or any credential-bearing local config file.
- Rotate STT provider keys immediately if they are ever pasted into an issue, PR, or commit.
- Use `.env.example` as the only tracked configuration template.

## Audio And Transcript Data

- This bridge sends captured audio to the configured STT provider.
- Review provider retention, logging, and privacy settings before using real customer or private source code prompts.
- Debug WAV files are only written when `SAVE_DEBUG_WAV=1`.

## Local Session Data

- If you run with `SEND_TARGET=codex_exec`, Codex may persist its own session history in the current user's profile directory.
- This repository does not intentionally write credentials into the repo tree, but local tooling may keep per-user history outside the repository.

## Reporting

If you find a vulnerability, avoid posting raw secrets publicly. Rotate the affected secret first, then open an issue with a sanitized report.

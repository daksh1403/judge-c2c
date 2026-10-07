# Gemini and Groq review providers

Backend adapters support `AI_PROVIDER=gemini` with `GEMINI_MODEL`, and `AI_PROVIDER=groq` with `GROQ_MODEL`. Depth overrides use the corresponding `_MODEL_LIGHT` / `_MODEL_DEEP` fields. Provider keys are `GEMINI_API_KEY` and `GROQ_API_KEY`. Defaults shown in `.dev.vars.example` are starter model choices, not a claim that your account has access or sufficient quota.

Both providers receive only bounded read-only review context and an authoritative JSON schema as data. JSON output is parsed and validated locally against exact criterion IDs, evidence citations, objective statuses and claim grounding. Malformed/refused/truncated output stays unavailable. Calls use fixed HTTPS origins, no redirects, no tools, bounded timeout/body/output, at most two review attempts, and safe failure codes. Authentication/rate-limit failures stop without an immediate retry. Provider/model/usage are recorded. Gemini usage is normalized to the existing cost accounting format. No hidden provider fallback is configured; changing provider is explicit and cannot change authoritative criteria.

Store your two keys in an ignored private file, for example `.wrangler/ai-keys.json`, containing only `GEMINI_API_KEY` and `GROQ_API_KEY`. Set mode 600. Never paste the keys into chat, tracked files, frontend configuration or workflow inputs. Provision them with:

```sh
node scripts/configure-ai.mjs .wrangler/ai-keys.json .wrangler/production.json
```

This validates file permissions and sends values to Wrangler on stdin, never command arguments. It refuses preview/synthetic worker configurations. Keep keys for production distinct from any isolated review credentials. `organization:setup --provider gemini|groq --model <model> --provider-key-file <private-file>` supports provisioning an isolated event workspace with its explicitly selected provider.

Set production generator inputs `PRODUCTION_AI_PROVIDER=gemini` and `PRODUCTION_AI_MODEL=<available-model>` (or groq). Live diagnostics and reference/failing/protected-file calibration must pass before using the provider for event review. API key possession does not guarantee a free allowance, model access or throughput for 80 teams. AI remains advisory; it cannot supply missing execution evidence.

References: [Gemini JSON output](https://ai.google.dev/gemini-api/docs/structured-output), [Gemini GenerateContent](https://ai.google.dev/api/generate-content), [Groq JSON mode](https://console.groq.com/docs/structured-outputs), [Groq API](https://console.groq.com/docs/api-reference).

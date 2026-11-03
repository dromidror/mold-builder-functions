# Microsoft Foundry — Quota Increase Justification

**Date:** 3 NOV 2026
**Requestor:** ⟨Dror Dromi, Dromidror@yahoo.com⟩
**Azure subscription:** Azure subscription 1 (`644723f5-6f38-49e8-88b3-a534f2d49ac5`)
**Tenant:** Default Directory (`dromidroryahoo.onmicrosoft.com`, tenant id `df286cc3-e473-4dc9-a596-0c311dee9f5d`)
**Resource group:** `pottery_group`
**Region:** swedencentral

---

## 1. What is being requested

Exact answers for the Azure OpenAI / Foundry quota request form:

| Form field | Value |
|---|---|
| Quota Type | Model Deployment (PTU/RPM/TPM) |
| Quota Request Type (deployment type) | **Global Standard** |
| Model | gpt-5-mini (deployed in swedencentral; GlobalStandard had 500 kTPM available — no increase needed) |
| Metric | Chat model → **kTPM** (tokens-per-minute, in thousands) |
| Current quota (kTPM) | ⟨from your Quotas page — likely 0 for a new deployment⟩ |
| **Total required quota (existing + additional)** | **50** kTPM |

> The form asks for the **TOTAL** kTPM you want to end at, not the increase. If your current quota
> is 0, total = 50. If you already hold some, enter current + additional. Confirm the current value
> on the Foundry/Azure portal Quotas page before submitting.

---

## 2. Business purpose

The quota supports a single, well-scoped production feature: the **in-app help assistant** in the
Pottery Wheel application (Android and macOS). A persistent search bar lets a user type a question
or problem and receive a concise, accurate answer drawn from the product's own documentation,
tailored to what the user is doing at that moment.

This is **retrieval-augmented generation (RAG)**, not an open-ended chatbot:

1. The user's question is matched against the product documentation using **Azure AI Search**.
2. The top passages, plus lightweight context (the current screen, the object being designed, and
   the user's recent questions), are sent to the Foundry model.
3. The model returns a short answer grounded strictly in those passages.

The model is used only to phrase a grounded answer from supplied text. There is no image
generation, no long-form content generation, and no autonomous agent behavior.

## 3. Why the current quota is insufficient

⟨Choose what applies:⟩
- The default quota for ⟨model⟩ in ⟨region⟩ is ⟨0 / very low⟩, which does not allow a production
  deployment to be created or to serve real traffic.
- Expected concurrent usage at launch exceeds the default TPM, causing `429` throttling that would
  degrade the help experience for end users.

## 4. Expected usage and how the request was sized

**Request shape (measured/estimated per help question):**
- Input tokens: ~⟨1,500⟩ — system prompt + 3–5 retrieved doc passages + user context + question.
- Output tokens: ~⟨350⟩ — a short, capped answer (the service caps completion at 500 tokens).
- Total: ~⟨1,850⟩ tokens per request.

**Volume:**
- Expected active users: Fue.
- Help questions per active user per day: ⟨e.g. 2⟩.
- Peak concurrency (busiest minute): ⟨e.g. 10⟩ simultaneous questions.

**Sizing calculation (replace with your figures):**
- Peak load ≈ ⟨10 questions/min⟩ × ⟨1,850 tokens⟩ ≈ **⟨18,500⟩ TPM**.
- Requested **⟨50K⟩ TPM** adds headroom for bursts and growth over the next ⟨6–12⟩ months.

## 5. Architecture and controls (responsible use)

- **Grounded, bounded:** answers are generated only from retrieved product documentation; the
  completion length is capped and temperature is low (0.2) for deterministic, factual responses.
- **Authenticated:** every request requires a valid signed-in session (a JWT verified server-side
  by the Azure Function). The model endpoint and key are never exposed to client apps.
- **Server-side only:** all model calls originate from the `pottery` Azure Function App in
  `pottery_group`; keys are stored in Function App settings, not in source or client binaries.
- **Abuse surface is small:** input is a single short question (length-limited); the feature cannot
  be used to generate arbitrary content.
- **Content safety:** ⟨default Foundry content filters remain enabled⟩.

## 6. Resources involved

| Resource | Type | Resource group | Purpose |
|---|---|---|---|
| ⟨pottery-ai⟩ | Azure AI Foundry (AIServices) | `pottery_group` | Hosts the chat model deployment |
| ⟨pottery-docs-search⟩ | Azure AI Search | `pottery_group` | Documentation retrieval (RAG) |
| `pottery` | Azure Function App (Node 22) | `pottery_group` | Backend; calls Search + the model |

## 7. Timeline

- Current stage: ⟨development / pre-launch⟩.
- Target production date: 1-JAN-2027.
- Requested quota needed by: Dror Dromi.

## 8. Contact

⟨Name, email, phone (optional)⟩ — available for any follow-up questions on this request.

# Dynamic Help — backend setup

Adds two endpoints to this Function App, used by the Pottery Wheel app's top search bar:

- `POST /api/docs/ask` — an Azure AI Foundry (OpenAI) answer grounded in the docs (Azure AI
  Search), tailored to the user's in-app context. Requires a valid session (same bearer token as
  `auth/me`).
- `GET /api/docs/suggest?q=…` — type-ahead suggestions from the docs index.

Code: `docsFunctions.js` (HTTP + auth) → `docsSearch.js` (retrieval + LLM). The docs corpus is the
MkDocs content in the `pottery-wheel-docs` repo, indexed by `tools/index-docs.mjs`.

All values below are examples; substitute your own. Nothing secret belongs in source or in the app
— keys live only in the Function App's settings. Region matches the app (`israelcentral`); use a
region where your Foundry model is available (swap `AOAI_LOCATION` if needed).

## 1. Provision Azure AI Search

```bash
RG=pottery_group
SEARCH=pottery-docs-search            # must be globally unique

az search service create \
  -g $RG -n $SEARCH \
  --sku basic --location israelcentral

SEARCH_ENDPOINT="https://$SEARCH.search.windows.net"
# Admin key — for indexing only (tools/index-docs.mjs):
SEARCH_ADMIN_KEY=$(az search admin-key show -g $RG --service-name $SEARCH --query primaryKey -o tsv)
# Query key — for the Function App (read-only):
SEARCH_QUERY_KEY=$(az search query-key list -g $RG --service-name $SEARCH --query "[0].key" -o tsv)
```

## 2. Provision Azure AI Foundry + deploy a chat model

Azure AI Foundry (an `AIServices` resource) is Microsoft's current home for OpenAI models; it
exposes the same `/openai/deployments/.../chat/completions` API the function calls, so no code
changes — you only copy the endpoint it hands you into `AOAI_ENDPOINT`.

> **Model note:** the GPT-4o / GPT-4.1 family (including `gpt-4o-mini`) is deprecated and Foundry
> blocks new deployments of it. Deploy a current **GPT-5 family** chat model instead — a small/cheap
> variant (e.g. **`gpt-5-mini`**) is plenty for short, grounded help answers. The code only cares
> about the *deployment name* you choose, not the model. Which exact GPT-5 model you can deploy
> depends on what has quota in your region (see 2a below) — in this subscription's `swedencentral`,
> `gpt-5-mini` (GlobalStandard) had quota while `gpt-5.4-mini` GlobalStandard was 0.

```bash
AOAI=pottery-ai                       # must be globally unique
AOAI_LOCATION=swedencentral           # a region offering a GPT-5 model for your subscription

# Azure AI Foundry (AIServices) resource
az cognitiveservices account create \
  -g $RG -n $AOAI \
  --kind AIServices --sku S0 --location $AOAI_LOCATION \
  --custom-domain $AOAI --yes

# 2a. Find a model+SKU that actually HAS quota in this region. A new subscription often has 0
# quota for the newest models on some SKUs, which fails deployment with InsufficientQuota.
# This lists your real-time (non-Batch, non-finetune) GPT buckets and their limits:
az cognitiveservices usage list -l $AOAI_LOCATION \
  --query "[?contains(name.value,'gpt')].{bucket:name.value, limit:limit, used:currentValue}" -o table
# Pick a row with limit > 0 that is GlobalStandard (or Standard) and a current GPT-5 model.
# (In swedencentral this subscription had OpenAI.GlobalStandard.gpt-5-mini = 500 kTPM.)

# 2b. Confirm the exact version string the resource accepts for that model:
az cognitiveservices account list-models -g $RG -n $AOAI \
  --query "[?name=='gpt-5-mini'].{name:name, version:version, format:format}" -o table

# 2c. Deploy it. DEPLOY_NAME is yours to choose; use the model+version from 2a/2b.
# Tip: retype this fresh — don't leave a placeholder like <version> on the line.
DEPLOY_NAME=help-chat
az cognitiveservices account deployment create \
  -g $RG -n $AOAI \
  --deployment-name $DEPLOY_NAME \
  --model-name gpt-5-mini --model-version "2025-08-07" --model-format OpenAI \
  --sku-name GlobalStandard --sku-capacity 10

AOAI_ENDPOINT=$(az cognitiveservices account show -g $RG -n $AOAI --query properties.endpoint -o tsv)
AOAI_API_KEY=$(az cognitiveservices account keys list -g $RG -n $AOAI --query key1 -o tsv)
echo "$AOAI_ENDPOINT"   # whatever this prints is your AOAI_ENDPOINT app setting
echo "$DEPLOY_NAME"      # this is your AOAI_DEPLOYMENT app setting
```

Notes:
- `AOAI_DEPLOYMENT` is the **deployment name** you chose (`help-chat` above), not the model name.
- The endpoint host for a Foundry resource may be `https://<name>.openai.azure.com`,
  `https://<name>.cognitiveservices.azure.com`, or `https://<name>.services.ai.azure.com`. Use
  exactly what the `echo` above prints — the function appends `/openai/deployments/...` to it.
- You can also create the resource and deployment in the [Azure AI Foundry portal](https://ai.azure.com)
  (Deployments → Deploy model), then read the endpoint/key from the resource.
- **API version:** GPT-5 models may need a newer `AOAI_API_VERSION` than the default
  (`2024-10-21`). If an `ask` call returns a model/version error, set `AOAI_API_VERSION` to a
  current GA version from your resource's API reference — this is an app setting, no code change.
- Model availability varies by region and subscription. If no GPT-5 model is offered, pick another
  current chat deployment and set `AOAI_DEPLOYMENT` to its name.

<details>
<summary>Prefer a classic Azure OpenAI resource instead?</summary>

Same code, same settings — just a different resource kind. Still deploy a current GPT-5 model
(not the deprecated `gpt-4o-mini`):

```bash
az cognitiveservices account create -g $RG -n $AOAI \
  --kind OpenAI --sku S0 --location $AOAI_LOCATION --custom-domain $AOAI --yes
az cognitiveservices account deployment create -g $RG -n $AOAI \
  --deployment-name help-chat \
  --model-name gpt-5.1 --model-version "<current version>" --model-format OpenAI \
  --sku-name GlobalStandard --sku-capacity 20
```
</details>

## 3. Index the documentation

From this folder, with the `pottery-wheel-docs` repo checked out beside it:

```bash
npm ci
SEARCH_ENDPOINT="$SEARCH_ENDPOINT" \
SEARCH_ADMIN_KEY="$SEARCH_ADMIN_KEY" \
DOCS_DIR=../pottery-wheel-docs/docs \
SEARCH_INDEX=pottery-docs \
node tools/index-docs.mjs
```

Re-run after editing the docs — it replaces changed chunks and deletes removed ones.

## 4. Point the Function App at Search + OpenAI

```bash
az functionapp config appsettings set -g $RG -n pottery --settings \
  SEARCH_ENDPOINT="$SEARCH_ENDPOINT" \
  SEARCH_API_KEY="$SEARCH_QUERY_KEY" \
  SEARCH_INDEX="pottery-docs" \
  AOAI_ENDPOINT="$AOAI_ENDPOINT" \
  AOAI_API_KEY="$AOAI_API_KEY" \
  AOAI_DEPLOYMENT="$DEPLOY_NAME" \
  AOAI_API_VERSION="2025-04-01-preview"
```

## 5. Deploy the functions

Push to `main` (the GitHub Action in `.github/workflows/deploy.yml` deploys), or run
`func azure functionapp publish pottery` locally.

## 6. Verify

```bash
# A real session token from the app, or from auth/login:
TOKEN="<jwt>"
BASE="https://pottery-dha0esa4c2dchwfx.israelcentral-01.azurewebsites.net/api"

curl -s "$BASE/docs/suggest?q=mold" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "$BASE/docs/ask" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"how do I make a casting mold?","context":{"screen":"3D view"}}'
```

Then in the app, the top search bar's suggestions and answers go live.

## Cost note

Azure AI Search `basic` and the AI Foundry `S0` resource both bill while provisioned (Foundry adds
per-token model charges per request). For a small corpus you can use the Search `free` tier (one
per subscription, limited) instead of `basic`. Delete the resources (`az search service delete`,
`az cognitiveservices account delete`) to stop charges.

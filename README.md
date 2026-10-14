# mold-builder-functions

Azure Functions (Node.js 22, programming model v4) backend for Mold Builder accounts: sign up, login
and "who am I". Used by both apps (Android: `mold-builder-kotlin`, macOS: `mold-builder-swift`).

## API

All bodies are JSON. Errors are `{ "error": "<message for the user>" }`.

| Method | Route | Body | Success |
|---|---|---|---|
| POST | `/api/auth/signup` | `{ email, password, name? }` | `201 { token, user }` |
| POST | `/api/auth/login` | `{ email, password }` | `200 { token, user }` |
| GET | `/api/auth/me` | header `Authorization: Bearer <token>` | `200 { user }` |
| GET | `/api/health` | | `200 { ok: true }` |

`user` is `{ email, name }`. Errors: `400` invalid input, `401` wrong email/password or bad/expired
token, `409` email already registered, `500` server problem.

- Emails are case-insensitive. Passwords need at least 8 characters.
- Passwords are stored only as salted scrypt hashes.
- The token is an HS256 JWT signed with `AUTH_JWT_SECRET`, valid for 30 days.
- Users live in the Azure Table `USERS_TABLE` (default `users`), one row per email; the table is
  created on first use.

## Run locally

Needs [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
and [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) (local storage).

```sh
npm install
cp local.settings.example.json local.settings.json   # then set AUTH_JWT_SECRET
azurite --location .azurite &                         # local Table Storage
npm start                                             # http://localhost:7071/api
```

The apps point at the local host by default: the macOS app at `http://localhost:7071/api`, the
Android emulator at `http://10.0.2.2:7071/api`.

## Test

```sh
npm test
```

## Deploy

1. In Azure, create a Function App on the **Flex Consumption** plan, runtime **Node.js 22**, and its
   Storage account.
2. In the Function App's **Environment variables**, set:
   - `AUTH_JWT_SECRET`: a long random secret (e.g. `openssl rand -base64 48`);
   - `USERS_STORAGE_CONNECTION` (optional): a storage connection string for the users table.
     Without it the app's own storage account is used through Flex Consumption's
     `DEPLOYMENT_STORAGE_CONNECTION_STRING` (then `AzureWebJobsStorage`).
3. In the GitHub repo, add the secret `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` (the Function App's
   publish profile — if the portal won't offer one, turn on *SCM Basic Auth Publishing
   Credentials* under Configuration) and the variable `AZURE_FUNCTIONAPP_NAME`. Pushing to `main` then tests and
   deploys (`.github/workflows/deploy.yml`).
4. Point the apps at `https://<app-name>.azurewebsites.net/api`:
   - Android: build with `-PmoldBuilderApiUrl=https://<app-name>.azurewebsites.net/api`
     (or set it in `gradle.properties`).
   - macOS: `defaults write com.moldbuilder.app MoldBuilderApiURL https://<app-name>.azurewebsites.net/api`
     (or set the `MOLD_BUILDER_API_URL` environment variable).

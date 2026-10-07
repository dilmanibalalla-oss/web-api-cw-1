# Solar API component commits and deployment

This folder contains the implementation from our conversation. API paths and response bodies remain the same. Two internal corrections were made after verification: global Mongoose filter sanitization no longer blocks trusted application query operators, and operations inside the ingestion transaction run sequentially. Whitespace and comments have been compacted in some files. Package dependencies and a generated lockfile are included so the folder can be installed directly.

Use Node.js 24 and PowerShell. Run one stage at a time. Commands below do not push automatically: you perform them locally. Do not bulk-stage the whole project until all planned component commits are completed.

## 1 Clone the repository and copy the project

Open PowerShell in the parent folder where you want your Git checkout. If an api folder already exists, choose a different parent folder rather than overwriting it.

```powershell
git clone https://github.com/dilmanibalalla-oss/api.git
cd api
git status
git branch -a
```

If the repository is empty, initialize its main branch:

```powershell
git switch --orphan main
```

If main already exists, use this alternative instead:

```powershell
git switch main
git pull origin main
```

Copy the downloaded solar-api folder contents into this checkout. Replace the source path below with its actual path on your computer. Do not copy an extra solar-api directory inside api. This deliverable contains no .git directory or credentials.

```powershell
$solarSource = "D:\Downloads\solar-api"
Get-ChildItem -LiteralPath $solarSource -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination . -Recurse -Force
}
Get-ChildItem -Force
git status
```

If the remote already contains application code you need to keep, inspect the differences before copying over those files. Do not force-push or create unrelated histories.

## 2 Initial commit on main

Only stage these files, even though the entire folder is present:

```powershell
git add .gitignore README.md GIT-AND-DEPLOYMENT.md
git diff --cached --stat
git commit -m "chore: initialize solar API repository and implementation guide"
git push -u origin main
```

Create dev from main:

```powershell
git switch -c dev
git push -u origin dev
```

If dev already exists, use git switch dev and git pull origin dev instead of creating it again. Review any existing dev changes before proceeding.

## 3 Configuration component

```powershell
git switch -c feature/project-foundation
npm ci
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Edit .env. Fill in Atlas credentials, a random JWT secret of at least 32 bytes, two seed passwords of at least 16 characters, and SEED_CONFIRM=solar_api. The secret-generation command prints a value for you to paste; it does not edit .env.

```powershell
git check-ignore .env
git add package.json package-lock.json .env.example .env.test.example
git add src/config.js src/db.js scripts/copy-swagger.js public/swagger
git diff --cached --stat
git commit -m "chore: configure application database and Swagger assets"
git push -u origin feature/project-foundation
```

npm ci runs postinstall and creates local Swagger assets. Generated assets are already included for convenience.

## 4 Models validation and HTTP component

Remain on feature/project-foundation:

```powershell
git add src/models.js src/errors.js src/validation.js src/http.js
git diff --cached --stat
git commit -m "feat: add solar models validation pagination and conditional requests"
git push
```

## 5 Authentication component

```powershell
git add src/auth.js src/scope.js
git diff --cached --stat
git commit -m "feat: enforce device permissions and analyst jurisdiction access"
git push
```

## 6 Routes documentation and application component

```powershell
git add src/routes.js src/openapi.js src/app.js server.js vercel.json
git diff --cached --stat
git commit -m "feat: implement solar REST resources and live OpenAPI documentation"
git push
```

Merge this feature to dev:

```powershell
git switch dev
git merge --no-ff feature/project-foundation -m "merge: add solar API foundation"
git push origin dev
```

Alternatively create a GitHub PR with base dev and compare feature/project-foundation, merge it, then run git switch dev and git pull origin dev. Do not do both merge alternatives.

Untracked seed and test files remain in your local checkout until the following stages stage them. This is expected.

## 7 Seed data and provisioning component

```powershell
git switch -c feature/seed-data
git add scripts/seed.js scripts/issue-device-token.js
git diff --cached --stat
git commit -m "feat: seed national solar hierarchy and provision installation tokens"
git push -u origin feature/seed-data
```

Allow your development IP in Atlas and run the seed deliberately:

```powershell
npm run seed
```

Seeding replaces this application's collections in the database whose name matches SEED_CONFIRM. It produces 9 provinces, 25 districts, 25 substations, 225 installations, and 151200 readings. Run it locally, not during Vercel builds. The seed is synthetic and not a registry of real installations.

```powershell
git switch dev
git merge --no-ff feature/seed-data -m "merge: add seed data and device provisioning"
git push origin dev
```

## 8 Tests component

```powershell
git switch -c feature/integration-tests
Copy-Item .env.test.example .env.test
```

Edit .env.test with a separate database named solar_api_test and a separate JWT secret. Tests reset their collections and reject database names that do not end in _test. Never use the assessed database for tests.

```powershell
npm test
git add tests/api.test.js .github/workflows/ci.yml
git diff --cached --stat
git commit -m "test: verify pagination authorization ingestion and HTTP preconditions"
git push -u origin feature/integration-tests
```

In GitHub Settings > Secrets and variables > Actions, add TEST_MONGODB_URI and TEST_JWT_SECRET. Give CI its own test database, distinct from your local test database. Atlas must permit runner connectivity. Do not run overlapping jobs against one database; serialize them if you enable multiple simultaneous workflows.

Open a PR with base dev and compare feature/integration-tests. Check the workflow, repair failures, and merge. Then:

```powershell
git switch dev
git pull origin dev
git status
git log --oneline --graph --all
```

## 9 Run and verify locally

```powershell
npm run dev
```

- Health: http://localhost:3000/solar/v1/health
- Swagger: http://localhost:3000/solar/v1/docs
- OpenAPI: http://localhost:3000/solar/v1/openapi.json

POST /solar/v1/auth/token with a seeded email and its password. Authorize Swagger with the returned JWT. Seeded emails:

- admin@slsea.example
- national@slsea.example
- western@slsea.example
- colombo@slsea.example

Only the admin uses SEED_ADMIN_PASSWORD. The other accounts use SEED_ANALYST_PASSWORD.

Copy an installation ID from an authorized GET /solar/v1/installations response, then issue its short-lived device token:

```powershell
npm run device-token -- YOUR_INSTALLATION_ID
```

Never put device tokens or the JWT signing secret in Git.

Verify pagination, sorting, time filters, analyst jurisdiction boundaries, device write boundaries, 201 with Location, 304 with no body, 412 for stale If-Match, metadata child deletion checks, composite resources, and district summary coverage.

## 10 Deploy dev to Vercel

1. Push the completed dev branch.
2. Import dilmanibalalla-oss/api in Vercel.
3. Select Express, repository-root directory, and Node.js 24.x.
4. Keep native Express handling from vercel.json. Do not add the earlier /api/index.js rewrite configuration.
5. Set the production environment's branch tracking / production branch to dev.
6. Add production environment variables NODE_ENV=production, MONGODB_URI, JWT_SECRET, JWT_ISSUER=solar-api, and JWT_AUDIENCE=solar-clients.
7. Use the solar_api database. Do not add SEED_CONFIRM or seed passwords to Vercel.
8. Permit the Vercel deployment's Atlas connection. For coursework with changing egress addresses, a broad IP access entry is a demonstration trade-off; production should use controlled networking and narrowly permissioned credentials.
9. Deploy or redeploy after settings/environment changes. Confirm the deployment's source branch says dev.
10. Make the submitted production deployment reachable without requiring the marker to sign into Vercel. Application data still requires its JWT.
11. Check health, Swagger assets, login, history, authorization, ingestion, and summaries on the actual deployment.

Use the same JWT secret locally and on this deployment if locally provisioned device tokens must work there. Use separate databases and secrets for previews.

Your URLs are:

```text
https://YOUR-VERCEL-DOMAIN/solar/v1/health
https://YOUR-VERCEL-DOMAIN/solar/v1/docs
https://YOUR-VERCEL-DOMAIN/solar/v1/openapi.json
https://YOUR-VERCEL-DOMAIN/solar/v1/provinces
https://YOUR-VERCEL-DOMAIN/solar/v1/installations
https://YOUR-VERCEL-DOMAIN/solar/v1/readings
```

Deploying dev does not add /dev to the URL. Repository name api does not guarantee api.vercel.app is available. Record the actual domain in README and the report cover page.

## 11 Future component changes

```powershell
git switch dev
git pull origin dev
git switch -c feature/YOUR-FEATURE
# Make the change and run appropriate checks.
npm test
git add YOUR_CHANGED_FILES
git commit -m "feat: describe the actual improvement"
git push -u origin feature/YOUR-FEATURE
```

Open a PR into dev, inspect the checks, merge, then pull dev locally. A merge into dev triggers Vercel when dev is configured as production.

For an eventual final main snapshot, create a separate PR with base main and compare dev. You can retain dev as Vercel's production branch.

## 12 Submission evidence

A grade is not guaranteed by source code. Preserve real incremental commits, share the repository with the lecturer, submit a live seeded API and Swagger, disclose AI assistance and the corrections above, complete the report/declaration, and prepare to explain every artefact at viva. Readings remain append-only; metadata resources supply CRUD. Explain this design interpretation.

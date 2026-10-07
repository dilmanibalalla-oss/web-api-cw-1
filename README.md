# Solar Generation API

REST API for solar-generation monitoring.

Base path: /solar/v1

## Stack

Node.js 24, Express, MongoDB Atlas, JWT, OpenAPI.

## Source layout

- `src/app.js` configures the Express application.
- `src/config/` and `src/database/` contain runtime configuration and database setup.
- `src/middleware/` contains authentication and error handling.
- `src/models/`, `src/routes/`, and `src/validators/` contain persistence models, API routes, and request validation.
- `src/services/` and `src/utils/` contain jurisdiction scoping and shared HTTP helpers.
- `src/docs/` contains the OpenAPI specification.

## Domain

Province -> District -> Substation -> Installation -> GenerationReading.

Meter identity belongs to Installation.
Readings are immutable historical records.

## Clients

- Devices create readings for their own installation.
- Analysts read within their jurisdiction.
- Administrators manage hierarchy and installation metadata.

## Setup

1. npm install
2. Copy .env.example to .env and configure it.
3. npm run seed
4. npm run dev

Swagger: http://localhost:3000/solar/v1/docs

## Testing

Copy .env.test.example to .env.test.
Use a separate MongoDB database ending in _test.
Run npm test.

## Deployment

Vercel deploys the dev branch.
Production API and Swagger URLs must be recorded here after deployment.

See GIT-AND-DEPLOYMENT.md for the ordered component commits and deployment steps.

## AI disclosure

AI assistance was used for implementation guidance and code generation.
Prompts, generated artefacts, repairs, and verification evidence are
recorded in the coursework AI-disclosure appendix.

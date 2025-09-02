# OHDSI TAXIS (TAXIS2)

This repository provides the complete source code for the **OHDSI TAXIS** web application.  It comprises a React‑based frontend and a set of Netlify functions that together implement a secure file‑processing portal.  Users can authenticate with GitHub, upload CSV/Excel files containing concept pairs, and receive an enriched output containing relationship classifications generated via the OpenAI API.  Administrators have additional capabilities for reviewing the master record, inspecting all jobs and files, and performing clean‑up operations.

## Features

* **GitHub authentication** – Users sign in through GitHub OAuth.  Session cookies are signed using a secret defined in `.env`.
* **Persistent storage via Prisma** – User accounts, file uploads, jobs, sessions and master record entries are stored in a PostgreSQL database defined by the included Prisma schema.
* **File upload & validation** – Users may upload `.csv`, `.xlsx` or `.xls` files.  Files are validated to ensure they include the required header columns (`concept_a`, `concept_b`, `concept_a_t`, `concept_b_t`, `system_a`, `system_b`, `cooc_event_count`, `lift_lower_95`, `lift_upper_95`) and at least one data row.  Blank rows are automatically removed.
* **Automated classification** – Each row in an uploaded file is sent to the OpenAI Chat Completion API and classified into one of eleven relationship categories.  The rationale is recorded alongside the classification.  If no API key is provided, classification defaults to “No clear relationship.”
* **User dashboard** – After signing in, users are presented with two panels: a list of their previously uploaded jobs (with status, upload time in the America/Indiana/Indianapolis timezone and download links) and a form for uploading new files.
* **Admin dashboard** – Administrators (identified by email addresses specified in `ADMIN_EMAILS`) can view a summary of the `MasterRecord` table, search by `concept_a_t` or `concept_b_t`, download the entire table as CSV, inspect all uploaded jobs, and delete jobs/files by date, status or user.
* **Netlify ready** – The project is configured with a `netlify.toml` file.  All API routes are implemented as serverless functions under `netlify/functions`.  A catch‑all redirect ensures the React router works when deployed on Netlify.

## Getting started

### 1. Clone the repository

```bash
git clone https://github.com/overhage/TAXIS2.git
cd TAXIS2
```

### 2. Install dependencies

You’ll need a recent version of Node.js (≥18) and npm installed.  Install the required packages:

```bash
npm install
```

### 3. Configure environment variables

Copy the example environment file and fill in your own values:

```bash
cp .env.example .env
```

Edit `.env` with the following information:

| Variable | Description |
|---------|-------------|
| `DATABASE_URL` | PostgreSQL connection string.  Use a database accessible from your Netlify or local development environment. |
| `GITHUB_CLIENT_ID` & `GITHUB_CLIENT_SECRET` | Credentials for a [GitHub OAuth App](https://github.com/settings/developers).  Set the authorization callback URL to `https://<your-site>.netlify.app/api/login`. |
| `SESSION_SECRET` | Random string used to sign session cookies.  Make this long and unpredictable. |
| `ADMIN_EMAILS` | Comma‑separated list of email addresses with administrative privileges. |
| `OPENAI_API_KEY` | Secret key from the OpenAI console.  Without this, classification falls back to category 11. |

### 4. Apply database migrations

Prisma is used as the ORM layer.  To create the database schema defined in `prisma/schema.prisma`, run:

```bash
npm run prisma:generate
npx prisma migrate deploy
```

Alternatively, during development you can use `npx prisma migrate dev` which will apply migrations and generate types.

### 5. Development

The app uses Vite for the frontend and Netlify Functions for the backend.  To run everything locally with hot reloads you can use the [Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
npm install -g netlify-cli
netlify dev
```

Netlify CLI will proxy API requests (`/api/*`) to your functions and serve the Vite dev server.  Visit `http://localhost:8888` to use the application.

### 6. Deployment

Deploying to Netlify is straightforward:

1. Commit your changes and push to GitHub.
2. Create a new site on Netlify and link it to your repository.
3. Set the environment variables in the Netlify dashboard (the same ones defined in `.env`).
4. The site will build automatically using the `netlify.toml` configuration.

## Project structure

```
TAXIS2/
├─ netlify/
│  └─ functions/        → Serverless functions (authentication, file upload, job management, admin features)
├─ prisma/
│  └─ schema.prisma     → Database schema with User, Upload, Job, MasterRecord, etc.
├─ public/
│  └─ logo.png          → Owl logo used in the header
├─ src/
│  ├─ components/       → Shared UI components (Header)
│  ├─ hooks/            → `useAuth` hook for managing user state
│  ├─ pages/            → React pages (Login, Dashboard, Admin)
│  ├─ App.tsx           → App routing and layout
│  └─ main.tsx          → React entry point
├─ uploads/             → Temporary storage for uploaded and processed files (ignored in git)
├─ .env.example         → Sample environment variables
├─ netlify.toml         → Netlify build and redirect configuration
├─ package.json         → Dependencies and scripts
└─ README.md            → This documentation
```

## What you need to do

Some steps require manual actions that cannot be performed automatically by this assistant:

1. **Create the GitHub repository** – Visit GitHub and create a new repository named `TAXIS2` under your account.  Once created, push the generated files from this workspace to that repository.
2. **Provision the database** – Set up a PostgreSQL database (e.g. using Amazon RDS, Azure Database for PostgreSQL or a local instance) and update the `DATABASE_URL` in your `.env` accordingly.
3. **Register a GitHub OAuth app** – Go to [GitHub Developer settings](https://github.com/settings/developers) and create a new OAuth application.  Use `https://<your-netlify-site>.netlify.app/api/login` as the callback URL.  Copy the generated Client ID and Client Secret into your `.env` and Netlify dashboard.
4. **Obtain an OpenAI API key** – If you wish to use the automatic classification feature, generate an API key from your OpenAI account and place it in `OPENAI_API_KEY`.  Without it, uploaded files will still be validated but classifications will default to "No clear relationship".
5. **Deploy to Netlify** – After pushing your repository to GitHub, connect it to Netlify, set the environment variables in the dashboard, and trigger a deploy.

## Notes

* The serverless functions write uploaded files and their processed outputs to the `uploads/` directory.  In a Netlify environment this directory persists across function invocations but is not shared between build/deploys.  For production use you may wish to swap this out for an S3 bucket or another durable storage solution.
* Classification calls to OpenAI are synchronous and processed one row at a time.  Depending on the size of your uploads, this can take time and may exceed Netlify’s function execution limits.  Consider moving heavy processing to background jobs (e.g. AWS Lambda, separate queue) in a production environment.
* The email addresses specified in `ADMIN_EMAILS` have full access to the administrator dashboard.  Ensure this list is kept up‑to‑date.

If you encounter issues or have suggestions for improvements feel free to open an issue or submit a pull request once the repository is created.
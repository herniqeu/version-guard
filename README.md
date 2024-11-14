

# PR Sentinel 🛡️

Automatically validates version pinning and SQL migration safety in pull requests, ensuring consistent deployments and preventing dependency drift.

## Features 🚀

- 📦 **Version Pinning Validation**
  - Package Managers (npm, pip, gem, gradle, maven)
  - Container Images (Docker, Kubernetes, Docker Compose)
  - GitHub Actions
- 🔒 **SQL Migration Safety**
  - Idempotency checks
  - Transaction blocks validation
  - Schema modification safeguards

## Usage 💻

Add this GitHub Action to your repository by creating `.github/workflows/pr-sentinel.yml`:

```yaml
name: PR Sentinel
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: your-username/pr-sentinel@v1
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Validation Rules 📋

### Version Pinning

✅ Good Examples:
```dockerfile
FROM node:20.5.0-alpine3.18
```
```json
{
  "dependencies": {
    "express": "4.18.2"
  }
}
```

❌ Bad Examples:
```dockerfile
FROM node:latest
```
```json
{
  "dependencies": {
    "express": "^4.18.2"
  }
}
```

### SQL Migrations

✅ Good Example:
```sql
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'email'
    ) THEN 
        ALTER TABLE users ADD COLUMN email VARCHAR(255);
    END IF;
END $$;
```

❌ Bad Example:
```sql
ALTER TABLE users ADD COLUMN email VARCHAR(255);
```

## Local Development 🛠️

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```
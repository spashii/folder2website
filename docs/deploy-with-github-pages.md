# Deploy with GitHub Pages

Recipe for publishing a folder2website site with GitHub Pages and a custom domain.

Replace:

- `OWNER` with your GitHub owner.
- `REPO` with your repo name.
- `DOMAIN` with your custom domain.

## Workflow

Create `.github/workflows/pages.yml`:

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun index.ts . --out site --base-url https://DOMAIN
      - run: printf 'DOMAIN\n' > site/CNAME
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

## GitHub

Enable Pages from Actions:

```sh
gh api repos/OWNER/REPO/pages -X POST -f build_type=workflow
```

If Pages already exists:

```sh
gh api repos/OWNER/REPO/pages -X PUT -f build_type=workflow
```

Set the custom domain:

```sh
gh api repos/OWNER/REPO/pages -X PUT -f cname=DOMAIN
```

## DNS

Add a CNAME at your DNS provider:

```txt
DOMAIN -> OWNER.github.io.
```

Example for this repo:

```txt
folder2website.tangerinetech.eu -> spashii.github.io.
```

Verify:

```sh
dig +short DOMAIN CNAME
```

## Deploy

Push to `main`, or run:

```sh
gh workflow run pages.yml
```

Check status:

```sh
gh run list --workflow pages.yml
gh api repos/OWNER/REPO/pages
```

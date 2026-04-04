# Nginx

## Role

Nginx serves the static SPA and the two public JSON config files. It does not proxy to MediaMTX — the browser connects to MediaMTX directly for WebRTC.

## Routing Rules

Rules are evaluated top-to-bottom. Exact-match locations (`=`) take priority over regex locations (`~*`).

| Request | Response | Cache |
|---------|----------|-------|
| `GET /` | `index.html` | (default, no explicit header) |
| `GET /streams.json` | `streams-public.json` (bind-mounted) | `no-cache` |
| `GET /views.json` | `views-public.json` (bind-mounted) | `no-cache` |
| `GET /*.json` (any other) | `403 Forbidden` | — |
| `GET /*.js` | file from webroot | `public, max-age=31536000, immutable` |
| `GET /*` | file from webroot or `404` | — |

The `*.json` block catches any JSON path not explicitly whitelisted above. This prevents accidental exposure of other JSON files that could end up in the webroot.

`streams.json` and `views.json` use `no-cache` because the browser must always fetch the latest config. These files are regenerated at mediamtx startup when streams change.

JS files use `immutable` caching. The cache is busted by changing the filename or appending a query string (e.g., `app.js?v=2` in `index.html`).

## Env Var Injection

The nginx service in `docker-compose.yml` overrides the Dockerfile entrypoint to run `envsubst` before starting nginx:

```sh
envsubst '$FORCE_LAYOUT $FULLSCREEN_TIMEOUT $STREAM_REFRESH $ENABLE_MODALS $ENABLE_PRELOAD' \
  < /usr/share/nginx/html/index.html \
  > /tmp/index.html \
  && mv /tmp/index.html /usr/share/nginx/html/index.html \
  && nginx -g 'daemon off;'
```

The variable list is explicit — only the five named variables are substituted. Any other `$VAR` patterns in `index.html` are left untouched. This matters because `app.js` may contain template strings or `$`-prefixed identifiers that must not be modified.

`envsubst` runs once at container start and modifies `index.html` in place. There is no re-injection at runtime. To change an env var value, the container must be restarted (no rebuild needed — just `docker compose up -d nginx`).

## Dev Mode

In `docker-compose.dev.yml`, the entrypoint is overridden to skip `envsubst` entirely:

```yaml
entrypoint: ["nginx", "-g", "daemon off;"]
```

`index.html` and `app.js` are bind-mounted from `./www/`. The `$VAR` placeholders remain literally in the HTML. The JS treats unsubstituted `$VAR` strings as falsy/empty, so the app still works in dev with default behaviour.

Port is `8080` in dev vs `80` in prod.

## File Serving

The webroot is `/usr/share/nginx/html/`. Files are baked into the image at build time from `www/` via `Dockerfile.ui`. `streams.json` and `views.json` are not baked — they are bind-mounted from `./data/streams-public.json` and `./data/views-public.json` at runtime.

The `location /` catch-all uses `try_files $uri =404`, meaning it will 404 cleanly on missing assets rather than falling back to `index.html`. This is a static file server, not a SPA with client-side routing that needs a fallback.

## Rebuild vs Restart

| Change | Action |
|--------|--------|
| `nginx.conf` | Rebuild the `nginx` service |
| `www/` files (JS, CSS, HTML) | Rebuild the `nginx` service (prod); no action in dev |
| `Dockerfile.ui` | Rebuild the `nginx` service |
| Env var values in `docker-compose.yml` | Restart the `nginx` container (no rebuild needed) |
| `data/streams-public.json` or `data/views-public.json` | No action needed — bind-mount is live |

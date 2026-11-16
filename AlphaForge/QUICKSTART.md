# AlphaForge quick start

The website now lives at the **Poly_finace project root**, one directory above this file.

From the project root:

```bash
npm install
npm run dev
```

Open http://localhost:3000. Configuration is in the root `.env`; local chats are in the root `.data/`. No `--prefix` or directory change is needed.

For a production build, run `npm run build` followed by `npm start`. For a container, run `docker compose up --build -d`.

See the [project README](../README.md) for setup and layout. The Python agent remains in `AlphaForge/bedrock_portfolio/`. Its deployment is separate from running the website.

Existing AWS website hosting scripts are available from the project root as:

```bash
bash AlphaForge/deploy_web.sh --check
bash AlphaForge/deploy_web.sh --plan
```

`--check` validates locally. `--plan` performs AWS read-only checks. Running without either flag creates or updates paid AWS resources and switches the backend to multi-user JWT mode; see the [deployment guide](infra/web-deploy/README.md).

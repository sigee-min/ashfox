# ashfox Public Site

This workspace builds the landing page and documentation in each registered
language: `/` and `/docs/` in English, `/ko/` and `/ko/docs/` in Korean.

- Landing and interactive interface copy lives in `src/messages/<locale>.json`.
- Technical documentation is read from the repository `docs/` directory.
- The site imports no product or engine package.
- `dist/` contains the site fragment consumed by `npm run build:public`.

The copied agent instruction points to the selected language’s asset workflow guide.
See [localization maintenance](../../docs/contributing/localization.md) to add a language.
Canonical and social metadata use `https://ashfox.io`.

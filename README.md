# ResumeRoll

Daily job search, tailored resume/cover letter/microsite generation, manual submit, status tracking.

## Run
    cp .env.example .env   # set ANTHROPIC_API_KEY, ADMIN_PASSWORD, COOKIE_SECRET, PUBLIC_BASE_URL, ADZUNA_*, RAPIDAPI_KEY
    npm install
    npm start              # http://localhost:3000, daily crawl per CRON_SCHEDULE
    npm run crawl          # one-off crawl

## Setup order
1. Assets: upload resume PDFs.
2. Candidate Profile: "Rebuild from uploaded resumes", edit, save. All generated material uses only this.
3. Search Settings: confirm roles, filters, add Greenhouse/Lever/Ashby board slugs.
4. Pipeline: "Search now".

Behind a reverse proxy over HTTPS: set TRUST_PROXY=1.

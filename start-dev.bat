@echo off
cd /d "%~dp0"
npx --yes wrangler@4 dev --local --port 8789

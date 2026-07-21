# IPA ETL Workflow Hub

React + TypeScript frontend and FastAPI backend for designing ETL workflows.

## Frontend

```powershell
cd C:\Codex\ipa-etl-workflow-hub\frontend
npm.cmd install
npm.cmd run dev
```

## Backend

```powershell
cd C:\Codex\ipa-etl-workflow-hub\backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

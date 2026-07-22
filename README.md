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

## Top Navigation

상단 탑 영역에는 SK hynix 로고 이미지와 아래 주요 메뉴를 배치한다. 각 메뉴는 향후 화면 라우팅과 기능 확장 시 기준으로 사용한다.

| 메뉴 | 기능 범위 |
| --- | --- |
| **워크플로우** | 워크플로우 목록·생성·편집 |
| **Job 관리** | Job 목록, 상태, 실행·중지·비활성화 |
| **Connections** | Oracle·PostgreSQL·MySQL 연결 관리 |
| **실행 이력** | 성공·실패·처리 건수·오류 로그 조회 |
| **모니터링** | 실행 중 Job, 실패 알림, 전체 상태 |
| **설정** | 규칙, 사용자 권한, 환경 설정 |

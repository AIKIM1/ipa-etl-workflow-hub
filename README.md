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

| 메뉴 | 기능 범위 |
| --- | --- |
| **워크플로우** | Job 관리에서 만든 Job을 선택해 React Flow 캔버스에 연결 |
| **Job 관리** | Job 목록, 상태, 실행·중지·비활성화 확장 대상, 신규 Job 등록 |
| **Connections** | Oracle·PostgreSQL·MySQL 접속정보 등록, 연결 객체 생성 테스트, Python 템플릿 확인 |
| **실행 이력** | 성공·실패·처리 건수·오류 로그 조회 |
| **모니터링** | 실행 중 Job, 실패 알림, 전체 상태 |
| **설정** | 규칙, 사용자 권한, 환경 설정 |

## Development Flow

현재 화면 흐름은 `Connections -> Job 관리 -> 워크플로우` 순서로 설계되어 있다.

1. **Connections**
   DB 유형, Host, Port, Database, 계정, Schema를 등록한다. 등록된 접속정보는 `connection_id`를 가진 연결 객체로 취급한다.

2. **Job 관리**
   재사용하거나 독립 실행할 Job을 먼저 생성·검증·버전 관리한다. Job에는 컴포넌트 유형, Source/Target 연결 객체 ID, SQL 또는 처리 코드, 입력/출력 계약, 재시도 횟수, 버전, 활성 상태를 보관한다. 실행 시 동일한 DB 연결 객체를 여러 Job이 재사용할 수 있다.

3. **워크플로우**
   Job 관리에서 생성된 활성 Job을 선택해 React Flow 캔버스에 조립한다. Workflow에는 Job 실행 순서, 성공/실패 조건, 의존 관계, 병렬 실행 그룹, 실행 스케줄만 보관한다. DB 연결정보와 SQL/처리 코드는 Job으로부터 참조한다.

## Job-First Workflow Model

```text
Connections 등록 -> Job 생성/검증/버전 관리 -> Workflow에서 Job 연결 -> 실행
```

- 하나의 Job은 일일 적재, 수동 재처리, 품질 분석 등 여러 Workflow에서 재사용할 수 있다.
- Workflow에서 만든 실행 단위는 `Job으로 저장` 흐름으로 Job 관리에 등록해 재사용할 수 있도록 확장한다.
- 단순 변환을 모두 독립 Job으로 만들지 않고, 재사용하거나 독립 실행할 필요가 있는 단위만 Job으로 관리한다.

## Backend API

FastAPI는 현재 인메모리 레지스트리로 동작한다. 이후 DB 저장소로 바꿀 때도 API 계약은 유지할 수 있도록 나누어 두었다.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/connections/test` | 저장 전 DB 연결 테스트 및 schema/table metadata 조회 |
| `POST` | `/api/connections` | DB 접속정보 등록 및 `connection_id` 발급 |
| `GET` | `/api/connections` | 등록된 연결 목록 조회 |
| `POST` | `/api/connections/{connection_id}/metadata` | 저장된 접속정보로 metadata 재조회 |
| `GET` | `/api/connections/{connection_id}/schemas` | schema 목록 조회 |
| `GET` | `/api/connections/{connection_id}/tables` | table 목록 조회 |
| `GET` | `/api/connections/{connection_id}/tables/{schema}/{table}/columns` | column 목록 조회 |
| `GET` | `/api/connections/{connection_id}/template` | Python SQLAlchemy 연결 템플릿 생성 |
| `POST` | `/api/jobs` | Job 생성 |
| `GET` | `/api/jobs` | Job 목록 조회 |
| `POST` | `/api/workflows` | Workflow 생성 |
| `GET` | `/api/workflows` | Workflow 목록 조회 |

`POST /api/jobs`는 `processing_code`, `input_contract`, `output_contract`, `retry_count`, `version`, `enabled`를 받을 수 있다. `POST /api/workflows`는 `job_ids` 또는 Job별 의존 조건을 담은 `job_links`를 사용하며, Workflow 자체에는 DB 비밀번호나 SQL을 저장하지 않는다.

## Connection Reuse Notes

백엔드의 `ConnectionRegistry`는 접속정보를 저장하고, Job과 Workflow는 비밀번호를 직접 전달받지 않고 `connection_id`만 참조한다. 실제 DB 접근 시에는 `connection_factory.py`가 등록된 설정값으로 SQLAlchemy Engine을 생성한다.

비밀번호는 화면 목록, 로그, 템플릿 미리보기에서 마스킹한다. 운영 단계에서는 `.env`, Secret Manager, Vault 같은 보안 저장소를 사용하도록 확장한다.

## DB Connection Input

공통 입력값:

| 입력값 | 설명 |
| --- | --- |
| `connection_name` | 화면과 Job에서 선택할 연결 이름 |
| `database_type` | `POSTGRESQL`, `MYSQL`, `ORACLE` |
| `host`, `port` | DB 서버 주소와 포트 |
| `username` | DB 계정 |
| `password` | 연결 테스트용 직접 입력 비밀번호 |
| `password_env_key` | 저장/템플릿 생성 시 사용할 환경변수 키 |
| `connection_role` | `SOURCE`, `TARGET`, `AUDIT` |
| `environment` | `DEV`, `TEST`, `PROD` |
| `default_schema` | metadata 조회와 Source Extract 기본 schema |
| `connect_timeout` | 연결 제한시간 |
| `pool_size`, `max_overflow` | SQLAlchemy connection pool 설정 |
| `use_ssl`, `read_only` | SSL 사용 여부, 읽기 전용 여부 |

DB별 입력값:

| DB | 추가 입력값 |
| --- | --- |
| PostgreSQL | `database_name`, 기본 포트 `5432`, 기본 schema `public` |
| MySQL | `database_name`, 기본 포트 `3306`, 기본 charset `utf8mb4` |
| Oracle | `service_name` 또는 `sid`, 기본 포트 `1521`, 둘 중 하나만 입력 |

## Backend Modules

| 파일 | 역할 |
| --- | --- |
| `connection_models.py` | DB 연결 입력 모델, DB 유형/역할/환경 enum, 검증 규칙 |
| `connection_factory.py` | DB별 SQLAlchemy URL 생성, Engine 생성, `SELECT 1` 연결 테스트 |
| `metadata_service.py` | schema/table/column metadata 조회 |
| `template_generator.py` | 비밀번호 대신 `password_env_key`를 참조하는 Python 연결 템플릿 생성 |
| `main.py` | FastAPI route, connection/job/workflow registry |

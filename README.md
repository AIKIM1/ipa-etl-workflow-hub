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



from mage_ai.data_preparation.decorators import data_exporter
from sqlalchemy import create_engine, URL
from pandas import DataFrame


@data_exporter
def export_data(df: DataFrame, **kwargs) -> None:
    url = URL.create(
        drivername='postgresql+pg8000',
        username='postgres',
        password='1234',
        host='localhost',
        port=5432,
        database='testdb',
    )

    engine = create_engine(url)

    try:
        with engine.begin() as connection:
            df.to_sql(
                name='target_table',
                con=connection,
                schema='public',
                if_exists='append',
                index=False,
            )
    finally:
        engine.dispose()


추천해준 방법대로 저장기능 구현했어
아래 참고해줘

구현 완료했습니다.
동작 흐름
DB connection 컴포넌트에 접속정보 입력
DB 접속 테스트 성공
수정 완료 시 FastAPI가 다시 검증 후 제어용 PostgreSQL에 저장
CONN_A12B34CD 형식의 connection_id 발급
캔버스 DB 노드는 connectionId, connectionName만 저장
원천 추출은 Repository 목록에서 connection_id를 선택해 참조
직접 입력한 비밀번호는 PostgreSQL에 암호화해 저장하며, API 응답·캔버스·워크플로우 JSON에는 포함하지 않습니다.
주요 파일:
Connection Repository
Connection CRUD API (line 224)
DB Connection 및 원천 추출 화면 (line 687)
PostgreSQL 테이블 생성 SQL
환경변수 예시
생성할 PostgreSQL 테이블은 connections입니다. 제어용 PostgreSQL에 001_create_connections.sql을 실행하거나, CONTROL_DATABASE_URL 설정 후 FastAPI를 시작하면 자동 생성됩니다.
필수 환경변수는 다음 두 가지입니다.
CONTROL_DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/ipa_etl_control
CONNECTION_ENCRYPTION_KEY=Fernet_암호화키
실제 PostgreSQL 접속정보가 아직 없어 테이블을 직접 생성하지는 않았습니다. 프론트 빌드, Repository 암호화 저장·조회·삭제, CRUD API 라우트 검증은 완료했습니다. FastAPI는 http://127.0.0.1:8000, 프론트는 http://127.0.0.1:5173에서 실행 중입니다.

파일 7개를 편집했습니다+575-72변경 사항 검토실행 취소리뷰

backend/app/connection_repository.pybackend/app/connection_repository.py+261-8
backend/requirements.txtbackend/requirements.txt+1-0
backend/sql/001_create_connections.sqlbackend/sql/001_create_connections.sql+40-4
4개 파일 더 보기

오전 12:21

워크스페이스가 저장되어 서버 재시작을 해도 남아 있을 수 있도록 개발 하고 싶어
어떤 방법이 좋을지 계획(플랜) 새워줘

오전 12:28

좋습니다. 현재 워크스페이스는 React 메모리에만 있어 새로고침·서버 재시작 시 사라집니다. 가장 적합한 방식은 이미 만든 제어용 PostgreSQL에 워크플로우 정의를 저장하는 것입니다.
권장 구조
React Flow 캔버스
→ 워크플로우 저장 API
→ FastAPI 검증
→ Control PostgreSQL 저장
→ 서버 재시작 후 목록·캔버스 복원
저장 대상
테이블	역할
workflows	워크플로우 이름, 상태, 스케줄, 버전, 생성·수정일
workflow_nodes	캔버스 노드 종류, 위치 X/Y, Job·Connection 참조, 설정 JSON
workflow_edges	노드 간 연결, 성공·실패 조건, 실행 순서
workflow_versions	저장 이력과 이전 버전 복원용 스냅샷
workflow_drafts	작업 중 자동 저장되는 임시 워크스페이스

DB Connection 노드는 connection_id만, 원천 추출은 source_connection_id와 Schema/Table/조건/Watermark만 저장합니다. 비밀번호는 워크플로우 테이블에 저장하지 않습니다.
개발 흐름
workflows, workflow_nodes, workflow_edges PostgreSQL 테이블과 SQLAlchemy Repository를 추가합니다.
FastAPI에 워크플로우 CRUD API를 구현합니다.
생성, 목록, 상세 조회, 수정, 삭제, 복제, 버전 조회
현재 워크플로우 저장 버튼이 캔버스의 노드·엣지·입력값을 API로 저장하도록 변경합니다.
좌측 워크플로우 목록은 GET /api/workflows 결과를 표시하도록 변경합니다.
목록에서 워크플로우를 선택하면 GET /api/workflows/{id}로 노드 위치와 연결선을 복원합니다.
캔버스 이동, 노드 추가·삭제, 연결 변경 후 3~5초 지연 자동 저장을 추가합니다.
명시적인 저장은 새 버전을 생성하고, 자동 저장은 Draft만 갱신합니다.
서버 시작 후에도 PostgreSQL에 저장된 워크플로우 목록과 마지막 Draft를 다시 불러옵니다.
권장 API
POST   /api/workflows
GET    /api/workflows
GET    /api/workflows/{workflow_id}
PUT    /api/workflows/{workflow_id}
DELETE /api/workflows/{workflow_id}
POST   /api/workflows/{workflow_id}/versions
GET    /api/workflows/{workflow_id}/versions
PUT    /api/workflows/{workflow_id}/draft
GET    /api/workflows/{workflow_id}/draft
1차 구현에서는 workflows + workflow_nodes + workflow_edges 영구 저장과 목록·복원까지 먼저 만들고, 그 다음 자동 저장 Draft와 버전 관리로 확장하는 순서가 가장 안정적입니다.

오전 12:28

위의 (워크플로우 저장)방법대로 권장 구조와 저장 대상, 개발 흐름 대로 개발 진행해줘
먼저 영구 저장과 목록·복원까지 만들어줘
개발 시작해줘.

오전 12:34

10m 24s 동안 작업

영구 워크스페이스 저장과 목록·복원 기능을 구현했습니다.
저장 흐름
Workflow 생성 시 제어용 PostgreSQL에 workflows 레코드를 생성합니다.
캔버스의 워크플로우 저장 시 노드, 좌표, 연결선, 컴포넌트 설정을 API로 저장합니다.
좌측 목록은 GET /api/workflows에서 조회합니다.
목록을 클릭하면 DB의 노드와 연결선을 다시 읽어 React Flow 캔버스를 복원합니다.
DB Connection과 원천 추출은 접속정보 전체가 아닌 connectionId 참조를 유지합니다.
추가된 테이블:
workflows: 이름, 스케줄, 상태, 버전, 생성·수정일
workflow_nodes: 노드 유형, 위치, Connection 참조, 설정 JSON
workflow_edges: 노드 연결 정보와 React Flow 엣지 JSON
주요 파일:
워크플로우 Repository
워크플로우 CRUD API (line 387)
워크스페이스 테이블 SQL
프론트 저장·목록·복원 (line 533)
CONTROL_DATABASE_URL이 설정된 상태에서 FastAPI를 시작하면 connections, workflows, workflow_nodes, workflow_edges 테이블이 자동 생성됩니다. 또는 SQL 파일을 제어용 PostgreSQL에 직접 실행할 수 있습니다.
검증 완료:
React TypeScript 프로덕션 빌드 성공
노드 위치, 연결선, connectionId 참조의 저장·복원 테스트 성공
FastAPI CRUD API 라우트 확인 완료
현재 제어용 PostgreSQL 접속정보가 설정되지 않아 실제 운영 DB에는 아직 테이블을 생성하지 않았습니다. CONTROL_DATABASE_URL 설정 후 서버를 재시작하면 영구 저장 기능을 바로 사용할 수 있습니다.

----------------

1. Host: localhost
2. Port: 5432
3. Database 이름: etl_job_mgmt (Source) 또는 postgres (Target)
4. 기본 Schema: public
5. Username: postgres
6. Password: rlaeodud1!
7. Password Env Key: DB_CONN_SRC_POSTGRES_PASSWORD
8. 연결 역할: Source / Target 선택
9. 환경: DEV
10. 접속 제한 시간: 10
11. SSL 사용: 체크 안 함
12. 읽기 전용: 체크 안 함

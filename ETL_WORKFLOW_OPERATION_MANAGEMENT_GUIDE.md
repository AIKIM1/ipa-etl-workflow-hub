# ETL Workflow 프로젝트 운영/관리 가이드

이 문서는 IPA ETL Workflow Hub 프로젝트의 기능별 운영/관리 업무를 참고하기 위한 가이드 문서입니다.

## 빠른 운영 안내

ETL 운영은 아래 순서로 진행합니다.

```text
Connections 등록 → Job 생성·검증 → Workflow 조립·스케줄 설정 → 실행/모니터링
```

| 메뉴 | 운영 목적 | 운영자가 하는 일 |
| --- | --- | --- |
| **Connections** | DB 접속정보를 안전하게 등록하고 재사용 | DB 유형, 주소, 계정, Schema, 비밀번호 환경변수 키를 입력하고 연결 테스트 후 등록합니다. 등록 결과인 `connection_id`를 Job에서 선택합니다. |
| **Job 관리** | 독립 실행 가능하고 재사용 가능한 작업을 관리 | 원천 추출·정제·적재·품질 검증 Job을 만들고, 연결 객체, SQL/처리 코드, 입력·출력값, 재시도 횟수, 버전, 활성 상태를 설정합니다. |
| **워크플로우** | 등록된 Job을 업무 순서에 맞춰 조립 | 사용할 Job을 캔버스에 배치하고 성공·실패 조건, 의존 관계, 병렬 실행 여부, 실행 스케줄을 설정합니다. |

### 운영자가 기억할 원칙

- DB 비밀번호는 Job이나 Workflow에 저장하지 않습니다. Connections의 `password_env_key`를 이용합니다.
- Job은 여러 Workflow에서 재사용할 수 있습니다. Job 수정 전에는 사용 중인 Workflow 영향도를 확인합니다.
- Workflow에는 DB 정보나 SQL을 중복 입력하지 않습니다. Workflow는 Job의 실행 순서와 조건만 관리합니다.
- 단순하고 한 번만 쓰는 작업은 Workflow에서 검토한 후, 재사용 또는 독립 실행이 필요할 때 Job으로 등록합니다.

### 일상 운영 예시

1. 신규 원천 DB가 생기면 Connections에서 연결 테스트 후 `SRC_...` 연결 객체를 등록합니다.
2. Job 관리에서 해당 연결 객체를 선택해 `원천 추출 Job`을 만들고 SQL, Watermark, 재시도를 설정합니다.
3. 워크플로우에서 추출 Job, 정제 Job, 적재 Job, 품질 검증 Job을 순서대로 연결하고 스케줄을 저장합니다.
4. 장애가 나면 먼저 Connections 연결 상태, 다음 Job 실행 로그와 버전, 마지막으로 Workflow 의존 조건과 스케줄을 확인합니다.

현재 작성된 범위:

- DB Connections, Job 관리, Workflow 운영/관리 업무 흐름

향후 추가 예정 범위:

- 실행 이력
- 모니터링
- 설정/권한 관리

---

# DB Connections 운영/관리 업무 흐름

## 1. 기능 목적

DB Connections 기능은 DB 접속정보를 등록하고 `connection_id`를 발급해, Source Extract, Target Load, Quality Check 같은 다른 Job 컴포넌트가 동일한 연결 객체를 재사용하도록 만드는 기능이다.

중요 원칙:

- Job 컴포넌트는 DB 비밀번호를 직접 다루지 않는다.
- Job 컴포넌트는 `connection_id`만 선택해 사용한다.
- 실제 DB 연결 객체는 백엔드의 Connection Factory가 생성한다.
- 운영 환경에서는 비밀번호 직접 저장보다 `.env`, Secret Manager, Vault 등에서 `password_env_key`로 참조한다.

## 2. 전체 업무 흐름

```mermaid
flowchart TD
    A["Connections 메뉴 진입"] --> B["DB 접속정보 입력"]
    B --> C["연결 테스트"]
    C --> D{"연결 성공?"}
    D -- "성공" --> E["Schema/Table/Column Metadata 조회"]
    E --> F["Connection 등록"]
    F --> G["connection_id 발급"]
    G --> H["Job 관리에서 connection_id 선택"]
    H --> I["Workflow에서 Job 연결"]
    I --> J["실행 시 Connection Factory가 Engine 생성"]
    D -- "실패" --> K["접속정보/권한/방화벽/Secret 확인"]
    K --> B
```

## 3. 프론트 화면 흐름

프론트 주요 파일:

| 파일 | 역할 |
| --- | --- |
| `frontend/src/App.tsx` | Connections, Job 관리, Workflow 화면과 상태 관리 |
| `frontend/src/styles.css` | Connections 폼, 목록, 템플릿 미리보기, 반응형 스타일 |

### 3.1 Connections 메뉴

사용자가 상단 메뉴에서 `Connections`를 선택한다.

화면 구성:

- 왼쪽/중앙 영역: 등록된 DB 연결 목록
- 오른쪽 상세 패널: 신규 연결 객체 등록 폼
- 하단/상세 영역: Python DB Connection Template 미리보기

입력 항목:

| 화면 라벨 | 내부 값 | 설명 |
| --- | --- | --- |
| Connection 이름 | `name` | 화면과 Job에서 선택할 연결명 |
| DB 유형 | `dbType` | `ORACLE`, `POSTGRESQL`, `MYSQL` |
| 연결 목적 | `role` | `SOURCE`, `TARGET`, `AUDIT` |
| 환경 | `environment` | `DEV`, `TEST`, `PROD` |
| Host | `host` | DB 서버 주소 |
| Port | `port` | DB 접속 포트 |
| Database Name | `databaseName` | PostgreSQL/MySQL DB명 |
| Oracle Service Name | `serviceName` | Oracle Service Name 방식 접속 |
| Oracle SID | `sid` | Oracle SID 방식 접속 |
| Username | `username` | DB 계정 |
| Password 테스트 입력 | `password` | 연결 테스트용 비밀번호 |
| Password Env Key | `passwordEnvKey` | 운영 저장소에서 비밀번호를 찾을 환경변수 키 |
| Default Schema | `schemaName` | 기본 schema |
| 연결 제한시간 | `connectTimeout` | DB 연결 timeout |
| Pool Size | `poolSize` | SQLAlchemy pool size |
| Max Overflow | `maxOverflow` | 추가 connection 허용 수 |
| SSL 사용 | `useSsl` | SSL 접속 여부 |
| 읽기 전용 | `readOnly` | 읽기 전용 연결 여부 |
| 설명 | `description` | 운영 메모 |

### 3.2 DB 유형별 입력 규칙

PostgreSQL:

- 기본 포트: `5432`
- 필수: `databaseName`
- 기본 schema 예시: `public`

MySQL:

- 기본 포트: `3306`
- 필수: `databaseName`
- 기본 charset: `utf8mb4`

Oracle:

- 기본 포트: `1521`
- `serviceName` 또는 `sid` 중 하나만 입력
- 둘 다 입력하면 안 된다.

### 3.3 연결 목록

등록된 Connections 목록은 다음 정보를 표시한다.

- Connection 이름
- 마스킹된 DSN
- 연결 목적
- 환경
- 기본 Schema
- 상태
- 객체 생성 테스트 버튼

DSN 예시:

```text
POSTGRESQL://etl_reader:***@10.10.10.21:5432/source_db
MYSQL://etl_loader:***@10.10.20.11:3306/mart_db
ORACLE://etl_user:***@10.10.10.20:1521/MESDB
```

### 3.4 Job 관리 화면 연계

`Job 관리`는 재사용 가능하거나 독립 실행할 필요가 있는 작업을 먼저 정의·검증·버전 관리하는 화면이다. 사용자가 Job을 생성할 때 Source/Target 연결 객체를 선택한다.

흐름:

1. Job 이름 입력
2. 컴포넌트 유형 선택
3. Source 연결 객체 선택
4. Target 연결 객체 선택
5. SQL 또는 처리 코드, 입력값/출력값 계약 입력
6. 재시도 횟수, 버전, 활성 상태 설정
7. Job 등록

이때 Job은 비밀번호를 저장하지 않고 `sourceConnectionId`, `targetConnectionId`만 저장한다.

Job 관리 항목:

| 관리 항목 | 설명 |
| --- | --- |
| Job 이름·설명 | 운영자가 식별할 수 있는 실행 단위 정보 |
| 컴포넌트 종류 | 원천 추출, 데이터 정제, Target 적재, 품질 검증 등 |
| DB Connection | `connection_id` 참조. 비밀번호는 Job에 저장하지 않음 |
| SQL 또는 처리 코드 | Job의 실제 처리 로직 |
| 입력값·출력값 | Job 사이에 전달되는 데이터 계약 |
| 재시도 횟수 | 실패 시 Job 단위 재시도 정책 |
| 버전·활성 상태 | 변경 이력, 사용 가능 여부, 영향도 관리 |

### 3.5 Workflow 화면 연계

Workflow 화면에서는 Job 관리에서 먼저 만든 활성 Job을 선택해 캔버스에 연결한다. DB 접속정보와 처리 코드는 Workflow에 복사하지 않는다.

흐름:

1. Workflow 이름과 실행 스케줄 입력
2. Workflow에 연결할 Job 선택
3. Job 간 실행 순서, 성공·실패 조건, 의존 관계, 병렬 실행 여부 설정
4. `Workflow 생성` 클릭
5. React Flow 캔버스에 선택한 Job이 순서대로 배치
6. Job 노드는 연결 객체 이름을 표시

운영 원칙:

- 같은 Job은 여러 Workflow에서 재사용할 수 있다.
- Workflow에서 임시로 만든 컴포넌트는 검증 후 `Job으로 저장`해 Job 관리에 등록하는 혼합 방식을 지원 대상으로 둔다.
- 단순 변환 단계는 Workflow 내부에서 관리할 수 있으며, 재사용 또는 독립 실행 필요성이 생길 때 Job으로 승격한다.

## 4. 백엔드 파일 및 메소드

### 4.1 `backend/app/connection_models.py`

DB Connection 입력값과 검증 규칙을 담당한다.

주요 클래스:

| 이름 | 역할 |
| --- | --- |
| `DatabaseType` | `POSTGRESQL`, `MYSQL`, `ORACLE` enum |
| `ConnectionRole` | `SOURCE`, `TARGET`, `AUDIT` enum |
| `EnvironmentType` | `DEV`, `TEST`, `PROD` enum |
| `DatabaseConnectionInput` | DB 접속정보 입력 모델 |
| `StoredConnection` | 등록된 Connection 저장 모델 |

주요 메소드:

| 메소드 | 역할 |
| --- | --- |
| `DatabaseConnectionInput.validate_database_fields()` | DB별 필수값 검증 |
| `StoredConnection.public_dict()` | 비밀번호를 제외한 응답 데이터 생성 |

검증 규칙:

- `password` 또는 `password_env_key` 중 하나는 필요
- PostgreSQL/MySQL은 `database_name` 필요
- Oracle은 `service_name` 또는 `sid` 필요
- Oracle은 `service_name`과 `sid`를 동시에 사용할 수 없음

### 4.2 `backend/app/connection_factory.py`

SQLAlchemy 기반 DB 연결 객체를 생성한다.

주요 클래스/메소드:

| 이름 | 역할 |
| --- | --- |
| `DatabaseConnectionError` | DB 연결 실패 예외 |
| `resolve_password(config)` | 직접 입력 password 또는 환경변수에서 비밀번호 조회 |
| `build_database_url(config)` | DB 유형별 SQLAlchemy URL 생성 |
| `create_database_engine(config)` | SQLAlchemy Engine 생성 |
| `test_database_connection(config)` | `SELECT 1` 또는 Oracle `SELECT 1 FROM DUAL` 실행 |

DB별 SQLAlchemy driver:

| DB | Driver |
| --- | --- |
| PostgreSQL | `postgresql+psycopg` |
| MySQL | `mysql+mysqlconnector` |
| Oracle | `oracle+oracledb` |

### 4.3 `backend/app/metadata_service.py`

DB 연결 테스트 후 metadata를 조회한다.

주요 메소드:

| 메소드 | 역할 |
| --- | --- |
| `get_database_metadata(config)` | schema 목록, 기본 schema, table 목록 조회 |
| `get_table_columns(config, schema_name, table_name)` | table column 목록 조회 |

반환 예시:

```json
{
  "default_schema": "MES",
  "schemas": ["MES", "QUALITY", "EQUIPMENT"],
  "tables": ["DIE_TEST", "WAFER_SUMMARY"]
}
```

### 4.4 `backend/app/template_generator.py`

Python DB connection template를 생성한다.

주요 메소드:

| 메소드 | 역할 |
| --- | --- |
| `python_literal(value)` | Python 코드에 넣을 문자열 literal 생성 |
| `generate_connection_template(config)` | 공통 Connection Factory를 사용하는 Python 코드 생성 |

템플릿 생성 원칙:

- 비밀번호를 코드에 직접 넣지 않는다.
- `password_env_key`만 코드에 포함한다.
- `create_database_engine(connection_config)`를 호출해 Engine을 생성한다.

### 4.5 `backend/app/main.py`

FastAPI route와 인메모리 registry를 담당한다.

Job/Workflow 주요 모델과 메소드:

| 대상 | 역할 |
| --- | --- |
| `JobDefinition` | 연결 객체 참조, 처리 코드, 입출력 계약, 재시도·버전·활성 상태를 가진 독립 Job 정의 |
| `JobRegistry.add()` | Connection 참조를 검증한 뒤 재사용 가능한 Job을 등록 |
| `WorkflowJobLink` | Workflow 안의 Job 의존 관계, 성공/실패 조건, 병렬 그룹 정의 |
| `WorkflowDefinition` | Job 조립 정보와 실행 스케줄을 보관. DB 접속정보와 처리 코드는 보관하지 않음 |
| `WorkflowRegistry.add()` | 등록 Job과 의존 관계를 검증한 뒤 Workflow를 등록 |

Workflow API 요청 예시:

```json
{
  "workflow_name": "daily_customer_load",
  "schedule": "0 2 * * *",
  "parallel_execution": false,
  "job_links": [
    { "job_id": "JOB_01", "success_condition": "on_success", "failure_condition": "stop_workflow" },
    { "job_id": "JOB_02", "depends_on": ["JOB_01"], "success_condition": "on_success" }
  ]
}
```

주요 클래스:

| 이름 | 역할 |
| --- | --- |
| `ConnectionRegistry` | Connection 등록, 조회, metadata 갱신 |
| `JobRegistry` | Job 등록, 조회, connection_id 검증 |
| `WorkflowRegistry` | Workflow 등록, Job/Connection 참조 검증 |

주요 메소드:

| 메소드 | 역할 |
| --- | --- |
| `ConnectionRegistry.add()` | Connection 등록 및 `CONN_xxxxxxxx` 발급 |
| `ConnectionRegistry.list()` | Connection 목록 조회 |
| `ConnectionRegistry.get()` | connection_id로 Connection 조회 |
| `ConnectionRegistry.update_metadata()` | schema/table metadata 저장 |
| `JobRegistry.add()` | Job 등록 |
| `JobRegistry.get()` | job_id로 Job 조회 |
| `WorkflowRegistry.add()` | Workflow 등록 |

## 5. 백엔드 API 흐름

### 5.1 저장 전 연결 테스트

```http
POST /api/connections/test
```

용도:

- 입력값으로 일회성 DB 연결 테스트
- 성공 시 metadata 조회
- 실패 시 운영자가 접속정보를 수정

### 5.2 Connection 등록

```http
POST /api/connections
```

용도:

- 접속정보 등록
- `connection_id` 발급
- 이후 Job 컴포넌트에서 `connection_id`만 참조

응답 예시:

```json
{
  "connection_id": "CONN_0001",
  "status": "REGISTERED",
  "default_schema": "MES",
  "schemas": ["MES"],
  "tables": []
}
```

### 5.3 Metadata 조회

```http
POST /api/connections/{connection_id}/metadata
GET /api/connections/{connection_id}/schemas
GET /api/connections/{connection_id}/tables
GET /api/connections/{connection_id}/tables/{schema}/{table}/columns
```

용도:

- Source Extract 컴포넌트에서 schema/table/column 선택 UI 구성
- 운영자가 연결 계정 권한을 확인

### 5.4 Python Template 조회

```http
GET /api/connections/{connection_id}/template
```

용도:

- 운영/개발자가 실제 Python 모듈 구조를 참고
- 공통 Connection Factory 재사용 방식 확인

## 6. 운영 체크리스트

Connection 등록 전 확인:

- DB 서버 Host/Port 접근 가능 여부
- 방화벽/보안그룹 허용 여부
- DB 계정 권한
- Source 계정은 가능하면 read-only 권한 사용
- Target 계정은 필요한 schema/table에만 쓰기 권한 부여
- `password_env_key`가 운영 환경에 존재하는지 확인

Connection 테스트 실패 시 확인:

- Host 오타
- Port 오타
- Oracle Service Name/SID 입력 방식
- Database Name 누락
- 계정 잠김 또는 비밀번호 만료
- VPN/방화벽/DB ACL
- 환경변수 또는 Secret 누락

운영 권장:

- PROD 연결은 `readOnly` 기본값을 신중히 설정
- 비밀번호 직접 저장 금지
- `SOURCE`, `TARGET`, `AUDIT` 목적별로 계정을 분리
- metadata 조회 권한은 최소 권한 원칙으로 부여
- 연결 테스트 로그는 남기되 password는 로깅하지 않기

## 7. 향후 확장 대상

- Connection 정보를 실제 DB 테이블에 저장
- Secret Manager 또는 Vault 연동
- 연결 테스트 결과 이력 저장
- Metadata cache 만료 정책
- Connection별 사용 중인 Job/Workflow 역추적
- PROD 연결 수정 시 승인 프로세스
- Connection 상태 모니터링

import { useCallback, useMemo, useState, type CSSProperties, type DragEvent, type FormEvent, type ReactNode } from 'react';
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  BadgeCheck,
  CircleDot,
  Database,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';

type DatabaseType = 'ORACLE' | 'POSTGRESQL' | 'MYSQL';
type ConnectionRole = 'SOURCE' | 'TARGET' | 'AUDIT';
type EnvironmentType = 'DEV' | 'TEST' | 'PROD';
type ActiveModule = 'workflow' | 'connections';
type ComponentType = 'source-extract' | 'data-cleaning' | 'target-load' | 'quality-check' | 'custom-transform' | 'db-connection' | 'close';
type CanvasDropPayload = { kind: 'component'; componentType: ComponentType };
type ConnectionForm = {
  name: string;
  dbType: DatabaseType;
  host: string;
  port: string;
  databaseName: string;
  serviceName: string;
  sid: string;
  username: string;
  password: string;
  passwordEnvKey: string;
  schemaName: string;
  role: ConnectionRole;
  environment: EnvironmentType;
  connectTimeout: string;
  poolSize: string;
  maxOverflow: string;
  useSsl: boolean;
  readOnly: boolean;
  description: string;
};

type RegisteredConnection = ConnectionForm & {
  id: string;
  status: 'registered' | 'tested';
  createdAt: string;
};

type ComponentConfig = {
  label: string;
  accent: string;
  fields: string[];
};

type JobNodeData = {
  jobCode: string;
  title: string;
  componentType: ComponentType;
  status: 'ready' | 'success' | 'pending';
  connectionLabel: string;
  onDelete: (nodeId: string) => void;
} & Record<string, unknown>;

type JobNode = Node<JobNodeData, 'job'>;

type WorkflowNodeSnapshotData = {
  jobCode: string;
  title: string;
  componentType: ComponentType;
  status: 'ready' | 'success' | 'pending';
  connectionLabel: string;
};

type WorkflowNodeSnapshot = Omit<JobNode, 'data'> & {
  data: WorkflowNodeSnapshotData;
};

type SavedWorkflow = {
  id: string;
  name: string;
  jobCount: number;
  connectionCount: number;
  savedAt: string;
  definition: { workflowName: string; schedule: string; defaultSuccessCondition: string; defaultFailureCondition: string; parallelExecution: boolean };
  jobIds: string[];
  nodes: WorkflowNodeSnapshot[];
  edges: Edge[];
};

const topMenus: Array<{ id: ActiveModule; label: string }> = [
  { id: 'workflow', label: '워크플로우' },
  { id: 'connections', label: 'Connections' },
];

const componentConfigs: Record<ComponentType, ComponentConfig> = {
  'source-extract': {
    label: '원천추출',
    accent: '#60a5fa',
    fields: ['Source DB 연결정보', 'Source Schema', 'Source Table', '조회 조건', 'Watermark 컬럼'],
  },
  'data-cleaning': {
    label: '데이터 정제',
    accent: '#34d399',
    fields: ['정제 규칙', 'Null 처리 방식', '중복 제거 기준', '컬럼 매핑', '예외 처리 정책'],
  },
  'target-load': {
    label: 'Target 적재',
    accent: '#fbbf24',
    fields: ['Target DB 연결정보', 'Target Schema', 'Target Table', '적재 모드', 'Commit 단위'],
  },
  'quality-check': {
    label: '데이터 품질 검증',
    accent: '#c084fc',
    fields: ['검증 대상 컬럼', '필수값 검사', '정합성 규칙', '허용 오류율', '검증 실패 처리'],
  },
  'custom-transform': {
    label: '사용자 정의 처리',
    accent: '#fb7185',
    fields: ['컴포넌트 이름', '입력 데이터셋', '처리 스크립트', '출력 데이터셋', '런타임 옵션'],
  },
  'db-connection': {
    label: 'DB connection',
    accent: '#22d3ee',
    fields: ['DB 유형', 'Host', 'Port', 'DB Name', 'Username', 'Password Env Key', 'Role', 'Environment'],
  },
  'close': {
    label: 'close (닫기)',
    accent: '#60a5fa',
    fields: ['Source DB 연결정보', 'Source Schema', 'Source Table', '조회 조건', 'Watermark 컬럼'],
  },
};

const connectionDefaults: ConnectionForm = {
  name: 'SRC_POSTGRES_DEV',
  dbType: 'POSTGRESQL',
  host: 'localhost',
  port: '5432',
  databaseName: 'source_db',
  serviceName: '',
  sid: '',
  username: 'etl_user',
  password: '',
  passwordEnvKey: 'DB_CONN_SRC_POSTGRES_PASSWORD',
  schemaName: 'public',
  role: 'SOURCE',
  environment: 'DEV',
  connectTimeout: '10',
  poolSize: '5',
  maxOverflow: '10',
  useSsl: false,
  readOnly: false,
  description: '원천 시스템 개발 DB',
};

const workflowDefaults = {
  workflowName: '',
  schedule: '0 2 * * *',
  defaultSuccessCondition: '성공 시 다음 Job 실행',
  defaultFailureCondition: '실패 시 Workflow 중지',
  parallelExecution: false,
};

const seedConnections: RegisteredConnection[] = [
  {
    id: 'conn-source-postgres',
    name: 'SRC_POSTGRES_DEV',
    dbType: 'POSTGRESQL',
    host: '10.10.10.21',
    port: '5432',
    databaseName: 'source_db',
    serviceName: '',
    sid: '',
    username: 'etl_reader',
    password: '',
    passwordEnvKey: 'DB_CONN_SRC_POSTGRES_PASSWORD',
    schemaName: 'public',
    role: 'SOURCE',
    environment: 'DEV',
    connectTimeout: '10',
    poolSize: '5',
    maxOverflow: '10',
    useSsl: false,
    readOnly: true,
    description: '원천 추출용 PostgreSQL 연결',
    status: 'tested',
    createdAt: '2026-07-23 09:00',
  },
  {
    id: 'conn-target-mysql',
    name: 'TGT_MYSQL_MART',
    dbType: 'MYSQL',
    host: '10.10.20.11',
    port: '3306',
    databaseName: 'mart_db',
    serviceName: '',
    sid: '',
    username: 'etl_loader',
    password: '',
    passwordEnvKey: 'DB_CONN_TARGET_MYSQL_PASSWORD',
    schemaName: 'mart',
    role: 'TARGET',
    environment: 'DEV',
    connectTimeout: '10',
    poolSize: '5',
    maxOverflow: '10',
    useSsl: false,
    readOnly: false,
    description: 'Target 적재용 MySQL 연결',
    status: 'registered',
    createdAt: '2026-07-23 09:05',
  },
];

let nodeSequence = 0;
const nodeOrigin: [number, number] = [0.5, 0];

function formatJobCode(index: number) {
  return `JOB_${String(index).padStart(2, '0')}`;
}

function nowLabel() {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

function JobCard({ data, id, selected }: NodeProps<JobNode>) {
  const config = componentConfigs[data.componentType];
  const statusLabel = data.status === 'success' ? '성공' : data.status === 'pending' ? '대기' : '준비';

  return (
    <div
      className={`job-card ${selected ? 'selected' : ''}`}
      style={{ '--job-accent': config.accent } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="job-handle" />
      <div className="job-card-top">
        <span className="job-code">{data.jobCode}</span>
        <span className={`job-status ${data.status}`}>{statusLabel}</span>
      </div>
      <div className="job-title">{data.title}</div>
      <div className="job-meta">
        <CircleDot size={13} />
        <span>{config.label}</span>
      </div>
      <div className="job-meta muted">{data.connectionLabel}</div>
      <div className="job-actions">
        <button type="button" title="Workflow에서 Job 제거" onClick={() => data.onDelete(id)}>
          <Trash2 size={14} />
        </button>
      </div>
      <Handle type="source" position={Position.Right} className="job-handle" />
    </div>
  );
}

const nodeTypes = { job: JobCard };

function App() {
  const [activeModule, setActiveModule] = useState<ActiveModule>('workflow');
  const [connections, setConnections] = useState<RegisteredConnection[]>(seedConnections);
  const [connectionForm, setConnectionForm] = useState<ConnectionForm>(connectionDefaults);
  const [workflowForm, setWorkflowForm] = useState(workflowDefaults);
  const [isWorkflowModalOpen, setIsWorkflowModalOpen] = useState(false);
  const [savedWorkflows, setSavedWorkflows] = useState<SavedWorkflow[]>([]);
  const [selectedSavedWorkflowId, setSelectedSavedWorkflowId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState(seedConnections[0]?.id ?? '');
  const [nodes, setNodes, onNodesChange] = useNodesState<JobNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { screenToFlowPosition } = useReactFlow();
  const [showSaved, setShowSaved] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editingNodeForm, setEditingNodeForm] = useState<{title: string; componentType: ComponentType}>({title: '', componentType: 'source-extract'});

  const selectedConnection = connections.find((connection) => connection.id === selectedConnectionId) ?? connections[0];

  const removeWorkflowNode = useCallback((nodeId: string) => {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
  }, [setEdges, setNodes]);

  // Workflow 생성
  const createWorkflow = () => {
    const workflowName = workflowForm.workflowName.trim();
    const name = workflowName || `workflow-${savedWorkflows.length + 1}`;

    const savedWorkflow: SavedWorkflow = {
      id: `workflow-${Date.now()}`,
      name,
      jobCount: nodes.length,
      connectionCount: edges.length,
      savedAt: nowLabel(),
      definition: { ...workflowForm, workflowName: name },
      jobIds: [],
      nodes: nodes.map(({ data, ...node }) => {
        const { onDelete: _onDelete, ...nodeData } = data;
        return { ...node, data: nodeData };
      }),
      edges: edges.map((edge) => ({ ...edge })),
    };

    setSavedWorkflows((current) => [savedWorkflow, ...current]);
    setSelectedSavedWorkflowId(savedWorkflow.id);
    setNodes([]);
    setEdges([]);
    setWorkflowForm({ ...workflowDefaults, workflowName: '' });
    setIsWorkflowModalOpen(false);
  };

  const onConnect = useCallback(
    (params: Connection) => setEdges((current) => addEdge({ ...params, type: 'smoothstep', animated: true }, current)),
    [setEdges],
  );

  const onCanvasDragStart = (event: DragEvent<HTMLElement>, payload: CanvasDropPayload) => {
    event.dataTransfer.setData('application/ipa-etl-canvas', JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
  };

  const onCanvasDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onCanvasDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rawPayload = event.dataTransfer.getData('application/ipa-etl-canvas');
    if (!rawPayload) return;

    let payload: CanvasDropPayload;
    try {
      payload = JSON.parse(rawPayload) as CanvasDropPayload;
    } catch {
      return;
    }

    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const config = componentConfigs[payload.componentType];
    const nextIndex = nodes.length + 1;

    const newNode: JobNode = {
      id: `node-${payload.componentType}-${nodeSequence++}`,
      type: 'job',
      position,
      origin: [0.5, 0] as [number, number],
      data: {
        jobCode: `COMP_${String(nextIndex).padStart(2, '0')}`,
        title: config.label,
        componentType: payload.componentType,
        status: 'ready',
        connectionLabel: '컴포넌트',
        onDelete: removeWorkflowNode,
      },
    };
    setNodes((current) => current.concat(newNode));
  }, [screenToFlowPosition, removeWorkflowNode]);

  const registerConnection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const newConnection: RegisteredConnection = {
      ...connectionForm,
      id: `conn-${Date.now()}`,
      status: 'registered',
      createdAt: nowLabel(),
    };
    setConnections((current) => [newConnection, ...current]);
    setSelectedConnectionId(newConnection.id);
    setConnectionForm({ ...connectionDefaults, name: '', password: '', description: '' });
  };

  const testConnection = (connectionId: string) => {
    // 실제 API 연동 전까지는 연결 객체 생성 성공 상태를 UI에서 확인할 수 있게 표시합니다.
    setConnections((current) =>
      current.map((connection) => (connection.id === connectionId ? { ...connection, status: 'tested' } : connection)),
    );
  };

  const openNodeEdit = (node: JobNode) => {
    setEditingJobId(node.id);
    setEditingNodeForm({
      title: node.data.title,
      componentType: node.data.componentType,
    });
  };

  const updateNode = (title: string, componentType: ComponentType) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === editingJobId
          ? {
              ...node,
              data: {
                ...node.data,
                title,
                componentType,
                connectionLabel: componentConfigs[componentType].label,
              },
            }
          : node
      )
    );
  };

  const saveNodeEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingJobId) return;
    updateNode(editingNodeForm.title, editingNodeForm.componentType);
    setEditingJobId(null);
  };


  // 캔버스 저장 — 활성화된 워크플로우에 현재 노드 정보 업데이트
  const saveCanvasToWorkflow = () => {
    if (nodes.length === 0) return;

    const nodeSnapshot = nodes.map(({ data, ...node }) => {
      const { onDelete: _onDelete, ...nodeData } = data;
      return { ...node, data: nodeData };
    });

    if (selectedSavedWorkflowId) {
      setSavedWorkflows((current) =>
        current.map((w) => (w.id === selectedSavedWorkflowId ? {
          ...w,
          jobCount: nodes.length,
          connectionCount: edges.length,
          savedAt: nowLabel(),
          definition: { ...workflowForm },
          nodes: nodeSnapshot,
          edges: edges.map((edge) => ({ ...edge })),
        } : w))
      );
    } else {
      const workflowName = workflowForm.workflowName.trim() || `workflow-${savedWorkflows.length + 1}`;
      setWorkflowForm((current) => ({ ...current, workflowName }));
      const savedWorkflow: SavedWorkflow = {
        id: `workflow-${Date.now()}`,
        name: workflowName,
        jobCount: nodes.length,
        connectionCount: edges.length,
        savedAt: nowLabel(),
        definition: { ...workflowForm, workflowName },
        jobIds: [],
        nodes: nodeSnapshot,
        edges: edges.map((edge) => ({ ...edge })),
      };
      setSavedWorkflows((current) => [savedWorkflow, ...current]);
      setSelectedSavedWorkflowId(savedWorkflow.id);
    }

    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 3000);
  };

  const loadSavedWorkflow = (savedWorkflow: SavedWorkflow) => {
    setWorkflowForm({ ...savedWorkflow.definition });
    setNodes(savedWorkflow.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        onDelete: removeWorkflowNode,
      },
    })));
    setEdges(savedWorkflow.edges.map((edge) => ({ ...edge })));
    setSelectedSavedWorkflowId(savedWorkflow.id);
    setActiveModule('workflow');
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <Workflow size={18} />
          </div>
          <div>
            <p>IPA</p>
            <h1>ETL FlowHub</h1>
          </div>
        </div>

        <div className="sidebar-section-label">워크플로우</div>
        {savedWorkflows.length === 0 ? (
          <p className="sidebar-empty">저장된 워크플로우가 없습니다.</p>
        ) : (
          <div className="sidebar-workflow-list">
            {savedWorkflows.map((wf) => (
              <button
                key={wf.id}
                type="button"
                className={`sidebar-workflow-item ${selectedSavedWorkflowId === wf.id ? 'active' : ''}`}
                onClick={() => loadSavedWorkflow(wf)}
              >
                <strong>{wf.name}</strong>
                <span>노드 {wf.jobCount} · {wf.savedAt}</span>
              </button>
            ))}
          </div>
        )}

        <div className="sidebar-footer">
          <Sparkles size={16} />
          <span>React Flow 기반 ETL 워크플로우 설계</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-main">
            <div className="top-navigation">
              <nav className="main-menu" aria-label="주요 메뉴">
                {topMenus.map((menu) => (
                  <button
                    key={menu.id}
                    type="button"
                    className={activeModule === menu.id ? 'active' : ''}
                    onClick={() => setActiveModule(menu.id)}
                  >
                    {menu.label}
                  </button>
                ))}
              </nav>
            </div>
            <div className="workflow-heading">
              <p>{activeModule.toUpperCase()}</p>
              <h2>{workflowForm.workflowName || 'Start ETL workflow project'}</h2>
            </div>
          </div>
          <div className="topbar-actions">
            {activeModule === 'workflow' && (
              <button type="button" onClick={() => setIsWorkflowModalOpen(true)} title="신규 Workflow 생성">
                <Workflow size={17} />
                <span>Workflow 생성</span>
              </button>
            )}
          </div>
        </header>

        {activeModule === 'workflow' && (
          savedWorkflows.length === 0 ? (
            <div className="empty-state">
              <Layers3Icon />
              <h3>첫 번째 워크플로우를 생성하세요</h3>
              <p>상단의 Workflow 생성 버튼을 누르면 캔버스에서 컴포넌트를 조립할 수 있습니다.</p>
            </div>
          ) : (
            <div className="content-grid workflow-content-grid">
              <div className="flow-surface">
                {nodes.length === 0 && (
                  <div className="empty-state">
                    <Layers3Icon />
                    <h3>컴포넌트를 드래그하여 워크플로우를 설계하세요</h3>
                    <p>오른쪽 컴포넌트 목록에서 캔버스로 컴포넌트를 드래그하면 노드가 추가됩니다.</p>
                  </div>
                )}
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onNodeDoubleClick={(_event, node) => {
                    openNodeEdit(node);
                  }}
                  onDrop={onCanvasDrop}
                  onDragOver={onCanvasDragOver}
                  nodeOrigin={nodeOrigin}
                  minZoom={0.1}
                  maxZoom={4}
                  defaultViewport={{ x: 0, y: 0, zoom: 1 }}
                >
                  <Background color="#334155" gap={26} size={1.2} />
                  <Controls />
                  <MiniMap pannable zoomable nodeStrokeWidth={3} />
                  <div className="canvas-save-btn">
                    <button
                      type="button"
                      onClick={() => {
                        if (nodes.length === 0) return;
                        saveCanvasToWorkflow();
                      }}
                      disabled={nodes.length === 0}
                      title="현재 캔버스 Workflow 저장"
                      className={showSaved ? 'saved' : ''}
                    >
                      {showSaved ? (
                        <>
                          <BadgeCheck size={16} />
                          <span>저장완료!</span>
                        </>
                      ) : (
                        <>
                          <Save size={16} />
                          <span>저장</span>
                        </>
                      )}
                    </button>
                  </div>
                </ReactFlow>
              </div>
              <aside className="detail-panel workflow-side-panel">
                <div className="workflow-tab-content">
                  <PanelTitle icon={<Settings2 size={20} />} eyebrow="컴포넌트" title="컴포넌트 캔버스" />
                  <div className="component-catalog">
                    {Object.entries(componentConfigs).map(([key, config]) => (
                      <article
                        key={key}
                        className="component-catalog-item draggable-catalog-item"
                        style={{ '--component-accent': config.accent } as CSSProperties}
                        draggable
                        onDragStart={(event) => onCanvasDragStart(event, { kind: 'component', componentType: key as ComponentType })}
                      >
                        <strong>{config.label}</strong>
                      </article>
                    ))}
                  </div>
                </div>
              </aside>
            </div>
          )
        )}


        {activeModule === 'connections' && (
          <ManagementLayout
            main={
              <div className="management-board">
                <PanelTitle icon={<Database size={20} />} eyebrow="Connections" title="DB 연결 객체 등록 및 재사용" />
                <div className="data-list">
                  {connections.map((connection) => (
                    <article key={connection.id} className="data-card selectable" onClick={() => setSelectedConnectionId(connection.id)}>
                      <div>
                        <h3>{connection.name}</h3>
                        <p>{formatConnectionDsn(connection)}</p>
                      </div>
                      <div className="card-meta">
                        <span>{connection.role}</span>
                        <span>{connection.environment}</span>
                        <span>{connection.schemaName || 'schema 없음'}</span>
                        <span className={`status-pill ${connection.status}`}>{connection.status}</span>
                        <button type="button" onClick={(event) => { event.stopPropagation(); testConnection(connection.id); }}>객체 생성 테스트</button>
                      </div>
                    </article>
                  ))}
                </div>
                {selectedConnection && (
                  <div className="template-preview">
                    <div className="section-label">Python DB Connection Template</div>
                    <pre>{renderTemplatePreview(selectedConnection)}</pre>
                  </div>
                )}
              </div>
            }
            detail={
              <form className="form-panel" onSubmit={registerConnection}>
                <PanelTitle icon={<Database size={20} />} eyebrow="DB 접속정보" title="연결 객체 등록" />
                <TextField label="Connection 이름" value={connectionForm.name} onChange={(value) => setConnectionForm({ ...connectionForm, name: value })} placeholder="SRC_POSTGRES_DEV" />
                <SelectField label="DB 유형" value={connectionForm.dbType} onChange={(value) => setConnectionForm({ ...connectionForm, dbType: value as DatabaseType, port: defaultPort(value as DatabaseType) })}>
                  <option value="ORACLE">Oracle</option>
                  <option value="POSTGRESQL">PostgreSQL</option>
                  <option value="MYSQL">MySQL</option>
                </SelectField>
                <SelectField label="연결 목적" value={connectionForm.role} onChange={(value) => setConnectionForm({ ...connectionForm, role: value as ConnectionRole })}>
                  <option value="SOURCE">SOURCE</option>
                  <option value="TARGET">TARGET</option>
                  <option value="AUDIT">AUDIT</option>
                </SelectField>
                <SelectField label="환경" value={connectionForm.environment} onChange={(value) => setConnectionForm({ ...connectionForm, environment: value as EnvironmentType })}>
                  <option value="DEV">DEV</option>
                  <option value="TEST">TEST</option>
                  <option value="PROD">PROD</option>
                </SelectField>
                <TextField label="Host" value={connectionForm.host} onChange={(value) => setConnectionForm({ ...connectionForm, host: value })} />
                <TextField label="Port" value={connectionForm.port} onChange={(value) => setConnectionForm({ ...connectionForm, port: value })} />
                <TextField label="Database Name" value={connectionForm.databaseName} onChange={(value) => setConnectionForm({ ...connectionForm, databaseName: value })} placeholder="PostgreSQL/MySQL" />
                <TextField label="Oracle Service Name" value={connectionForm.serviceName} onChange={(value) => setConnectionForm({ ...connectionForm, serviceName: value, sid: value ? '' : connectionForm.sid })} placeholder="MESDB" />
                <TextField label="Oracle SID" value={connectionForm.sid} onChange={(value) => setConnectionForm({ ...connectionForm, sid: value, serviceName: value ? '' : connectionForm.serviceName })} placeholder="ORCL" />
                <TextField label="Username" value={connectionForm.username} onChange={(value) => setConnectionForm({ ...connectionForm, username: value })} />
                <TextField label="Password 테스트 입력" type="password" value={connectionForm.password} onChange={(value) => setConnectionForm({ ...connectionForm, password: value })} />
                <TextField label="Password Env Key" value={connectionForm.passwordEnvKey} onChange={(value) => setConnectionForm({ ...connectionForm, passwordEnvKey: value })} placeholder="DB_CONN_ORACLE_MES_PASSWORD" />
                <TextField label="Default Schema" value={connectionForm.schemaName} onChange={(value) => setConnectionForm({ ...connectionForm, schemaName: value })} />
                <div className="form-grid compact">
                  <TextField label="연결 제한시간" value={connectionForm.connectTimeout} onChange={(value) => setConnectionForm({ ...connectionForm, connectTimeout: value })} />
                  <TextField label="Pool Size" value={connectionForm.poolSize} onChange={(value) => setConnectionForm({ ...connectionForm, poolSize: value })} />
                  <TextField label="Max Overflow" value={connectionForm.maxOverflow} onChange={(value) => setConnectionForm({ ...connectionForm, maxOverflow: value })} />
                </div>
                <div className="toggle-grid">
                  <label><input type="checkbox" checked={connectionForm.useSsl} onChange={(event) => setConnectionForm({ ...connectionForm, useSsl: event.target.checked })} /> SSL 사용</label>
                  <label><input type="checkbox" checked={connectionForm.readOnly} onChange={(event) => setConnectionForm({ ...connectionForm, readOnly: event.target.checked })} /> 읽기 전용</label>
                </div>
                <TextAreaField label="설명" value={connectionForm.description} onChange={(value) => setConnectionForm({ ...connectionForm, description: value })} />
                <div className="input-help">
                  비밀번호는 저장값보다 password_env_key 참조를 권장합니다. 다른 컴포넌트는 비밀번호 없이 connection_id만 선택해 재사용합니다.
                </div>
                <button type="submit" className="primary-submit">
                  <Save size={17} />
                  <span>연결 객체 등록</span>
                </button>
              </form>
            }
          />
        )}


        {editingJobId && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setEditingJobId(null);
            }}
          >
            <form className="form-panel job-edit-modal" role="dialog" aria-modal="true" aria-labelledby="job-edit-modal-title" onSubmit={saveNodeEdit}>
              <div className="modal-heading">
                <PanelTitle icon={<Settings2 size={20} />} eyebrow="컴포넌트 수정" title="컴포넌트 정보" />
                <button type="button" className="icon-button" title="닫기" onClick={() => setEditingJobId(null)}>
                  <X size={18} />
                </button>
              </div>
              <div id="job-edit-modal-title" className="sr-only">컴포넌트 정보 수정</div>
              <TextField label="이름" value={editingNodeForm.title} onChange={(value) => setEditingNodeForm({ ...editingNodeForm, title: value })} />
              <label className="field-label">
                <span>컴포넌트 유형</span>
                <div className="readonly-field">{componentConfigs[editingNodeForm.componentType].label}</div>
              </label>
              <button type="submit" className="primary-submit">
                <Save size={17} />
                <span>수정 완료</span>
              </button>
            </form>
          </div>
        )}

        {isWorkflowModalOpen && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setIsWorkflowModalOpen(false);
            }}
          >
            <form className="form-panel workflow-modal" role="dialog" aria-modal="true" aria-labelledby="workflow-modal-title" onSubmit={(event) => { event.preventDefault(); createWorkflow(); }}>
              <div className="modal-heading">
                <PanelTitle icon={<Workflow size={20} />} eyebrow="Workflow 조립" title="신규 워크플로우" />
                <button type="button" className="icon-button" title="닫기" onClick={() => setIsWorkflowModalOpen(false)}>
                  <X size={18} />
                </button>
              </div>
              <div id="workflow-modal-title" className="sr-only">신규 워크플로우</div>
              <TextField label="Workflow 이름" value={workflowForm.workflowName} onChange={(value) => setWorkflowForm({ ...workflowForm, workflowName: value })} placeholder="daily_customer_load" />
              <TextField label="실행 스케줄" value={workflowForm.schedule} onChange={(value) => setWorkflowForm({ ...workflowForm, schedule: value })} />
              <div className="input-help">컴포넌트 기반 워크플로우 설계</div>

              <button type="submit" className="primary-submit">
                <Save size={17} />
                <span>Workflow 생성</span>
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}

function ManagementLayout({ main, detail }: { main: ReactNode; detail: ReactNode }) {
  return (
    <div className="content-grid">
      <section className="flow-surface">{main}</section>
      <aside className="detail-panel">{detail}</aside>
    </div>
  );
}

function Placeholder({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="module-placeholder">
      <div className="panel-title">
        {icon}
        <div>
          <p>준비 중</p>
          <h3>{title}</h3>
        </div>
      </div>
      <p>{body}</p>
    </div>
  );
}

function PanelTitle({ icon, eyebrow, title }: { icon: ReactNode; eyebrow: string; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <div>
        <p>{eyebrow}</p>
        <h3>{title}</h3>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="field-label">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="field-label">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field-label">
      <span>{label}</span>
      <textarea className="compact-area" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Layers3Icon() {
  return <BadgeCheck size={34} />;
}

function defaultPort(databaseType: DatabaseType) {
  if (databaseType === 'ORACLE') return '1521';
  if (databaseType === 'MYSQL') return '3306';
  return '5432';
}

function formatConnectionDsn(connection: RegisteredConnection) {
  const databasePart = connection.dbType === 'ORACLE'
    ? connection.serviceName || connection.sid || 'SERVICE_OR_SID'
    : connection.databaseName || 'database';
  return `${connection.dbType}://${connection.username}:***@${connection.host}:${connection.port}/${databasePart}`;
}

function renderTemplatePreview(connection: RegisteredConnection) {
  const driver = {
    ORACLE: 'oracle+oracledb',
    POSTGRESQL: 'postgresql+psycopg',
    MYSQL: 'mysql+mysqlconnector',
  }[connection.dbType];

  const databaseLine = connection.dbType === 'ORACLE'
    ? `service_name=${JSON.stringify(connection.serviceName || null)},
    sid=${JSON.stringify(connection.sid || null)},`
    : `database_name=${JSON.stringify(connection.databaseName || null)},`;

  return `from app.connection_factory import create_database_engine
from app.connection_models import ConnectionRole, DatabaseConnectionInput, DatabaseType, EnvironmentType


connection_config = DatabaseConnectionInput(
    connection_name="${connection.name}",
    database_type=DatabaseType.${connection.dbType},
    host="${connection.host}",
    port=${connection.port || defaultPort(connection.dbType)},
    ${databaseLine}
    default_schema=${JSON.stringify(connection.schemaName || null)},
    username="${connection.username}",
    password_env_key="${connection.passwordEnvKey || '<PASSWORD_ENV_KEY>'}",
    connection_role=ConnectionRole.${connection.role},
    environment=EnvironmentType.${connection.environment},
    connect_timeout=${connection.connectTimeout || '10'},
    pool_size=${connection.poolSize || '5'},
    max_overflow=${connection.maxOverflow || '10'},
    use_ssl=${connection.useSsl ? 'True' : 'False'},
    read_only=${connection.readOnly ? 'True' : 'False'},
)


def get_engine():
    # 등록된 접속정보로 연결 객체를 만들고 다른 Job 컴포넌트가 재사용합니다.
    return create_database_engine(connection_config)

# SQLAlchemy driver: ${driver}`;
}

export default App;

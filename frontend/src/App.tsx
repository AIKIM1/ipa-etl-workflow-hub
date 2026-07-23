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
  type OnConnectEnd,
} from '@xyflow/react';
import {
  BadgeCheck,
  CircleDot,
  Database,
  GitBranchPlus,
  History,
  Activity,
  Plus,
  Save,
  Search,
  Settings,
  Settings2,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';

type LoadType = 'Full' | 'Incremental';
type JobStatus = 'ready' | 'success' | 'pending';
type DatabaseType = 'ORACLE' | 'POSTGRESQL' | 'MYSQL';
type ConnectionRole = 'SOURCE' | 'TARGET' | 'AUDIT';
type EnvironmentType = 'DEV' | 'TEST' | 'PROD';
type ActiveModule = 'workflow' | 'jobs' | 'connections' | 'history' | 'monitoring' | 'settings';
type WorkflowSideTab = 'linked-jobs' | 'components' | 'workflows';
type ComponentType = 'source-extract' | 'data-cleaning' | 'target-load' | 'quality-check' | 'custom-transform';
type CanvasDropPayload =
  | { kind: 'job'; jobId: string }
  | { kind: 'component'; componentType: ComponentType };
type PendingComponentDrop = {
  componentType: ComponentType;
  position: { x: number; y: number };
};

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

type JobForm = {
  name: string;
  componentType: ComponentType;
  sourceConnectionId: string;
  targetConnectionId: string;
  description: string;
  processingCode: string;
  inputContract: string;
  outputContract: string;
  retryCount: string;
  version: string;
};

type ManagedJob = JobForm & {
  id: string;
  code: string;
  status: JobStatus;
  enabled: boolean;
};

type WorkflowForm = {
  workflowName: string;
  schedule: string;
  defaultSuccessCondition: string;
  defaultFailureCondition: string;
  parallelExecution: boolean;
};

type SavedWorkflow = {
  id: string;
  name: string;
  jobCount: number;
  connectionCount: number;
  savedAt: string;
  definition: WorkflowForm;
  jobIds: string[];
  nodes: WorkflowNodeSnapshot[];
  edges: Edge[];
};

type ComponentConfig = {
  label: string;
  accent: string;
  fields: string[];
};

type JobNodeData = {
  managedJobId?: string;
  jobCode: string;
  title: string;
  componentType: ComponentType;
  status: JobStatus;
  connectionLabel: string;
  onDelete: (nodeId: string) => void;
} & Record<string, unknown>;

type JobNode = Node<JobNodeData, 'job'>;
type WorkflowNodeSnapshotData = {
  managedJobId?: string;
  jobCode: string;
  title: string;
  componentType: ComponentType;
  status: JobStatus;
  connectionLabel: string;
};
type WorkflowNodeSnapshot = Omit<JobNode, 'data'> & {
  data: WorkflowNodeSnapshotData;
};

const topMenus: Array<{ id: ActiveModule; label: string }> = [
  { id: 'workflow', label: '워크플로우' },
  { id: 'jobs', label: 'Job 관리' },
  { id: 'connections', label: 'Connections' },
  { id: 'history', label: '실행 이력' },
  { id: 'monitoring', label: '모니터링' },
  { id: 'settings', label: '설정' },
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

const jobDefaults: JobForm = {
  name: '원천 추출 Job',
  componentType: 'source-extract',
  sourceConnectionId: '',
  targetConnectionId: '',
  description: 'Source 테이블에서 증분 데이터를 추출합니다.',
  processingCode: 'SELECT *\nFROM public.customer\nWHERE updated_at >= :watermark',
  inputContract: 'watermark: datetime',
  outputContract: 'customer_delta dataset',
  retryCount: '3',
  version: '1.0.0',
};

const workflowDefaults: WorkflowForm = {
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

const seedJobs: ManagedJob[] = [
  {
    id: 'job-source-extract',
    code: 'JOB_01',
    name: '원천 추출',
    componentType: 'source-extract',
    sourceConnectionId: 'conn-source-postgres',
    targetConnectionId: '',
    description: 'Source DB에서 원천 데이터를 추출합니다.',
    processingCode: 'SELECT * FROM public.customer WHERE updated_at >= :watermark',
    inputContract: 'watermark: datetime',
    outputContract: 'customer_delta dataset',
    retryCount: '3',
    version: '1.0.0',
    status: 'success',
    enabled: true,
  },
  {
    id: 'job-data-cleaning',
    code: 'JOB_02',
    name: '데이터 정제',
    componentType: 'data-cleaning',
    sourceConnectionId: 'conn-source-postgres',
    targetConnectionId: '',
    description: 'Null, 중복, 컬럼 매핑 규칙을 적용합니다.',
    processingCode: 'clean_nulls | deduplicate | map_columns',
    inputContract: 'customer_delta dataset',
    outputContract: 'customer_clean dataset',
    retryCount: '2',
    version: '1.0.0',
    status: 'success',
    enabled: true,
  },
  {
    id: 'job-target-load',
    code: 'JOB_03',
    name: 'Target 적재',
    componentType: 'target-load',
    sourceConnectionId: '',
    targetConnectionId: 'conn-target-mysql',
    description: '정제된 데이터를 Target 테이블에 적재합니다.',
    processingCode: 'UPSERT mart.dim_customer',
    inputContract: 'customer_clean dataset',
    outputContract: 'load_result: count',
    retryCount: '3',
    version: '1.0.0',
    status: 'ready',
    enabled: true,
  },
  {
    id: 'job-quality-check',
    code: 'JOB_04',
    name: '데이터 품질 검증',
    componentType: 'quality-check',
    sourceConnectionId: '',
    targetConnectionId: 'conn-target-mysql',
    description: '적재 결과의 필수값, 건수, 정합성을 검증합니다.',
    processingCode: 'required_fields | row_count | referential_integrity',
    inputContract: 'load_result: count',
    outputContract: 'quality_report',
    retryCount: '1',
    version: '1.0.0',
    status: 'pending',
    enabled: true,
  },
];

let nodeSequence = 5;
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
  const [jobs, setJobs] = useState<ManagedJob[]>(seedJobs);
  const [jobForm, setJobForm] = useState<JobForm>(jobDefaults);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editingJobForm, setEditingJobForm] = useState<JobForm>(jobDefaults);
  const [workflowForm, setWorkflowForm] = useState<WorkflowForm>(workflowDefaults);
  const [isWorkflowModalOpen, setIsWorkflowModalOpen] = useState(false);
  const [isWorkflowSaveModalOpen, setIsWorkflowSaveModalOpen] = useState(false);
  const [workflowSaveName, setWorkflowSaveName] = useState('');
  const [isWorkflowJobCreateOpen, setIsWorkflowJobCreateOpen] = useState(false);
  const [pendingComponentDrop, setPendingComponentDrop] = useState<PendingComponentDrop | null>(null);
  const [savedWorkflows, setSavedWorkflows] = useState<SavedWorkflow[]>([]);
  const [selectedSavedWorkflowId, setSelectedSavedWorkflowId] = useState<string | null>(null);
  const [workflowSideTab, setWorkflowSideTab] = useState<WorkflowSideTab>('linked-jobs');
  const [workflowJobIds, setWorkflowJobIds] = useState<string[]>(seedJobs.map((job) => job.id));
  const [selectedConnectionId, setSelectedConnectionId] = useState(seedConnections[0]?.id ?? '');
  const [nodes, setNodes, onNodesChange] = useNodesState<JobNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { screenToFlowPosition } = useReactFlow();

  const connectionById = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections],
  );

  const selectedConnection = connections.find((connection) => connection.id === selectedConnectionId) ?? connections[0];
  const selectedJobList = jobs.filter((job) => workflowJobIds.includes(job.id));

  const removeWorkflowNode = useCallback((nodeId: string) => {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
  }, [setEdges, setNodes]);

  const buildWorkflowNode = useCallback(
    (job: ManagedJob, index: number): JobNode => {
      const sourceConnection = job.sourceConnectionId ? connectionById.get(job.sourceConnectionId)?.name : '';
      const targetConnection = job.targetConnectionId ? connectionById.get(job.targetConnectionId)?.name : '';
      const connectionLabel = sourceConnection || targetConnection || '연결 객체 미지정';

      return {
        id: `node-${job.id}`,
        type: 'job',
        position: { x: 80 + index * 285, y: 170 },
        data: {
          managedJobId: job.id,
          jobCode: job.code,
          title: job.name,
          componentType: job.componentType,
          status: job.status,
          connectionLabel,
          onDelete: removeWorkflowNode,
        },
      };
    },
    [connectionById, removeWorkflowNode],
  );

  // Workflow는 Job 관리에서 등록된 Job만 선택해 실행 순서와 의존 관계를 조립합니다.
  const createWorkflowFromManagedJobs = () => {
    const nextNodes = selectedJobList.map((job, index) => buildWorkflowNode(job, index));
    const nextEdges = nextNodes.slice(0, -1).map((node, index) => ({
      id: `${node.id}-${nextNodes[index + 1].id}`,
      source: node.id,
      target: nextNodes[index + 1].id,
      type: 'smoothstep',
      animated: index >= 1,
      style: { stroke: '#64748b', strokeWidth: 2 },
      label: workflowForm.defaultSuccessCondition,
      labelStyle: { fill: '#cbd5e1', fontSize: 11 },
      labelBgStyle: { fill: '#0f172a', fillOpacity: 0.92 },
    }));

    nodeSequence = nextNodes.length + 1;
    setNodes(nextNodes);
    setEdges(nextEdges);
    setIsWorkflowModalOpen(false);
  };

  const onConnect = useCallback(
    (params: Connection) => setEdges((current) => addEdge({ ...params, type: 'smoothstep', animated: true }, current)),
    [setEdges],
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      if (!connectionState.isValid && connectionState.fromNode) {
        const fallbackJob = jobs.find((job) => !nodes.some((node) => node.data.jobCode === job.code));
        if (!fallbackJob) return;

        const { clientX, clientY } = 'changedTouches' in event ? event.changedTouches[0] : event;
        const newNode = {
          ...buildWorkflowNode(fallbackJob, nodeSequence++),
          id: `node-${fallbackJob.id}-${nodeSequence}`,
          position: screenToFlowPosition({ x: clientX, y: clientY }),
          origin: [0.5, 0] as [number, number],
        };

        setNodes((current) => current.concat(newNode));
        setEdges((current) =>
          current.concat({
            id: `${connectionState.fromNode?.id}-${newNode.id}`,
            source: connectionState.fromNode?.id ?? '',
            target: newNode.id,
            type: 'smoothstep',
            animated: true,
          }),
        );
      }
    },
    [buildWorkflowNode, jobs, nodes, screenToFlowPosition, setEdges, setNodes],
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
    if (payload.kind === 'job') {
      const job = jobs.find((candidate) => candidate.id === payload.jobId);
      if (!job) return;

      const nodeId = `node-${job.id}-${nodeSequence++}`;
      setNodes((current) => current.concat({
        ...buildWorkflowNode(job, 0),
        id: nodeId,
        position,
        origin: [0.5, 0] as [number, number],
      }));
      return;
    }

    const config = componentConfigs[payload.componentType];
    setPendingComponentDrop({ componentType: payload.componentType, position });
    setJobForm({
      ...jobDefaults,
      name: `${config.label} Job`,
      componentType: payload.componentType,
      sourceConnectionId: '',
      targetConnectionId: '',
      description: `${config.label} 컴포넌트를 Workflow에서 등록합니다.`,
      processingCode: '',
      inputContract: '',
      outputContract: '',
    });
    setWorkflowSideTab('components');
    setIsWorkflowJobCreateOpen(true);
  }, [buildWorkflowNode, jobs, screenToFlowPosition, setNodes]);

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

  const createJob = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextIndex = jobs.length + 1;
    const newJob: ManagedJob = {
      ...jobForm,
      id: `job-${Date.now()}`,
      code: formatJobCode(nextIndex),
      status: 'ready',
      enabled: true,
    };
    setJobs((current) => [...current, newJob]);
    if (pendingComponentDrop) {
      const nodeId = `node-${newJob.id}-${nodeSequence++}`;
      setNodes((current) => current.concat({
        ...buildWorkflowNode(newJob, 0),
        id: nodeId,
        position: pendingComponentDrop.position,
        origin: [0.5, 0] as [number, number],
      }));
      setPendingComponentDrop(null);
    }
    setJobForm({
      ...jobDefaults,
      sourceConnectionId: connections[0]?.id ?? '',
      targetConnectionId: connections[1]?.id ?? '',
    });
    setIsWorkflowJobCreateOpen(false);
  };

  const toggleWorkflowJob = (jobId: string) => {
    setWorkflowJobIds((current) =>
      current.includes(jobId) ? current.filter((id) => id !== jobId) : [...current, jobId],
    );
  };

  const toggleJobEnabled = (jobId: string) => {
    setJobs((current) => current.map((job) => (
      job.id === jobId ? { ...job, enabled: !job.enabled, status: job.enabled ? 'pending' : 'ready' } : job
    )));
  };

  const openJobEdit = (job: ManagedJob) => {
    setEditingJobId(job.id);
    setEditingJobForm({
      name: job.name,
      componentType: job.componentType,
      sourceConnectionId: job.sourceConnectionId,
      targetConnectionId: job.targetConnectionId,
      description: job.description,
      processingCode: job.processingCode,
      inputContract: job.inputContract,
      outputContract: job.outputContract,
      retryCount: job.retryCount,
      version: job.version,
    });
  };

  const updateJob = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingJobId) return;

    const sourceConnection = editingJobForm.sourceConnectionId
      ? connectionById.get(editingJobForm.sourceConnectionId)?.name
      : '';
    const targetConnection = editingJobForm.targetConnectionId
      ? connectionById.get(editingJobForm.targetConnectionId)?.name
      : '';
    const connectionLabel = sourceConnection || targetConnection || '연결 객체 미지정';

    setJobs((current) => current.map((job) => (
      job.id === editingJobId ? { ...job, ...editingJobForm } : job
    )));
    setNodes((current) => current.map((node) => (
      node.data.managedJobId === editingJobId
        ? {
            ...node,
            data: {
              ...node.data,
              title: editingJobForm.name,
              componentType: editingJobForm.componentType,
              connectionLabel,
            },
          }
        : node
    )));
    setEditingJobId(null);
  };

  const openJobCreate = () => {
    setWorkflowSideTab('linked-jobs');
    setPendingComponentDrop(null);
    setIsWorkflowJobCreateOpen(true);
  };

  const closeWorkflowJobCreate = () => {
    setPendingComponentDrop(null);
    setIsWorkflowJobCreateOpen(false);
  };

  const openWorkflowSaveModal = () => {
    if (nodes.length === 0) return;
    setWorkflowSaveName(workflowForm.workflowName);
    setIsWorkflowSaveModalOpen(true);
  };

  const saveWorkflowCanvas = () => {
    if (nodes.length === 0) return;
    const workflowName = workflowSaveName.trim();
    if (!workflowName) return;

    const savedWorkflow: SavedWorkflow = {
      id: `workflow-${Date.now()}`,
      name: workflowName,
      jobCount: nodes.length,
      connectionCount: edges.length,
      savedAt: nowLabel(),
      definition: { ...workflowForm, workflowName },
      jobIds: [...workflowJobIds],
      // 화면 제어 함수는 저장하지 않고, 목록에서 불러올 때 현재 캔버스 함수로 다시 연결합니다.
      nodes: nodes.map(({ data, ...node }) => {
        const { onDelete: _onDelete, ...nodeData } = data;
        return { ...node, data: nodeData };
      }),
      edges: edges.map((edge) => ({ ...edge })),
    };
    setSavedWorkflows((current) => [savedWorkflow, ...current]);
    setSelectedSavedWorkflowId(savedWorkflow.id);
    setWorkflowForm((current) => ({ ...current, workflowName }));
    setWorkflowSideTab('workflows');
    setIsWorkflowSaveModalOpen(false);
  };

  const loadSavedWorkflow = (savedWorkflow: SavedWorkflow) => {
    setWorkflowForm({ ...savedWorkflow.definition });
    setWorkflowJobIds([...savedWorkflow.jobIds]);
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

        <div className="search-box">
          <Search size={16} />
          <span>LLM chat 작업공간</span>
        </div>

        <div className="sidebar-note">
          <GitBranchPlus size={18} />
          <span>Connections에서 DB 연결 객체를 등록하고, Job 관리에서 Job을 만든 뒤 Workflow에서 연결합니다.</span>
        </div>

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
            {activeModule === 'workflow' && (
              <button type="button" onClick={openWorkflowSaveModal} disabled={nodes.length === 0} title="현재 캔버스 Workflow 저장">
                <Save size={17} />
                <span>Workflow 저장</span>
              </button>
            )}
          </div>
        </header>

        {activeModule === 'workflow' && (
          <div className="content-grid workflow-content-grid">
            <div className="flow-surface">
              {nodes.length === 0 && (
                <div className="empty-state">
                  <Layers3Icon />
                  <h3>Job 관리에서 만든 Job을 Workflow에 연결하세요</h3>
                  <p>상단의 Workflow 생성 버튼을 누르고 연결할 Job을 선택하면 캔버스에 순서대로 배치됩니다.</p>
                </div>
              )}
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onConnectEnd={onConnectEnd}
                onNodeDoubleClick={(_event, node) => {
                  const job = jobs.find((candidate) => candidate.id === node.data.managedJobId);
                  if (job) openJobEdit(job);
                }}
                onDrop={onCanvasDrop}
                onDragOver={onCanvasDragOver}
                fitView
                fitViewOptions={{ padding: 0.25 }}
                nodeOrigin={nodeOrigin}
                minZoom={0.35}
              >
                <Background color="#334155" gap={26} size={1.2} />
                <Controls />
                <MiniMap pannable zoomable nodeStrokeWidth={3} />
              </ReactFlow>
            </div>
            <aside className="detail-panel workflow-side-panel">
              {isWorkflowJobCreateOpen ? (
                <form className="form-panel workflow-inline-job-form" onSubmit={createJob}>
                  <div className="workflow-panel-heading">
                    <PanelTitle icon={<Settings2 size={20} />} eyebrow="Workflow에서 Job 등록" title="신규 Job" />
                    <button type="button" className="icon-button" title="연결 Job으로 돌아가기" onClick={closeWorkflowJobCreate}>
                      <X size={18} />
                    </button>
                  </div>
                  <TextField label="Job 이름" value={jobForm.name} onChange={(value) => setJobForm({ ...jobForm, name: value })} />
                  <SelectField label="컴포넌트 유형" value={jobForm.componentType} onChange={(value) => setJobForm({ ...jobForm, componentType: value as ComponentType })}>
                    {Object.entries(componentConfigs).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </SelectField>
                  <SelectField label="Source 연결 객체" value={jobForm.sourceConnectionId} onChange={(value) => setJobForm({ ...jobForm, sourceConnectionId: value })}>
                    <option value="">선택 안 함</option>
                    <ConnectionOptions connections={connections} />
                  </SelectField>
                  <SelectField label="Target 연결 객체" value={jobForm.targetConnectionId} onChange={(value) => setJobForm({ ...jobForm, targetConnectionId: value })}>
                    <option value="">선택 안 함</option>
                    <ConnectionOptions connections={connections} />
                  </SelectField>
                  <TextAreaField label="Job 설명" value={jobForm.description} onChange={(value) => setJobForm({ ...jobForm, description: value })} />
                  <TextAreaField label="SQL 또는 처리 코드" value={jobForm.processingCode} onChange={(value) => setJobForm({ ...jobForm, processingCode: value })} />
                  <TextField label="입력값 계약" value={jobForm.inputContract} onChange={(value) => setJobForm({ ...jobForm, inputContract: value })} placeholder="watermark: datetime" />
                  <TextField label="출력값 계약" value={jobForm.outputContract} onChange={(value) => setJobForm({ ...jobForm, outputContract: value })} placeholder="customer_delta dataset" />
                  <div className="form-grid compact">
                    <TextField label="재시도 횟수" value={jobForm.retryCount} onChange={(value) => setJobForm({ ...jobForm, retryCount: value })} />
                    <TextField label="버전" value={jobForm.version} onChange={(value) => setJobForm({ ...jobForm, version: value })} placeholder="1.0.0" />
                  </div>
                  <div className="input-help">
                    {pendingComponentDrop
                      ? '드롭한 컴포넌트는 Job 등록 완료 후 캔버스에 표시됩니다.'
                      : '등록한 Job은 연결 Job 탭에서 바로 선택하거나 캔버스로 드래그할 수 있습니다.'}
                  </div>
                  <button type="submit" className="primary-submit">
                    <Save size={17} />
                    <span>Job 등록</span>
                  </button>
                </form>
              ) : (
                <>
              <div className="workflow-tabs" role="tablist" aria-label="워크플로우 작업 패널">
                <button
                  type="button"
                  role="tab"
                  aria-selected={workflowSideTab === 'linked-jobs'}
                  className={workflowSideTab === 'linked-jobs' ? 'active' : ''}
                  onClick={() => setWorkflowSideTab('linked-jobs')}
                >
                  연결 Job
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workflowSideTab === 'components'}
                  className={workflowSideTab === 'components' ? 'active' : ''}
                  onClick={() => setWorkflowSideTab('components')}
                >
                  컴포넌트 캔버스
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workflowSideTab === 'workflows'}
                  className={workflowSideTab === 'workflows' ? 'active' : ''}
                  onClick={() => setWorkflowSideTab('workflows')}
                >
                  워크플로우 목록
                </button>
              </div>

              {workflowSideTab === 'linked-jobs' && (
                <div className="workflow-tab-content">
                  <div className="workflow-panel-heading">
                    <PanelTitle icon={<Workflow size={20} />} eyebrow="등록된 활성 Job" title="연결 Job" />
                    <button type="button" className="inline-create-button" onClick={openJobCreate} title="신규 Job 생성">
                      <Plus size={16} />
                      <span>Job 생성</span>
                    </button>
                  </div>
                  <div className="check-list">
                    {jobs.filter((job) => job.enabled).map((job) => (
                      <label
                        key={job.id}
                        className="check-row draggable-catalog-item"
                        draggable
                        onDragStart={(event) => onCanvasDragStart(event, { kind: 'job', jobId: job.id })}
                      >
                        <input type="checkbox" checked={workflowJobIds.includes(job.id)} onChange={() => toggleWorkflowJob(job.id)} />
                        <span>{job.code}</span>
                        <strong>{job.name} v{job.version}</strong>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {workflowSideTab === 'components' && (
                <div className="workflow-tab-content">
                  <PanelTitle icon={<Settings2 size={20} />} eyebrow="Job 구성 요소" title="컴포넌트 캔버스" />
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
                        <span>{config.fields.slice(0, 3).join(' · ')}</span>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {workflowSideTab === 'workflows' && (
                <div className="workflow-tab-content">
                  <PanelTitle icon={<Save size={20} />} eyebrow="캔버스 저장본" title="워크플로우 목록" />
                  {savedWorkflows.length === 0 ? (
                    <p className="workflow-list-empty">저장된 워크플로우가 없습니다.</p>
                  ) : (
                    <div className="saved-workflow-items">
                      {savedWorkflows.map((savedWorkflow) => (
                        <button
                          key={savedWorkflow.id}
                          type="button"
                          className={selectedSavedWorkflowId === savedWorkflow.id ? 'active' : ''}
                          onClick={() => loadSavedWorkflow(savedWorkflow)}
                        >
                          <strong>{savedWorkflow.name}</strong>
                          <span>Job {savedWorkflow.jobCount} · 연결 {savedWorkflow.connectionCount}</span>
                          <small>{savedWorkflow.savedAt}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
                </>
              )}
            </aside>
          </div>
        )}

        {activeModule === 'jobs' && (
          <ManagementLayout
            main={
              <div className="management-board">
                <PanelTitle icon={<Settings2 size={20} />} eyebrow="재사용 가능한 실행 단위" title="Job 목록, 버전, 상태 관리" />
                <div className="data-list">
                  {jobs.map((job) => (
                    <article key={job.id} className="data-card selectable" onDoubleClick={() => openJobEdit(job)}>
                      <div>
                        <span className="job-code">{job.code}</span>
                        <h3>{job.name}</h3>
                        <p>{job.description}</p>
                        <p className="job-contract">입력: {job.inputContract || '정의 없음'} · 출력: {job.outputContract || '정의 없음'}</p>
                      </div>
                      <div className="card-meta">
                        <span>{componentConfigs[job.componentType].label}</span>
                        <span>v{job.version}</span>
                        <span>재시도 {job.retryCount}회</span>
                        <span className={`status-pill ${job.status}`}>{job.status}</span>
                        <button type="button" onClick={() => toggleJobEnabled(job.id)}>{job.enabled ? '활성' : '비활성'}</button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            }
            detail={
              <form id="job-create-form" className="form-panel" onSubmit={createJob}>
                <PanelTitle icon={<Settings2 size={20} />} eyebrow="Job 먼저 생성" title="신규 Job" />
                <TextField label="Job 이름" value={jobForm.name} onChange={(value) => setJobForm({ ...jobForm, name: value })} />
                <SelectField label="컴포넌트 유형" value={jobForm.componentType} onChange={(value) => setJobForm({ ...jobForm, componentType: value as ComponentType })}>
                  {Object.entries(componentConfigs).map(([key, config]) => (
                    <option key={key} value={key}>{config.label}</option>
                  ))}
                </SelectField>
                <SelectField label="Source 연결 객체" value={jobForm.sourceConnectionId} onChange={(value) => setJobForm({ ...jobForm, sourceConnectionId: value })}>
                  <option value="">선택 안 함</option>
                  <ConnectionOptions connections={connections} />
                </SelectField>
                <SelectField label="Target 연결 객체" value={jobForm.targetConnectionId} onChange={(value) => setJobForm({ ...jobForm, targetConnectionId: value })}>
                  <option value="">선택 안 함</option>
                  <ConnectionOptions connections={connections} />
                </SelectField>
                <TextAreaField label="Job 설명" value={jobForm.description} onChange={(value) => setJobForm({ ...jobForm, description: value })} />
                <TextAreaField label="SQL 또는 처리 코드" value={jobForm.processingCode} onChange={(value) => setJobForm({ ...jobForm, processingCode: value })} />
                <TextField label="입력값 계약" value={jobForm.inputContract} onChange={(value) => setJobForm({ ...jobForm, inputContract: value })} placeholder="watermark: datetime" />
                <TextField label="출력값 계약" value={jobForm.outputContract} onChange={(value) => setJobForm({ ...jobForm, outputContract: value })} placeholder="customer_delta dataset" />
                <div className="form-grid compact">
                  <TextField label="재시도 횟수" value={jobForm.retryCount} onChange={(value) => setJobForm({ ...jobForm, retryCount: value })} />
                  <TextField label="버전" value={jobForm.version} onChange={(value) => setJobForm({ ...jobForm, version: value })} placeholder="1.0.0" />
                </div>
                <div className="input-help">
                  Job은 독립적으로 검증·버전 관리합니다. 선택한 연결 객체 ID와 처리 정의를 저장하고, Workflow는 이 Job을 참조해 조립합니다.
                </div>
                <button type="submit" className="primary-submit">
                  <Save size={17} />
                  <span>Job 등록</span>
                </button>
              </form>
            }
          />
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

        {activeModule === 'history' && <Placeholder icon={<History size={24} />} title="실행 이력" body="성공·실패·처리 건수·오류 로그 조회 화면으로 확장할 영역입니다." />}
        {activeModule === 'monitoring' && <Placeholder icon={<Activity size={24} />} title="모니터링" body="실행 중 Job, 실패 알림, 전체 상태를 보여줄 대시보드 영역입니다." />}
        {activeModule === 'settings' && <Placeholder icon={<Settings size={24} />} title="설정" body="규칙, 사용자 권한, 환경 설정을 관리할 영역입니다." />}

        {editingJobId && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setEditingJobId(null);
            }}
          >
            <form className="form-panel job-edit-modal" role="dialog" aria-modal="true" aria-labelledby="job-edit-modal-title" onSubmit={updateJob}>
              <div className="modal-heading">
                <PanelTitle icon={<Settings2 size={20} />} eyebrow="등록된 Job 수정" title="Job 정보" />
                <button type="button" className="icon-button" title="닫기" onClick={() => setEditingJobId(null)}>
                  <X size={18} />
                </button>
              </div>
              <div id="job-edit-modal-title" className="sr-only">Job 정보 수정</div>
              <TextField label="Job 이름" value={editingJobForm.name} onChange={(value) => setEditingJobForm({ ...editingJobForm, name: value })} />
              <SelectField label="컴포넌트 유형" value={editingJobForm.componentType} onChange={(value) => setEditingJobForm({ ...editingJobForm, componentType: value as ComponentType })}>
                {Object.entries(componentConfigs).map(([key, config]) => (
                  <option key={key} value={key}>{config.label}</option>
                ))}
              </SelectField>
              <SelectField label="Source 연결 객체" value={editingJobForm.sourceConnectionId} onChange={(value) => setEditingJobForm({ ...editingJobForm, sourceConnectionId: value })}>
                <option value="">선택 안 함</option>
                <ConnectionOptions connections={connections} />
              </SelectField>
              <SelectField label="Target 연결 객체" value={editingJobForm.targetConnectionId} onChange={(value) => setEditingJobForm({ ...editingJobForm, targetConnectionId: value })}>
                <option value="">선택 안 함</option>
                <ConnectionOptions connections={connections} />
              </SelectField>
              <TextAreaField label="Job 설명" value={editingJobForm.description} onChange={(value) => setEditingJobForm({ ...editingJobForm, description: value })} />
              <TextAreaField label="SQL 또는 처리 코드" value={editingJobForm.processingCode} onChange={(value) => setEditingJobForm({ ...editingJobForm, processingCode: value })} />
              <TextField label="입력값 계약" value={editingJobForm.inputContract} onChange={(value) => setEditingJobForm({ ...editingJobForm, inputContract: value })} placeholder="watermark: datetime" />
              <TextField label="출력값 계약" value={editingJobForm.outputContract} onChange={(value) => setEditingJobForm({ ...editingJobForm, outputContract: value })} placeholder="customer_delta dataset" />
              <div className="form-grid compact">
                <TextField label="재시도 횟수" value={editingJobForm.retryCount} onChange={(value) => setEditingJobForm({ ...editingJobForm, retryCount: value })} />
                <TextField label="버전" value={editingJobForm.version} onChange={(value) => setEditingJobForm({ ...editingJobForm, version: value })} placeholder="1.0.0" />
              </div>
              <button type="submit" className="primary-submit">
                <Save size={17} />
                <span>수정 완료</span>
              </button>
            </form>
          </div>
        )}

        {isWorkflowSaveModalOpen && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setIsWorkflowSaveModalOpen(false);
            }}
          >
            <form className="form-panel workflow-save-modal" role="dialog" aria-modal="true" aria-labelledby="workflow-save-modal-title" onSubmit={(event) => { event.preventDefault(); saveWorkflowCanvas(); }}>
              <div className="modal-heading">
                <PanelTitle icon={<Save size={20} />} eyebrow="캔버스 상태 저장" title="워크플로우 저장" />
                <button type="button" className="icon-button" title="닫기" onClick={() => setIsWorkflowSaveModalOpen(false)}>
                  <X size={18} />
                </button>
              </div>
              <div id="workflow-save-modal-title" className="sr-only">워크플로우 저장</div>
              <label className="field-label">
                <span>워크플로우 이름</span>
                <input autoFocus required value={workflowSaveName} onChange={(event) => setWorkflowSaveName(event.target.value)} placeholder="daily_customer_load" />
              </label>
              <div className="input-help">현재 캔버스의 Job, 노드 위치, 연결 상태, 실행 조건을 이 이름으로 저장합니다.</div>
              <button type="submit" className="primary-submit">
                <Save size={17} />
                <span>저장 완료</span>
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
            <form className="form-panel workflow-modal" role="dialog" aria-modal="true" aria-labelledby="workflow-modal-title" onSubmit={(event) => { event.preventDefault(); createWorkflowFromManagedJobs(); }}>
              <div className="modal-heading">
                <PanelTitle icon={<Workflow size={20} />} eyebrow="Workflow 조립" title="신규 워크플로우" />
                <button type="button" className="icon-button" title="닫기" onClick={() => setIsWorkflowModalOpen(false)}>
                  <X size={18} />
                </button>
              </div>
              <div id="workflow-modal-title" className="sr-only">신규 워크플로우</div>
              <TextField label="Workflow 이름" value={workflowForm.workflowName} onChange={(value) => setWorkflowForm({ ...workflowForm, workflowName: value })} placeholder="daily_customer_load" />
              <TextField label="실행 스케줄" value={workflowForm.schedule} onChange={(value) => setWorkflowForm({ ...workflowForm, schedule: value })} />
              <SelectField label="기본 성공 조건" value={workflowForm.defaultSuccessCondition} onChange={(value) => setWorkflowForm({ ...workflowForm, defaultSuccessCondition: value })}>
                <option value="성공 시 다음 Job 실행">성공 시 다음 Job 실행</option>
                <option value="성공 시 병렬 Job 실행">성공 시 병렬 Job 실행</option>
                <option value="성공 시 Workflow 완료">성공 시 Workflow 완료</option>
              </SelectField>
              <SelectField label="기본 실패 조건" value={workflowForm.defaultFailureCondition} onChange={(value) => setWorkflowForm({ ...workflowForm, defaultFailureCondition: value })}>
                <option value="실패 시 Workflow 중지">실패 시 Workflow 중지</option>
                <option value="실패 시 재시도 후 중지">실패 시 재시도 후 중지</option>
                <option value="실패 시 다음 Job 계속">실패 시 다음 Job 계속</option>
              </SelectField>
              <label className="check-row workflow-toggle">
                <input type="checkbox" checked={workflowForm.parallelExecution} onChange={(event) => setWorkflowForm({ ...workflowForm, parallelExecution: event.target.checked })} />
                <strong>선택 Job 병렬 실행 허용</strong>
              </label>
              <div className="input-help">연결 객체와 SQL/처리 코드는 Job에 보관합니다. 이 화면에서는 Job 간 실행 순서, 조건, 의존 관계와 스케줄만 관리합니다.</div>

              <button type="submit" className="primary-submit" disabled={workflowJobIds.length === 0}>
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

function ConnectionOptions({ connections }: { connections: RegisteredConnection[] }) {
  return (
    <>
      {connections.map((connection) => (
        <option key={connection.id} value={connection.id}>
          {connection.name} ({connection.dbType})
        </option>
      ))}
    </>
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

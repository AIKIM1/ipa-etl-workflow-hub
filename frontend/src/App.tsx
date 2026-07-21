import { useCallback, useMemo, useState } from 'react';
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
  FileCode2,
  GitBranchPlus,
  Layers3,
  Minus,
  Plus,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Workflow,
} from 'lucide-react';

type LoadType = 'Full' | 'Incremental';
type JobStatus = 'ready' | 'success' | 'pending';
type ComponentType = 'source-extract' | 'data-cleaning' | 'target-load' | 'quality-check' | 'custom-transform';
type ActivePanel = 'empty' | 'workflow' | 'env' | 'query' | 'job-config';

type WorkflowForm = {
  workflowName: string;
  sourceConnection: string;
  sourceTable: string;
  targetConnection: string;
  targetTable: string;
  loadType: LoadType;
  watermarkColumn: string;
  primaryKey: string;
  schedule: string;
};

type ComponentConfig = {
  label: string;
  accent: string;
  fields: string[];
};

type JobConfig = {
  componentType: ComponentType;
  values: Record<string, string>;
};

type BaseJobData = {
  jobCode: string;
  title: string;
  componentType?: ComponentType;
  status: JobStatus;
} & Record<string, unknown>;

type JobNodeData = BaseJobData & {
  canDelete: boolean;
  onConfigure: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
};

type JobNode = Node<JobNodeData, 'job'>;

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

const workflowDefaults: WorkflowForm = {
  workflowName: '',
  sourceConnection: 'SRC_POSTGRES_DEV',
  sourceTable: '',
  targetConnection: 'TGT_WAREHOUSE_DEV',
  targetTable: '',
  loadType: 'Incremental',
  watermarkColumn: '',
  primaryKey: '',
  schedule: '0 2 * * *',
};

const baseJobs = [
  { title: '원천 추출', componentType: 'source-extract' as ComponentType, status: 'success' as JobStatus },
  { title: '데이터 정제', componentType: 'data-cleaning' as ComponentType, status: 'success' as JobStatus },
  { title: 'Target 적재', componentType: 'target-load' as ComponentType, status: 'ready' as JobStatus },
  { title: '데이터 품질 검증', componentType: 'quality-check' as ComponentType, status: 'pending' as JobStatus },
];

let nodeSequence = 5;
const nodeOrigin: [number, number] = [0.5, 0];

function formatJobCode(index: number) {
  return `JOB_${String(index).padStart(2, '0')}`;
}

function JobCard({ data, id, selected }: NodeProps<JobNode>) {
  const config = data.componentType ? componentConfigs[data.componentType] : undefined;
  const statusLabel = data.status === 'success' ? '성공' : data.status === 'pending' ? '대기' : '준비';

  return (
    <div
      className={`job-card ${selected ? 'selected' : ''}`}
      onDoubleClick={() => data.onConfigure(id)}
      style={{ '--job-accent': config?.accent ?? '#94a3b8' } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="job-handle" />
      <div className="job-card-top">
        <span className="job-code">{data.jobCode}</span>
        <span className={`job-status ${data.status}`}>{statusLabel}</span>
      </div>
      <div className="job-title">{data.title}</div>
      <div className="job-meta">
        <CircleDot size={13} />
        <span>{config?.label ?? '컴포넌트 미지정'}</span>
      </div>
      <div className="job-actions">
        <button type="button" title="Job 설정" onClick={() => data.onConfigure(id)}>
          <Settings2 size={14} />
        </button>
        <button type="button" title="Job 삭제" onClick={() => data.onDelete(id)} disabled={!data.canDelete}>
          <Trash2 size={14} />
        </button>
      </div>
      <Handle type="source" position={Position.Right} className="job-handle" />
    </div>
  );
}

const nodeTypes = { job: JobCard };

function App() {
  const [activePanel, setActivePanel] = useState<ActivePanel>('empty');
  const [workflowForm, setWorkflowForm] = useState<WorkflowForm>(workflowDefaults);
  const [workflowCreated, setWorkflowCreated] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobConfigs, setJobConfigs] = useState<Record<string, JobConfig>>({});
  const [envText, setEnvText] = useState('SOURCE_DB_URL=postgresql://user:password@host:5432/source\nTARGET_DB_URL=postgresql://user:password@host:5432/target');
  const [queryText, setQueryText] = useState('select *\nfrom source_schema.source_table\nwhere updated_at >= :watermark');
  const [nodes, setNodes, onNodesChange] = useNodesState<JobNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { screenToFlowPosition } = useReactFlow();

  const configureJob = useCallback((nodeId: string) => {
    setSelectedJobId(nodeId);
    setActivePanel('job-config');
  }, []);

  const deleteJob = useCallback((nodeId: string) => {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setJobConfigs((current) => {
      const next = { ...current };
      delete next[nodeId];
      return next;
    });
    setSelectedJobId((current) => (current === nodeId ? null : current));
  }, [setEdges, setNodes]);

  const attachNodeActions = useCallback(
    (node: Omit<JobNode, 'data'> & { data: BaseJobData }): JobNode => ({
      ...node,
      data: {
        ...node.data,
        canDelete: true,
        onConfigure: configureJob,
        onDelete: deleteJob,
      },
    }),
    [configureJob, deleteJob],
  );

  const createBaseWorkflow = () => {
    const nextNodes = baseJobs.map((job, index) =>
      attachNodeActions({
        id: `job-${index + 1}`,
        type: 'job',
        position: { x: 80 + index * 285, y: 180 },
        data: {
          jobCode: formatJobCode(index + 1),
          title: job.title,
          componentType: job.componentType,
          status: job.status,
        },
      }),
    );

    const nextEdges = nextNodes.slice(0, -1).map((node, index) => ({
      id: `${node.id}-${nextNodes[index + 1].id}`,
      source: node.id,
      target: nextNodes[index + 1].id,
      type: 'smoothstep',
      animated: index >= 1,
      style: { stroke: '#64748b', strokeWidth: 2 },
    }));

    nodeSequence = 5;
    setNodes(nextNodes);
    setEdges(nextEdges);
    setWorkflowCreated(true);
    setActivePanel('empty');
  };

  const addJob = () => {
    const currentCount = nodes.length + 1;
    const lastNode = nodes[nodes.length - 1];
    const id = `job-${nodeSequence++}`;
    const newNode = attachNodeActions({
      id,
      type: 'job',
      position: lastNode ? { x: lastNode.position.x + 285, y: lastNode.position.y } : { x: 120, y: 180 },
      data: {
        jobCode: formatJobCode(currentCount),
        title: '신규 Job',
        status: 'ready',
      },
    });

    setNodes((current) => [...current, newNode]);
    if (lastNode) {
      setEdges((current) => [
        ...current,
        { id: `${lastNode.id}-${id}`, source: lastNode.id, target: id, type: 'smoothstep', animated: true },
      ]);
    }
  };

  const onConnect = useCallback(
    (params: Connection) => setEdges((current) => addEdge({ ...params, type: 'smoothstep', animated: true }, current)),
    [setEdges],
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      if (!connectionState.isValid && connectionState.fromNode) {
        const id = `job-${nodeSequence++}`;
        const sourceIndex = nodes.findIndex((node) => node.id === connectionState.fromNode?.id);
        const { clientX, clientY } = 'changedTouches' in event ? event.changedTouches[0] : event;
        const newNode = attachNodeActions({
          id,
          type: 'job',
          position: screenToFlowPosition({ x: clientX, y: clientY }),
          origin: [0.5, 0],
          data: {
            jobCode: formatJobCode(nodes.length + 1),
            title: '신규 Job',
            status: 'ready',
          },
        });

        setNodes((current) => current.concat(newNode));
        setEdges((current) =>
          current.concat({
            id: `${connectionState.fromNode?.id}-${id}`,
            source: connectionState.fromNode?.id ?? '',
            target: id,
            type: 'smoothstep',
            animated: true,
            label: sourceIndex >= 0 ? 'next' : undefined,
          }),
        );
      }
    },
    [attachNodeActions, nodes, screenToFlowPosition, setEdges, setNodes],
  );

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedJobId), [nodes, selectedJobId]);
  const selectedConfig = selectedJobId ? jobConfigs[selectedJobId] : undefined;
  const selectedComponentType = selectedConfig?.componentType ?? selectedNode?.data.componentType ?? 'source-extract';
  const selectedComponent = componentConfigs[selectedComponentType];

  const updateJobComponent = (componentType: ComponentType) => {
    if (!selectedJobId) return;
    setJobConfigs((current) => ({
      ...current,
      [selectedJobId]: { componentType, values: current[selectedJobId]?.values ?? {} },
    }));
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedJobId
          ? {
              ...node,
              data: {
                ...node.data,
                componentType,
                title: componentConfigs[componentType].label,
              },
            }
          : node,
      ),
    );
  };

  const updateJobValue = (field: string, value: string) => {
    if (!selectedJobId) return;
    setJobConfigs((current) => ({
      ...current,
      [selectedJobId]: {
        componentType: selectedComponentType,
        values: { ...(current[selectedJobId]?.values ?? {}), [field]: value },
      },
    }));
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark"><Workflow size={18} /></div>
          <div>
            <p>IPA</p>
            <h1>ETL FlowHub</h1>
          </div>
        </div>

        <div className="search-box">
          <Search size={16} />
          <span>워크플로우 작업</span>
        </div>

        <nav className="side-actions" aria-label="작업 메뉴">
          <button type="button" className={activePanel === 'workflow' ? 'active' : ''} onClick={() => setActivePanel('workflow')}>
            <GitBranchPlus size={18} />
            <span>워크플로우 생성</span>
          </button>
          <button type="button" className={activePanel === 'env' ? 'active' : ''} onClick={() => setActivePanel('env')}>
            <Database size={18} />
            <span>DB 연결정보 .env 입력</span>
          </button>
          <button type="button" className={activePanel === 'query' ? 'active' : ''} onClick={() => setActivePanel('query')}>
            <FileCode2 size={18} />
            <span>쿼리 입력</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <Sparkles size={16} />
          <span>React Flow 기반 ETL 워크플로우 설계</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p>Workflow Builder</p>
            <h2>{workflowForm.workflowName || 'Start ETL workflow project'}</h2>
          </div>
          <div className="topbar-actions">
            <button type="button" onClick={addJob} disabled={!workflowCreated} title="Job 추가">
              <Plus size={17} />
              <span>Job 추가</span>
            </button>
            <button type="button" onClick={() => selectedJobId && deleteJob(selectedJobId)} disabled={!selectedJobId} title="선택 Job 삭제">
              <Minus size={17} />
              <span>삭제</span>
            </button>
          </div>
        </header>

        <div className="content-grid">
          <div className="flow-surface">
            {!workflowCreated && (
              <div className="empty-state">
                <Layers3 size={34} />
                <h3>워크플로우를 먼저 정의하세요</h3>
                <p>왼쪽의 워크플로우 생성 버튼에서 정의 정보를 입력하면 기본 Job 4개가 캔버스에 배치됩니다.</p>
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

          <aside className="detail-panel">
            {activePanel === 'empty' && (
              <div className="panel-placeholder">
                <BadgeCheck size={28} />
                <h3>ETL 워크플로우 화면</h3>
                <p>Job을 더블 클릭하면 컴포넌트 유형과 입력값을 설정할 수 있습니다.</p>
              </div>
            )}

            {activePanel === 'workflow' && (
              <form className="form-panel" onSubmit={(event) => { event.preventDefault(); createBaseWorkflow(); }}>
                <div className="panel-title">
                  <Workflow size={20} />
                  <div>
                    <p>Workflow 정의 정보</p>
                    <h3>신규 워크플로우</h3>
                  </div>
                </div>
                <TextField label="Workflow 이름" value={workflowForm.workflowName} onChange={(value) => setWorkflowForm({ ...workflowForm, workflowName: value })} placeholder="daily_customer_load" />
                <TextField label="Source 연결 선택" value={workflowForm.sourceConnection} onChange={(value) => setWorkflowForm({ ...workflowForm, sourceConnection: value })} />
                <TextField label="Source 테이블" value={workflowForm.sourceTable} onChange={(value) => setWorkflowForm({ ...workflowForm, sourceTable: value })} placeholder="public.customer" />
                <TextField label="Target 연결 선택" value={workflowForm.targetConnection} onChange={(value) => setWorkflowForm({ ...workflowForm, targetConnection: value })} />
                <TextField label="Target 테이블" value={workflowForm.targetTable} onChange={(value) => setWorkflowForm({ ...workflowForm, targetTable: value })} placeholder="mart.dim_customer" />
                <label className="field-label">
                  <span>Full/Incremental</span>
                  <select value={workflowForm.loadType} onChange={(event) => setWorkflowForm({ ...workflowForm, loadType: event.target.value as LoadType })}>
                    <option>Full</option>
                    <option>Incremental</option>
                  </select>
                </label>
                <TextField label="Watermark 컬럼" value={workflowForm.watermarkColumn} onChange={(value) => setWorkflowForm({ ...workflowForm, watermarkColumn: value })} placeholder="updated_at" />
                <TextField label="Primary Key" value={workflowForm.primaryKey} onChange={(value) => setWorkflowForm({ ...workflowForm, primaryKey: value })} placeholder="customer_id" />
                <TextField label="실행 스케줄" value={workflowForm.schedule} onChange={(value) => setWorkflowForm({ ...workflowForm, schedule: value })} />
                <button type="submit" className="primary-submit">
                  <Save size={17} />
                  <span>입력완료</span>
                </button>
              </form>
            )}

            {activePanel === 'env' && (
              <div className="form-panel">
                <div className="panel-title">
                  <Database size={20} />
                  <div>
                    <p>DB 연결정보</p>
                    <h3>.env 입력</h3>
                  </div>
                </div>
                <textarea className="code-area" value={envText} onChange={(event) => setEnvText(event.target.value)} spellCheck={false} />
                <button type="button" className="primary-submit">
                  <Save size={17} />
                  <span>저장</span>
                </button>
              </div>
            )}

            {activePanel === 'query' && (
              <div className="form-panel">
                <div className="panel-title">
                  <FileCode2 size={20} />
                  <div>
                    <p>Source Query</p>
                    <h3>쿼리 입력</h3>
                  </div>
                </div>
                <textarea className="code-area query" value={queryText} onChange={(event) => setQueryText(event.target.value)} spellCheck={false} />
                <button type="button" className="primary-submit">
                  <Save size={17} />
                  <span>저장</span>
                </button>
              </div>
            )}

            {activePanel === 'job-config' && selectedNode && (
              <div className="form-panel">
                <div className="panel-title">
                  <Settings2 size={20} />
                  <div>
                    <p>{selectedNode.data.jobCode}</p>
                    <h3>Job 컴포넌트 설정</h3>
                  </div>
                </div>
                <label className="field-label">
                  <span>컴포넌트 선택</span>
                  <select value={selectedComponentType} onChange={(event) => updateJobComponent(event.target.value as ComponentType)}>
                    {Object.entries(componentConfigs).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                </label>
                <div className="component-pill" style={{ '--job-accent': selectedComponent.accent } as React.CSSProperties}>
                  <CircleDot size={14} />
                  <span>{selectedComponent.label}</span>
                </div>
                {selectedComponent.fields.map((field) => (
                  <TextField
                    key={field}
                    label={field}
                    value={selectedConfig?.values[field] ?? ''}
                    onChange={(value) => updateJobValue(field, value)}
                    placeholder={`${field} 입력`}
                  />
                ))}
                <button type="button" className="primary-submit" onClick={() => setActivePanel('empty')}>
                  <Save size={17} />
                  <span>설정완료</span>
                </button>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="field-label">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

export default App;


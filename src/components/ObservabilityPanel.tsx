import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Compass,
  Download,
  FlaskConical,
  GitBranch,
  Hammer,
  HeartPulse,
  RefreshCw,
  Rocket,
  Shield,
  Sparkles,
  WalletCards,
} from 'lucide-react';
import type { AgentConfig } from './SettingsModal';
import {
  getBrokerObservabilitySnapshot,
  subscribeToBrokerObservability,
} from '../services/brokerProtocol';
import {
  calculateBrokerMetrics,
  formatDuration,
  type BrokerObservabilitySnapshot,
} from '../services/observability';
import {
  createTeamActivitySnapshot,
  type TeamActivitySnapshot,
  type TeamAgentSummary,
  type TeamMessageFlowEntry,
  type TeamMessageMode,
  type TeamModelCostSummary,
  type TeamSeverity,
  type TeamTaskCard,
  type TeamTimelineEntry,
} from '../services/teamActivity';

interface HealthCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

interface TeamRoomPanelProps {
  workspaceRoot: string;
  agentConfigs: Record<string, AgentConfig>;
}

type EvidenceSelection =
  | { kind: 'agent'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'message'; id: string }
  | { kind: 'model'; id: string }
  | { kind: 'timeline'; id: string };

const statusColor = (status: string) => {
  if (status === 'pass' || status === 'completed' || status === 'ready' || status === 'success') return 'var(--accent-green)';
  if (status === 'fail' || status === 'failed' || status === 'cancelled' || status === 'error') return 'var(--accent-red)';
  if (status === 'busy' || status === 'running' || status === 'assigned' || status === 'reviewing') return 'var(--accent-cyan)';
  return 'var(--accent-orange)';
};

const severityColor = (severity: TeamSeverity) => statusColor(severity);

const formatMoney = (value: number) => `$${value.toFixed(4)}`;

const timeLabel = (timestamp?: number) => {
  if (!timestamp) return 'No heartbeat';
  return new Date(timestamp).toLocaleTimeString();
};

const IconBadge = ({ icon, color }: { icon: string; color: string }) => {
  const props = { size: 14, style: { color } };
  if (icon === 'compass') return <Compass {...props} />;
  if (icon === 'hammer') return <Hammer {...props} />;
  if (icon === 'test-tube') return <FlaskConical {...props} />;
  if (icon === 'shield') return <Shield {...props} />;
  if (icon === 'rocket') return <Rocket {...props} />;
  return <Sparkles {...props} />;
};

const SectionTitle = ({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
}) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700 }}>
      {icon}
      {title}
    </div>
    {detail && <div style={{ color: 'var(--text-muted)', fontSize: '8px' }}>{detail}</div>}
  </div>
);

const MiniBadge = ({ label, tone }: { label: string; tone: string }) => (
  <span
    style={{
      color: statusColor(tone),
      background: `${statusColor(tone)}18`,
      border: `1px solid ${statusColor(tone)}30`,
      borderRadius: '999px',
      padding: '2px 6px',
      fontSize: '8px',
      fontWeight: 800,
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}
  >
    {label}
  </span>
);

const EmptyState = ({ label }: { label: string }) => (
  <div style={{ padding: '18px 0', color: 'var(--text-muted)', fontSize: '10px', textAlign: 'center' }}>
    {label}
  </div>
);

const EvidenceDrawer = ({
  selection,
  team,
}: {
  selection: EvidenceSelection | null;
  team: TeamActivitySnapshot;
}) => {
  if (!selection) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: '9px', lineHeight: 1.45 }}>
        Select an agent, task, message, model row, or timeline event to see the broker evidence behind the summary.
      </div>
    );
  }

  const agent = selection.kind === 'agent'
    ? team.agents.find((item) => item.agentId === selection.id)
    : undefined;
  const task = selection.kind === 'task'
    ? team.workflowBoard.flatMap((column) => column.tasks).find((item) => `${item.workflowId}:${item.taskId}` === selection.id)
    : undefined;
  const message = selection.kind === 'message'
    ? team.messageFlow.stream.find((item) => item.messageId === selection.id)
    : undefined;
  const model = selection.kind === 'model'
    ? team.modelCosts.find((item) => item.workflowId === selection.id)
    : undefined;
  const timeline = selection.kind === 'timeline'
    ? team.timeline.find((item) => item.id === selection.id)
    : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '9px' }}>
      <div style={{ color: 'var(--accent-cyan)', fontSize: '8px', fontWeight: 800, textTransform: 'uppercase' }}>
        Broker Evidence
      </div>
      {agent && (
        <>
          <strong>{agent.agentId} · {agent.role}</strong>
          <span>State: {agent.state}</span>
          <span>Queue depth: {agent.queueDepth}</span>
          <span>Current task: {agent.currentTaskId || 'none'}</span>
          <span>Heartbeat: {timeLabel(agent.lastHeartbeatAt)}</span>
          <span>Cost: {formatMoney(agent.estimatedCostUsd)} est · {formatMoney(agent.actualCostUsd)} reported</span>
          <span>Tokens: {agent.promptTokens} prompt · {agent.completionTokens} output</span>
        </>
      )}
      {task && (
        <>
          <strong>{task.workflowId} · {task.taskId}</strong>
          <span>Owner: {task.owner}</span>
          <span>Status: {task.status}</span>
          <span>Dependencies: {task.dependencies.join(', ') || 'none'}</span>
          <span>Approval: {task.requiresApproval ? task.approved ? 'approved' : 'waiting' : 'not required'}</span>
          {task.blockedReason && <span>Reason: {task.blockedReason}</span>}
          {task.routing && <span>Model: {task.routing.selectedModel} · {task.routing.reason}</span>}
          {task.worktree && <span>Worktree: {task.worktree.branch} · {task.worktree.status}</span>}
          {task.artifacts.length > 0 && <span>Artifacts: {task.artifacts.join(', ')}</span>}
        </>
      )}
      {message && (
        <>
          <strong>{message.messageId}</strong>
          <span>{message.from} to {message.to}</span>
          <span>Workflow/task: {message.workflowId} · {message.taskId}</span>
          <span>Kind/status: {message.kind} · {message.status}</span>
          <span>Attempt: {message.attempt}</span>
          <span>Summary: {message.summary}</span>
          {message.correlationId && <span>Correlation: {message.correlationId}</span>}
        </>
      )}
      {model && (
        <>
          <strong>{model.workflowName}</strong>
          <span>Estimated: {formatMoney(model.estimatedCostUsd)}</span>
          <span>Reported: {formatMoney(model.actualCostUsd)}</span>
          <span>Savings: {formatMoney(model.estimatedSavingsUsd)}</span>
          <span>Cloud assignments: {model.cloudAssignments}</span>
          <span>Escalations: {model.escalations}</span>
          {model.budgetRemainingUsd !== undefined && <span>Budget remaining: {formatMoney(model.budgetRemainingUsd)}</span>}
        </>
      )}
      {timeline && (
        <>
          <strong>{timeline.label}</strong>
          <span>Source: {timeline.source}</span>
          <span>Detail: {timeline.detail}</span>
          <span>When: {new Date(timeline.createdAt).toLocaleString()}</span>
          {timeline.workflowId && <span>Workflow: {timeline.workflowId}</span>}
          {timeline.taskId && <span>Task: {timeline.taskId}</span>}
          {timeline.messageId && <span>Message: {timeline.messageId}</span>}
        </>
      )}
      <div style={{ color: 'var(--text-dark)', fontSize: '8px', lineHeight: 1.4, marginTop: '4px' }}>
        Summaries can include terminal-reported text. Treat them as reported evidence, not proof, until backed by task status, worktree, test, or broker events.
      </div>
    </div>
  );
};

export const TeamRoomPanel: React.FC<TeamRoomPanelProps> = ({ workspaceRoot, agentConfigs }) => {
  const [snapshot, setSnapshot] = useState<BrokerObservabilitySnapshot>(() => getBrokerObservabilitySnapshot());
  const [health, setHealth] = useState<HealthCheck[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [messageMode, setMessageMode] = useState<TeamMessageMode>('stream');
  const [selection, setSelection] = useState<EvidenceSelection | null>(null);
  const [exportStatus, setExportStatus] = useState('');
  const metrics = useMemo(() => calculateBrokerMetrics(snapshot), [snapshot]);
  const team = useMemo(() => createTeamActivitySnapshot(snapshot, messageMode), [snapshot, messageMode]);
  const input = { workspaceRoot, agentConfigs };
  const workflowOptions = team.modelCosts.map((workflow) => ({ id: workflow.workflowId, name: workflow.workflowName }));
  const workflowFilter = selectedWorkflowId || 'all';

  const filteredBoard = team.workflowBoard.map((column) => ({
    ...column,
    tasks: workflowFilter === 'all'
      ? column.tasks
      : column.tasks.filter((task) => task.workflowId === workflowFilter),
  }));
  const filteredMessages = workflowFilter === 'all'
    ? team.messageFlow.stream
    : team.messageFlow.stream.filter((message) => message.workflowId === workflowFilter);
  const filteredEdges = workflowFilter === 'all'
    ? team.messageFlow.graph.edges
    : team.messageFlow.graph.edges.filter((edge) => filteredMessages.some((message) => message.messageId === edge.messageId));
  const filteredTimeline = workflowFilter === 'all'
    ? team.timeline.slice(0, 20)
    : team.timeline.filter((entry) => entry.workflowId === workflowFilter).slice(0, 20);
  const filteredCosts = workflowFilter === 'all'
    ? team.modelCosts
    : team.modelCosts.filter((cost) => cost.workflowId === workflowFilter);

  const refreshHealth = async () => {
    const result = await (window as any).electronAPI?.runHealthChecks(input);
    setHealth(result || []);
  };

  useEffect(() => subscribeToBrokerObservability(setSnapshot), []);
  useEffect(() => {
    void refreshHealth();
    const interval = window.setInterval(() => void refreshHealth(), 15_000);
    return () => window.clearInterval(interval);
  }, [workspaceRoot, agentConfigs]);

  const exportDiagnostics = async () => {
    const result = await (window as any).electronAPI?.exportDiagnostics(input);
    setExportStatus(result?.success ? `Exported ${result.path}` : result?.error || 'Export failed.');
  };

  const metricCards = [
    ['Agents', team.agents.length],
    ['Queue', metrics.queueDepth],
    ['Latency', formatDuration(metrics.averageDeliveryLatencyMs)],
    ['Retries', metrics.retries],
    ['Failures', metrics.failures],
    ['Uptime', `${metrics.agentUptimePercent}%`],
  ];

  const renderAgent = (agent: TeamAgentSummary) => (
    <button
      key={agent.agentId}
      onClick={() => setSelection({ kind: 'agent', id: agent.agentId })}
      className="glass-panel"
      style={{
        padding: '9px',
        textAlign: 'left',
        borderColor: `${agent.color}55`,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '7px', alignItems: 'center', minWidth: 0 }}>
          <IconBadge icon={agent.icon} color={agent.color} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.role}</div>
            <div style={{ fontSize: '8px', color: 'var(--text-muted)' }}>{agent.agentId} · heartbeat {timeLabel(agent.lastHeartbeatAt)}</div>
          </div>
        </div>
        <MiniBadge label={agent.state} tone={agent.state} />
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: '9px', marginTop: '7px', lineHeight: 1.35 }}>
        {agent.currentTask ? agent.currentTask.goal : agent.lastActivity || 'No workflow-backed task yet.'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', marginTop: '7px', color: 'var(--text-dark)', fontSize: '8px' }}>
        <span>Queue {agent.queueDepth}</span>
        <span>{formatMoney(agent.estimatedCostUsd)} est</span>
        <span>{agent.promptTokens + agent.completionTokens} tokens</span>
      </div>
    </button>
  );

  const renderTask = (task: TeamTaskCard) => (
    <button
      key={`${task.workflowId}:${task.taskId}`}
      onClick={() => setSelection({ kind: 'task', id: `${task.workflowId}:${task.taskId}` })}
      style={{
        width: '100%',
        textAlign: 'left',
        border: '1px solid var(--glass-border)',
        borderLeft: `3px solid ${statusColor(task.status)}`,
        borderRadius: '7px',
        padding: '7px',
        background: 'rgba(255,255,255,0.025)',
        color: 'var(--text-main)',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
        <strong style={{ fontSize: '10px' }}>{task.taskId}</strong>
        <span style={{ color: statusColor(task.status), fontSize: '8px', fontWeight: 800, textTransform: 'uppercase' }}>{task.status}</span>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: '8px', marginTop: '3px' }}>{task.owner}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: '9px', marginTop: '5px', lineHeight: 1.3 }}>{task.goal}</div>
      {task.routing && (
        <div style={{ color: 'var(--accent-purple)', fontSize: '8px', marginTop: '5px' }}>
          {task.routing.selectedModel} · {formatMoney(task.routing.estimatedCostUsd)}
          {task.routing.escalation > 0 && ` · escalation ${task.routing.escalation}`}
        </div>
      )}
      {task.blockedReason && <div style={{ color: 'var(--accent-red)', fontSize: '8px', marginTop: '5px' }}>{task.blockedReason}</div>}
    </button>
  );

  const renderMessageStream = (messages: TeamMessageFlowEntry[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
      {messages.length === 0 ? <EmptyState label="No workflow-backed messages yet." /> : messages.slice(0, 18).map((message) => (
        <button
          key={`${message.messageId}:${message.attempt}`}
          onClick={() => setSelection({ kind: 'message', id: message.messageId })}
          style={{
            display: 'grid',
            gridTemplateColumns: '58px 1fr',
            gap: '8px',
            alignItems: 'start',
            border: '1px solid var(--glass-border)',
            borderLeft: `3px solid ${severityColor(message.severity)}`,
            borderRadius: '7px',
            background: 'rgba(255,255,255,0.025)',
            color: 'var(--text-main)',
            padding: '7px',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <div style={{ color: severityColor(message.severity), fontSize: '8px', fontWeight: 800, textTransform: 'uppercase' }}>
            {message.status}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
              <span>{message.from}</span><ArrowRight size={10} /><span>{message.to}</span>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '9px', marginTop: '3px', lineHeight: 1.35 }}>
              {message.summary}
            </div>
            <div style={{ color: 'var(--text-dark)', fontSize: '8px', marginTop: '3px' }}>
              {message.taskId} · {message.kind} · attempt {message.attempt}
            </div>
          </div>
        </button>
      ))}
    </div>
  );

  const renderMessageGraph = () => (
    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
      {filteredEdges.length === 0 ? <EmptyState label="No workflow-backed graph edges yet." /> : filteredEdges.slice(0, 18).map((edge) => (
        <button
          key={edge.id}
          onClick={() => setSelection({ kind: 'message', id: edge.messageId })}
          style={{
            border: '1px solid var(--glass-border)',
            borderRadius: '7px',
            background: 'rgba(255,255,255,0.025)',
            color: 'var(--text-main)',
            padding: '7px',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr', alignItems: 'center', gap: '6px', fontSize: '9px' }}>
            <span>{edge.from}</span>
            <ArrowRight size={12} style={{ color: severityColor(edge.severity) }} />
            <span>{edge.to}</span>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '8px', marginTop: '4px' }}>
            {edge.taskId} · {edge.kind} · {edge.messageId}
          </div>
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="glass-panel" style={{ padding: '10px' }}>
        <SectionTitle
          icon={<Sparkles size={13} color="var(--accent-purple)" />}
          title="TEAM ROOM"
          detail="workflow-backed view"
        />
        <div style={{ color: 'var(--text-muted)', fontSize: '9px', lineHeight: 1.4, marginTop: '7px' }}>
          See what every configured agent is doing, how messages are moving, and what each model choice costs without reading raw terminal logs.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px', marginTop: '9px' }}>
          <select
            value={workflowFilter}
            onChange={(event) => setSelectedWorkflowId(event.target.value === 'all' ? '' : event.target.value)}
            style={{ fontSize: '9px' }}
          >
            <option value="all">All workflows</option>
            {workflowOptions.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
          </select>
          <select
            value={messageMode}
            onChange={(event) => setMessageMode(event.target.value as TeamMessageMode)}
            style={{ fontSize: '9px' }}
          >
            {team.controls.messageModes.map((mode) => <option key={mode} value={mode}>{mode === 'stream' ? 'Message stream' : 'Message graph'}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
          <button onClick={() => void refreshHealth()}><RefreshCw size={10} /> Health</button>
          <button onClick={() => void exportDiagnostics()}><Download size={10} /> Export</button>
        </div>
        {exportStatus && <div style={{ marginTop: '6px', fontSize: '8px', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{exportStatus}</div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '7px' }}>
        {metricCards.map(([label, value]) => (
          <div key={label} className="glass-panel" style={{ padding: '8px' }}>
            <div style={{ fontSize: '8px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--accent-cyan)', marginTop: '2px' }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="glass-panel" style={{ padding: '10px' }}>
        <SectionTitle icon={<HeartPulse size={13} color="var(--accent-purple)" />} title="AGENTS" detail={`${team.agents.length} configured`} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginTop: '8px' }}>
          {team.agents.length === 0 ? <EmptyState label="No agents configured yet." /> : team.agents.map(renderAgent)}
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '10px' }}>
        <SectionTitle icon={<GitBranch size={13} color="var(--accent-purple)" />} title="WORKFLOW BOARD" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '7px', marginTop: '8px' }}>
          {filteredBoard.map((column) => (
            <div key={column.id} style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '8px', fontWeight: 800, textTransform: 'uppercase' }}>
                <span>{column.label}</span>
                <span>{column.tasks.length}</span>
              </div>
              {column.tasks.length === 0 ? (
                <div style={{ height: '16px', borderRadius: '6px', background: 'rgba(255,255,255,0.02)' }} />
              ) : column.tasks.map(renderTask)}
            </div>
          ))}
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '10px' }}>
        <SectionTitle
          icon={<Activity size={13} color="var(--accent-purple)" />}
          title={messageMode === 'stream' ? 'MESSAGE STREAM' : 'MESSAGE GRAPH'}
          detail={`${filteredMessages.length} workflow messages`}
        />
        {messageMode === 'stream' ? renderMessageStream(filteredMessages) : renderMessageGraph()}
      </div>

      <div className="glass-panel" style={{ padding: '10px' }}>
        <SectionTitle icon={<WalletCards size={13} color="var(--accent-purple)" />} title="MODEL COSTS" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginTop: '8px' }}>
          {filteredCosts.length === 0 ? <EmptyState label="No routed workflow costs yet." /> : filteredCosts.map((cost: TeamModelCostSummary) => (
            <button
              key={cost.workflowId}
              onClick={() => setSelection({ kind: 'model', id: cost.workflowId })}
              style={{
                border: '1px solid var(--glass-border)',
                borderRadius: '7px',
                background: 'rgba(255,255,255,0.025)',
                color: 'var(--text-main)',
                padding: '8px',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <strong style={{ fontSize: '10px' }}>{cost.workflowName}</strong>
                <span style={{ color: 'var(--accent-cyan)', fontSize: '9px', fontWeight: 800 }}>{formatMoney(cost.estimatedCostUsd)}</span>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '8px', marginTop: '4px' }}>
                {cost.cloudAssignments} cloud · {cost.escalations} escalations · {formatMoney(cost.estimatedSavingsUsd)} estimated savings
                {cost.budgetRemainingUsd !== undefined && ` · ${formatMoney(cost.budgetRemainingUsd)} budget left`}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '10px' }}>
        <SectionTitle icon={<Activity size={13} color="var(--accent-purple)" />} title="TEAM TIMELINE" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
          {filteredTimeline.length === 0 ? <EmptyState label="No durable workflow events recorded." /> : filteredTimeline.map((event: TeamTimelineEntry) => (
            <button
              key={event.id}
              onClick={() => setSelection({ kind: 'timeline', id: event.id })}
              style={{
                border: 'none',
                borderLeft: `3px solid ${severityColor(event.severity)}`,
                borderRadius: '5px',
                padding: '5px 7px',
                background: 'rgba(255,255,255,0.025)',
                color: 'var(--text-main)',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', fontSize: '9px' }}>
                <strong>{event.label}</strong>
                <span style={{ color: 'var(--text-dark)', whiteSpace: 'nowrap' }}>{timeLabel(event.createdAt)}</span>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '8px', marginTop: '2px' }}>{event.detail}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '10px' }}>
        <SectionTitle icon={<HeartPulse size={13} color="var(--accent-purple)" />} title="WORKSPACE HEALTH" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '8px' }}>
          {health.length === 0 ? <EmptyState label="No health checks reported yet." /> : health.map((check) => (
            <div key={check.id} style={{ display: 'flex', gap: '7px', alignItems: 'flex-start', fontSize: '9px' }}>
              <span style={{ color: statusColor(check.status), fontWeight: 800, textTransform: 'uppercase', width: '28px' }}>{check.status}</span>
              <div><strong>{check.label}</strong><div style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>{check.detail}</div></div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '10px' }}>
        <EvidenceDrawer selection={selection} team={team} />
      </div>
    </div>
  );
};

export const ObservabilityPanel = TeamRoomPanel;

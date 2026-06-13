import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Download, GitBranch, HeartPulse, RefreshCw } from 'lucide-react';
import type { AgentConfig } from './SettingsModal';
import {
  getBrokerObservabilitySnapshot,
  subscribeToBrokerObservability,
} from '../services/brokerProtocol';
import {
  calculateBrokerMetrics,
  formatDuration,
  getWorkflowTimeline,
  type BrokerObservabilitySnapshot,
} from '../services/observability';

interface HealthCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

interface ObservabilityPanelProps {
  workspaceRoot: string;
  agentConfigs: Record<string, AgentConfig>;
}

const statusColor = (status: string) => {
  if (status === 'pass' || status === 'completed' || status === 'ready') return 'var(--accent-green)';
  if (status === 'fail' || status === 'failed' || status === 'cancelled') return 'var(--accent-red)';
  return 'var(--accent-orange)';
};

export const ObservabilityPanel: React.FC<ObservabilityPanelProps> = ({ workspaceRoot, agentConfigs }) => {
  const [snapshot, setSnapshot] = useState<BrokerObservabilitySnapshot>(() => getBrokerObservabilitySnapshot());
  const [health, setHealth] = useState<HealthCheck[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  const metrics = useMemo(() => calculateBrokerMetrics(snapshot), [snapshot]);
  const selectedWorkflow = snapshot.workflows.find((workflow) => workflow.id === selectedWorkflowId) || snapshot.workflows[0];
  const timeline = selectedWorkflow ? getWorkflowTimeline(selectedWorkflow, snapshot.events).slice(-30).reverse() : snapshot.events.slice(-30).reverse();
  const input = { workspaceRoot, agentConfigs };

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
    ['Queue depth', metrics.queueDepth],
    ['Delivery latency', formatDuration(metrics.averageDeliveryLatencyMs)],
    ['Task duration', formatDuration(metrics.averageTaskDurationMs)],
    ['Retries', metrics.retries],
    ['Failures', metrics.failures],
    ['Agent uptime', `${metrics.agentUptimePercent}%`],
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '7px' }}>
        {metricCards.map(([label, value]) => (
          <div key={label} className="glass-panel" style={{ padding: '9px' }}>
            <div style={{ fontSize: '8px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--accent-cyan)', marginTop: '2px' }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="glass-panel" style={{ padding: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700 }}>
            <HeartPulse size={13} color="var(--accent-purple)" /> WORKSPACE HEALTH
          </div>
          <div style={{ display: 'flex', gap: '5px' }}>
            <button onClick={() => void refreshHealth()}><RefreshCw size={10} /> Refresh</button>
            <button onClick={() => void exportDiagnostics()}><Download size={10} /> Export</button>
          </div>
        </div>
        {exportStatus && <div style={{ marginTop: '6px', fontSize: '8px', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{exportStatus}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '8px' }}>
          {health.map((check) => (
            <div key={check.id} style={{ display: 'flex', gap: '7px', alignItems: 'flex-start', fontSize: '9px' }}>
              <span style={{ color: statusColor(check.status), fontWeight: 800, textTransform: 'uppercase', width: '28px' }}>{check.status}</span>
              <div><strong>{check.label}</strong><div style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>{check.detail}</div></div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700 }}>
            <GitBranch size={13} color="var(--accent-purple)" /> DEPENDENCY GRAPH
          </div>
          {snapshot.workflows.length > 0 && (
            <select
              value={selectedWorkflow?.id || ''}
              onChange={(event) => setSelectedWorkflowId(event.target.value)}
              style={{ maxWidth: '150px', fontSize: '9px' }}
            >
              {snapshot.workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
            </select>
          )}
        </div>
        {!selectedWorkflow ? (
          <div style={{ padding: '12px 0', color: 'var(--text-muted)', fontSize: '9px' }}>No workflow graph available.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '8px' }}>
            {selectedWorkflow.tasks.map((task) => (
              <div key={task.id} style={{ display: 'grid', gridTemplateColumns: '1fr 16px 1fr', gap: '5px', alignItems: 'center', fontSize: '9px' }}>
                <div style={{ color: task.dependencies.length ? 'var(--text-muted)' : 'var(--accent-cyan)' }}>
                  {task.dependencies.join(', ') || 'START'}
                </div>
                <span style={{ color: 'var(--text-dark)' }}>→</span>
                <div style={{ borderLeft: `2px solid ${statusColor(task.status)}`, paddingLeft: '6px' }}>
                  <strong>{task.id}</strong> · {task.owner}<div style={{ color: statusColor(task.status), textTransform: 'uppercase', fontSize: '8px' }}>{task.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-panel" style={{ padding: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700 }}>
          <Activity size={13} color="var(--accent-purple)" /> TASK TIMELINE
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '8px' }}>
          {timeline.length === 0 ? <div style={{ color: 'var(--text-muted)', fontSize: '9px' }}>No durable events recorded.</div> : timeline.map((event) => (
            <div key={event.sequence} style={{ borderLeft: `2px solid ${statusColor(event.eventType.split('.').pop() || '')}`, paddingLeft: '6px', fontSize: '9px' }}>
              <strong>{event.eventType}</strong> · {event.entityId}
              <div style={{ color: 'var(--text-muted)' }}>{new Date(event.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

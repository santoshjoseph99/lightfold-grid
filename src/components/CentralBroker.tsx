import React, { useState, useEffect } from 'react';
import { Network, ChevronRight, ChevronDown, RefreshCw, XOctagon, Shuffle, CheckCircle, GitBranch } from 'lucide-react';
import {
  approveWorkflowTask,
  approveAndMergeWorkflowTask,
  approveWorkflowSharedFiles,
  cancelWorkflow,
  cleanupWorkflowWorktree,
  cancelMessage,
  getDeadLetters,
  getMessagesLog,
  getWorkflows,
  reassignMessage,
  reassignWorkflowTask,
  retryWorkflowTask,
  retryMessage,
  StarlightMessage,
  subscribeToMessages,
  subscribeToWorkflows,
  testWorkflowWorktree,
} from '../services/brokerProtocol';
import type { WorkflowRecord, WorkflowTaskRecord } from '../services/workflowCore';

interface CentralBrokerProps {
  paneIds: string[];
}

export const CentralBroker: React.FC<CentralBrokerProps> = ({ paneIds }) => {
  const [activeTab, setActiveTab] = useState<'workflows' | 'flow' | 'json'>('workflows');
  const [messages, setMessages] = useState<StarlightMessage[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);

  useEffect(() => {
    // Set initial log
    setMessages(getMessagesLog());

    // Subscribe to new broker messages
    const unsubscribe = subscribeToMessages((_newMsg) => {
      setMessages([...getMessagesLog()]);
    });

    setWorkflows(getWorkflows());
    const unsubscribeWorkflows = subscribeToWorkflows(() => setWorkflows(getWorkflows()));
    return () => {
      unsubscribe();
      unsubscribeWorkflows();
    };
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedMessageId(expandedMessageId === id ? null : id);
  };

  // Helper to get status color HSL
  const getStatusColor = (status: StarlightMessage['status']) => {
    switch (status) {
      case 'completed': return 'var(--accent-green)';
      case 'acknowledged': return 'var(--accent-cyan)';
      case 'delivered':
      case 'delivering': return 'var(--accent-purple)';
      case 'failed':
      case 'cancelled': return 'var(--accent-red)';
      default: return 'var(--accent-orange)';
    }
  };

  const handleReassign = (msg: StarlightMessage) => {
    const candidates = paneIds.filter((paneId) => paneId !== msg.to);
    const target = window.prompt(`Reassign to pane (${candidates.join(', ')}):`, candidates[0] || '');
    if (target) reassignMessage(msg.messageId, target);
  };

  const handleWorkflowReassign = (workflow: WorkflowRecord, task: WorkflowTaskRecord) => {
    const target = window.prompt(`Reassign ${task.id} to pane:`, task.owner);
    if (target) reassignWorkflowTask(workflow.id, task.id, target);
  };

  const handleCodingAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };

  const workflowStatusColor = (status: string) => {
    if (status === 'completed' || status === 'ready') return 'var(--accent-green)';
    if (status === 'failed' || status === 'cancelled') return 'var(--accent-red)';
    if (status === 'blocked' || status === 'planned') return 'var(--text-muted)';
    return 'var(--accent-orange)';
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'rgba(255, 255, 255, 0.01)',
        borderLeft: '1px solid var(--panel-border)',
      }}
    >
      {/* Title Header */}
      <div
        style={{
          height: '48px',
          borderBottom: '1px solid var(--panel-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Network size={16} style={{ color: 'var(--accent-purple)' }} />
          <span style={{ fontWeight: 600, fontSize: '14px', letterSpacing: '0.05em' }}>CENTRAL BROKER</span>
          {getDeadLetters().length > 0 && (
            <span style={{ fontSize: '9px', color: 'var(--accent-red)' }}>
              DEAD LETTERS {getDeadLetters().length}
            </span>
          )}
        </div>
        
        {/* Toggle Tab buttons */}
        <div style={{ display: 'flex', gap: '4px', background: 'rgba(255, 255, 255, 0.04)', padding: '2px', borderRadius: '6px' }}>
          <button
            onClick={() => setActiveTab('workflows')}
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              border: 'none',
              background: activeTab === 'workflows' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              color: activeTab === 'workflows' ? 'var(--text-main)' : 'var(--text-muted)',
              fontSize: '10px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            WORKFLOWS
          </button>
          <button
            onClick={() => setActiveTab('flow')}
            style={{
              padding: '4px 10px',
              borderRadius: '4px',
              border: 'none',
              background: activeTab === 'flow' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              color: activeTab === 'flow' ? 'var(--text-main)' : 'var(--text-muted)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            SEQUENCE FLOW
          </button>
          <button
            onClick={() => setActiveTab('json')}
            style={{
              padding: '4px 10px',
              borderRadius: '4px',
              border: 'none',
              background: activeTab === 'json' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              color: activeTab === 'json' ? 'var(--text-main)' : 'var(--text-muted)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            JSON LOG
          </button>
        </div>
      </div>

      {/* Pane Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {activeTab === 'workflows' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {workflows.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-dark)', fontSize: '12px' }}>
                No workflows submitted.
              </div>
            ) : workflows.map((workflow) => {
              const completed = workflow.tasks.filter((task) => task.status === 'completed').length;
              return (
                <div key={workflow.id} className="glass-panel" style={{ padding: '10px', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <GitBranch size={12} style={{ color: 'var(--accent-purple)' }} />
                        <strong style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{workflow.name}</strong>
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '9px', marginTop: '3px' }}>
                        {completed}/{workflow.tasks.length} complete · {workflow.status}
                      </div>
                    </div>
                    {!['completed', 'cancelled'].includes(workflow.status) && (
                      <button onClick={() => cancelWorkflow(workflow.id)} title="Cancel workflow">
                        <XOctagon size={11} />
                      </button>
                    )}
                  </div>
                  <div style={{ height: '3px', background: 'rgba(255,255,255,0.05)', margin: '8px 0', borderRadius: '4px' }}>
                    <div style={{ width: `${(completed / workflow.tasks.length) * 100}%`, height: '100%', background: 'var(--accent-green)', borderRadius: '4px' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {workflow.tasks.map((task) => (
                      <div key={task.id} style={{ padding: '6px', background: 'rgba(255,255,255,0.02)', borderLeft: `2px solid ${workflowStatusColor(task.status)}`, borderRadius: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 600 }}>{task.id} · {task.owner}</span>
                          <span style={{ fontSize: '8px', color: workflowStatusColor(task.status), textTransform: 'uppercase' }}>{task.status}</span>
                        </div>
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>{task.goal}</div>
                        {task.worktree && (
                          <div style={{ fontSize: '8px', color: 'var(--accent-cyan)', marginTop: '3px', wordBreak: 'break-all' }}>
                            {task.worktree.branch} · {task.worktree.status}
                            {task.worktree.changedFiles.length > 0 && ` · ${task.worktree.changedFiles.join(', ')}`}
                          </div>
                        )}
                        {task.error && <div style={{ fontSize: '8px', color: 'var(--accent-red)', marginTop: '3px' }}>{task.error}</div>}
                        <div style={{ display: 'flex', gap: '5px', marginTop: '4px' }}>
                          {task.requiresApproval && !task.approved && task.status === 'ready' && (
                            <button onClick={() => approveWorkflowTask(workflow.id, task.id)} title="Approve task">
                              <CheckCircle size={10} /> Approve
                            </button>
                          )}
                          {task.status === 'failed' && (
                            <>
                              <button onClick={() => retryWorkflowTask(workflow.id, task.id)}><RefreshCw size={10} /> Retry</button>
                              <button onClick={() => handleWorkflowReassign(workflow, task)}><Shuffle size={10} /> Reassign</button>
                            </>
                          )}
                          {task.coding && task.status === 'reviewing' && task.worktree?.status === 'review' && (
                            <button onClick={() => void handleCodingAction(() => approveAndMergeWorkflowTask(workflow.id, task.id))}>
                              <CheckCircle size={10} /> Approve & Merge
                            </button>
                          )}
                          {task.coding && task.status === 'reviewing' && task.worktree?.status === 'conflicted' && (
                            <button onClick={() => void handleCodingAction(() => approveWorkflowSharedFiles(workflow.id, task.id))}>
                              <CheckCircle size={10} /> Approve Shared Files
                            </button>
                          )}
                          {task.coding && task.status === 'reviewing' && task.worktree?.status === 'tests-failed' && (
                            <button onClick={() => void handleCodingAction(() => testWorkflowWorktree(workflow.id, task.id))}>
                              <RefreshCw size={10} /> Run Tests
                            </button>
                          )}
                          {task.worktree && task.worktree.status !== 'cleaned' && (
                            <button
                              onClick={() => void handleCodingAction(() => cleanupWorkflowWorktree(
                                workflow.id,
                                task.id,
                                ['conflicted', 'tests-failed', 'preserved'].includes(task.worktree?.status || '')
                              ))}
                            >
                              <XOctagon size={10} /> Cleanup
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : activeTab === 'flow' ? (
          /* Real-time SVG Flow diagram */
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '350px' }}>
            {messages.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  fontSize: '12px',
                  color: 'var(--text-dark)',
                  textAlign: 'center',
                }}
              >
                No active traffic.<br />Echo a [[STARLIGHT-MSG]] envelope in a shell to watch.
              </div>
            ) : (
              <div style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
                <svg width="100%" height={Math.max(300, messages.length * 90 + 60)} style={{ minWidth: '280px' }}>
                  {/* Define SVG arrow markers and gradients */}
                  <defs>
                    <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 1 L 10 5 L 0 9 z" fill="rgba(255,255,255,0.4)" />
                    </marker>
                    <marker id="arrow-glow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--accent-cyan)" />
                    </marker>
                  </defs>

                  {/* Draw Vertical Columns */}
                  {/* Col 1: Broker */}
                  <line x1="50%" y1="30" x2="50%" y2={messages.length * 90 + 30} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" />
                  <text x="50%" y="20" fill="var(--accent-purple)" textAnchor="middle" fontSize="11" fontWeight="bold" letterSpacing="0.05em">BROKER</text>
                  
                  {/* Col 2: Left (Sources) */}
                  <line x1="15%" y1="30" x2="15%" y2={messages.length * 90 + 30} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" />
                  <text x="15%" y="20" fill="var(--text-muted)" textAnchor="middle" fontSize="10" fontWeight="600">SOURCE</text>

                  {/* Col 3: Right (Targets) */}
                  <line x1="85%" y1="30" x2="85%" y2={messages.length * 90 + 30} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" />
                  <text x="85%" y="20" fill="var(--text-muted)" textAnchor="middle" fontSize="10" fontWeight="600">TARGET</text>

                  {/* Loop through messages and draw arrows */}
                  {messages.map((msg, index) => {
                    const y = index * 90 + 65;
                    const isActive = ['delivering', 'delivered', 'acknowledged', 'completed'].includes(msg.status);
                    const isStopped = ['failed', 'cancelled'].includes(msg.status);
                    const strokeColor = msg.status === 'completed' ? 'var(--accent-green)' : isActive ? 'var(--accent-cyan)' : isStopped ? 'var(--accent-red)' : 'var(--accent-orange)';
                    
                    return (
                      <g key={msg.id} style={{ animation: 'slideInUp 0.3s ease forwards' }}>
                        {/* Step Label info */}
                        <text x="50%" y={y - 12} fill="var(--text-main)" fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle">
                          {msg.command.length > 25 ? `${msg.command.substring(0, 22)}...` : msg.command}
                        </text>

                        {/* Arrow 1: Source to Broker */}
                        <path
                          d={`M 15% ${y} L 48% ${y}`}
                          fill="none"
                          stroke={strokeColor}
                          strokeWidth="1.5"
                          markerEnd={`url(#${isActive ? 'arrow-glow' : 'arrow'})`}
                          strokeDasharray={msg.status === 'pending' ? '4 2' : 'none'}
                        />
                        <text x="32%" y={y + 12} fill="var(--text-muted)" fontSize="8" textAnchor="middle">
                          {msg.from}
                        </text>

                        {/* Arrow 2: Broker to Target */}
                        {!isStopped && (
                          <>
                            <path
                              d={`M 52% ${y} L 85% ${y}`}
                              fill="none"
                              stroke={strokeColor}
                              strokeWidth="1.5"
                              markerEnd={`url(#${isActive ? 'arrow-glow' : 'arrow'})`}
                              strokeDasharray={msg.status === 'pending' ? '4 2' : 'none'}
                            />
                            <text x="68%" y={y + 12} fill="var(--text-muted)" fontSize="8" textAnchor="middle">
                              {msg.to}
                            </text>
                          </>
                        )}
                        
                        {/* Status badge in the center broker node */}
                        <circle cx="50%" cy={y} r="10" fill="#0f172a" stroke={strokeColor} strokeWidth="2" />
                        <text x="50%" y={y + 3} fill={strokeColor} fontSize="8" textAnchor="middle" fontWeight="bold">
                          {msg.status[0].toUpperCase()}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </div>
        ) : (
          /* Interactive JSON Log Panel */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {messages.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '32px 0',
                  fontSize: '12px',
                  color: 'var(--text-dark)',
                }}
              >
                No message JSON recorded.
              </div>
            ) : (
              messages.map((msg) => {
                const isExpanded = expandedMessageId === msg.id;
                
                return (
                  <div
                    key={msg.id}
                    className="glass-panel animate-slideup"
                    style={{
                      borderLeft: `3px solid ${getStatusColor(msg.status)}`,
                      background: 'rgba(255, 255, 255, 0.02)',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleExpand(msg.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                          {msg.from} ➔ {msg.to}
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 'bold',
                            textTransform: 'uppercase',
                            color: getStatusColor(msg.status),
                            background: `${getStatusColor(msg.status)}15`,
                            padding: '2px 6px',
                            borderRadius: '4px',
                          }}
                        >
                          {msg.status}
                        </span>
                        <span style={{ fontSize: '10px', color: 'var(--text-dark)' }}>
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop: '6px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-main)',
                        paddingLeft: '20px',
                        fontSize: '11px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {msg.command}
                    </div>

                    {isExpanded && (
                      <>
                        <pre
                          style={{
                            marginTop: '12px',
                            background: 'rgba(0,0,0,0.3)',
                            padding: '10px',
                            borderRadius: '6px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '10px',
                            color: '#a7f3d0',
                            overflowX: 'auto',
                            border: '1px solid rgba(255, 255, 255, 0.03)',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {JSON.stringify(msg, null, 2)}
                        </pre>
                        {msg.kind === 'request' && ['failed', 'cancelled'].includes(msg.status) && (
                          <div
                            style={{ display: 'flex', gap: '6px', marginTop: '8px' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button onClick={() => retryMessage(msg.messageId)} title="Retry request">
                              <RefreshCw size={11} /> Retry
                            </button>
                            <button onClick={() => handleReassign(msg)} title="Reassign request">
                              <Shuffle size={11} /> Reassign
                            </button>
                          </div>
                        )}
                        {msg.kind === 'request' && !['completed', 'failed', 'cancelled'].includes(msg.status) && (
                          <div
                            style={{ display: 'flex', gap: '6px', marginTop: '8px' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button onClick={() => cancelMessage(msg.messageId)} title="Cancel request">
                              <XOctagon size={11} /> Cancel
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};

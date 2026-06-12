import React, { useState, useEffect } from 'react';
import { Shield, Play, XOctagon, Edit3 } from 'lucide-react';
import { StarlightMessage, enqueueCommand, rejectMessage, subscribeToMessages, getMessagesLog } from '../services/brokerProtocol';

export const ApprovalOverlay: React.FC = () => {
  const [pendingMessages, setPendingMessages] = useState<StarlightMessage[]>([]);
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null);
  const [editedText, setEditedText] = useState('');

  // Collect pending messages
  const updatePending = () => {
    const allMessages = getMessagesLog();
    setPendingMessages(allMessages.filter((m) => m.status === 'pending'));
  };

  useEffect(() => {
    // Synchronize initial logs
    updatePending();

    // Subscribe to updates
    const unsubscribe = subscribeToMessages(() => {
      updatePending();
    });

    return unsubscribe;
  }, []);

  const handleApprove = (msg: StarlightMessage) => {
    const commandToRun = editingCommandId === msg.id ? editedText : msg.command;
    enqueueCommand(msg.to, commandToRun, msg.id);
    setEditingCommandId(null);
  };

  const handleReject = (msg: StarlightMessage) => {
    rejectMessage(msg.id);
    setEditingCommandId(null);
  };

  const startEditing = (msg: StarlightMessage) => {
    setEditingCommandId(msg.id);
    setEditedText(msg.command);
  };

  if (pendingMessages.length === 0) return null;

  // Render top-most card in the queue
  const currentMsg = pendingMessages[0];
  const isEditing = editingCommandId === currentMsg.id;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(5, 8, 16, 0.45)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        animation: 'fadeIn 0.25s ease',
      }}
    >
      <div
        className="glass-panel animate-slideup"
        style={{
          width: '100%',
          maxWidth: '520px',
          background: 'rgba(15, 23, 42, 0.85)',
          border: '1px solid var(--accent-orange)',
          boxShadow: '0 0 32px rgba(249, 115, 22, 0.15)',
          padding: '24px',
          borderRadius: '16px',
        }}
      >
        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'rgba(249, 115, 22, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-orange)',
            }}
          >
            <Shield size={20} />
          </div>
          <div>
            <h4 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)' }}>GATEKEEPER APPROVAL REQUIRED</h4>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Instruction from <span style={{ color: 'var(--accent-purple)', fontWeight: 'bold' }}>{currentMsg.from}</span> to execute on <span style={{ color: 'var(--accent-cyan)', fontWeight: 'bold' }}>{currentMsg.to}</span>
            </p>
          </div>
        </div>

        {/* Command Body */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px', letterSpacing: '0.05em' }}>
            COMMAND INJECTION PAYLOAD
          </label>
          
          {isEditing ? (
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              style={{
                width: '100%',
                height: '90px',
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid var(--accent-orange)',
                borderRadius: '8px',
                padding: '10px',
                color: '#fff',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                resize: 'none',
                outline: 'none',
              }}
            />
          ) : (
            <div
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '8px',
                padding: '12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: '#e5e7eb',
                maxHeight: '120px',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {currentMsg.command}
            </div>
          )}
        </div>

        {/* Action Panel Buttons */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={() => handleReject(currentMsg)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: 'rgba(239, 68, 68, 0.1)',
              color: 'var(--accent-red)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)')}
          >
            <XOctagon size={14} />
            Reject
          </button>

          {!isEditing && (
            <button
              onClick={() => startEditing(currentMsg)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: 'rgba(255, 255, 255, 0.04)',
                color: 'var(--text-main)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)')}
            >
              <Edit3 size={14} />
              Edit Payload
            </button>
          )}

          <button
            onClick={() => handleApprove(currentMsg)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 20px',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--accent-cyan)',
              color: '#030712',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'box-shadow 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 0 12px var(--accent-cyan-glow)')}
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
          >
            <Play size={14} fill="#030712" />
            Approve & Run
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * AttributePanel — Contestant detail panel shown when a Sprite is clicked.
 *
 * Displays:
 *   - Name, Position, Zone, Zone_Type, Energy, connection status (Req 6.9, 11.10)
 *   - Heartbeat details: last heartbeat time, latency, CPU load, memory, response latency (Req 9.12)
 *   - Like / dislike counts (Req 10.4)
 *   - Current zone API availability summary (Req 11.10)
 *
 * Requirements: 6.9, 9.12, 10.4, 11.10
 */

import { useEffect, useState, useCallback } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useUiStore } from '../stores/uiStore';
import { apiClient } from '../services/api-client';
import type { Contestant, Zone, ZoneType, HeartbeatRecord, ZoneRule } from '../../../server/src/types/index';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VoteCounts {
  likes: number;
  dislikes: number;
}

interface HeartbeatDetail {
  lastTimestamp: number | null;
  latencyMs: number | null;
  cpuLoad: number | null;
  memoryUsage: number | null;
  responseLatency: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ts: number | null): string {
  if (ts === null) return '—';
  const diff = Date.now() - ts;
  if (diff < 1000) return '刚刚';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s 前`;
  return new Date(ts).toLocaleTimeString();
}

function statusColor(status: Contestant['status']): string {
  switch (status) {
    case 'online': return '#4ade80';
    case 'busy': return '#facc15';
    case 'timeout': return '#f87171';
    case 'offline': return '#6b7280';
    default: return '#9ca3af';
  }
}

function statusLabel(status: Contestant['status']): string {
  switch (status) {
    case 'online': return '在线';
    case 'busy': return '忙碌';
    case 'timeout': return '超时';
    case 'offline': return '离线';
    default: return status;
  }
}

function energyColor(energy: number): string {
  if (energy > 60) return '#4ade80';
  if (energy > 30) return '#facc15';
  return '#f87171';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Row({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ color: '#9ca3af', fontSize: 12 }}>{label}</span>
      <span style={{ color: valueColor ?? '#e5e7eb', fontSize: 12, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: '#7ec8ff', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AttributePanel() {
  const selectedId = useUiStore((s) => s.selectedContestantId);
  const selectContestant = useUiStore((s) => s.selectContestant);
  const contestants = useGameStore((s) => s.contestants);
  const zones = useGameStore((s) => s.zones);

  const [votes, setVotes] = useState<VoteCounts>({ likes: 0, dislikes: 0 });
  const [heartbeat, setHeartbeat] = useState<HeartbeatDetail>({
    lastTimestamp: null, latencyMs: null, cpuLoad: null, memoryUsage: null, responseLatency: null,
  });
  const [zoneType, setZoneType] = useState<ZoneType | null>(null);
  const [zoneRule, setZoneRule] = useState<ZoneRule | null>(null);

  const contestant: Contestant | undefined = selectedId ? contestants.get(selectedId) : undefined;
  const zone: Zone | undefined = contestant?.currentZoneId ? zones.get(contestant.currentZoneId) : undefined;

  // Fetch votes and heartbeat data from API when selection changes
  const fetchData = useCallback(async (id: string) => {
    try {
      const [votesRes, hbRes, zoneTypesRes] = await Promise.allSettled([
        apiClient.get<{ likes: number; dislikes: number }>(`/api/contestants/${id}/votes`),
        apiClient.get<{ records: HeartbeatRecord[] }>(`/api/admin/contestants/${id}/heartbeat-history?limit=1`),
        zone ? apiClient.get<ZoneType[]>('/api/admin/zone-types') : Promise.resolve(null),
      ]);

      if (votesRes.status === 'fulfilled') {
        setVotes(votesRes.value);
      }

      if (hbRes.status === 'fulfilled' && hbRes.value) {
        const latest = hbRes.value.records?.[0];
        if (latest) {
          setHeartbeat({
            lastTimestamp: latest.timestamp,
            latencyMs: Date.now() - latest.timestamp,
            cpuLoad: latest.payload.cpuLoad,
            memoryUsage: latest.payload.memoryUsage,
            responseLatency: latest.payload.responseLatency,
          });
        }
      }

      if (zoneTypesRes.status === 'fulfilled' && zoneTypesRes.value && zone) {
        const zt = zoneTypesRes.value.find((t) => t.id === zone.zoneTypeId);
        if (zt) {
          setZoneType(zt);
          setZoneRule(zt.rule);
        }
      }
    } catch {
      // silently ignore fetch errors in UI
    }
  }, [zone]);

  useEffect(() => {
    if (!selectedId) return;
    setVotes({ likes: 0, dislikes: 0 });
    setHeartbeat({ lastTimestamp: null, latencyMs: null, cpuLoad: null, memoryUsage: null, responseLatency: null });
    setZoneType(null);
    setZoneRule(null);
    fetchData(selectedId);
  }, [selectedId, fetchData]);

  const handleVote = async (type: 'like' | 'dislike') => {
    if (!selectedId) return;
    try {
      await apiClient.post(`/api/contestants/${selectedId}/vote`, { type });
      setVotes((prev) => ({
        likes: type === 'like' ? prev.likes + 1 : prev.likes,
        dislikes: type === 'dislike' ? prev.dislikes + 1 : prev.dislikes,
      }));
    } catch {
      // ignore
    }
  };

  if (!contestant) return null;

  const allowedAPIs = zoneRule?.allowedAPIs ?? [];
  const forbiddenAPIs = zoneRule?.forbiddenAPIs ?? [];

  return (
    <div
      style={{
        position: 'fixed',
        top: 80,
        right: 16,
        width: 280,
        background: 'rgba(15, 15, 30, 0.95)',
        border: '1px solid rgba(120, 180, 255, 0.3)',
        borderRadius: 12,
        padding: 16,
        color: '#e5e7eb',
        fontFamily: 'monospace',
        zIndex: 100,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        maxHeight: 'calc(100vh - 100px)',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f0f9ff' }}>{contestant.name}</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>{contestant.id.slice(0, 12)}…</div>
        </div>
        <button
          onClick={() => selectContestant(null)}
          style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
          aria-label="关闭"
        >
          ×
        </button>
      </div>

      {/* Status */}
      <Section title="状态">
        <Row label="连接状态" value={statusLabel(contestant.status)} valueColor={statusColor(contestant.status)} />
        <Row label="位置" value={`(${Math.round(contestant.position.x)}, ${Math.round(contestant.position.y)})`} />
        <Row label="区域" value={zone?.name ?? '—'} />
        <Row label="区域类型" value={zoneType?.name ?? '—'} valueColor="#a78bfa" />
        <Row
          label="精力值"
          value={
            <span>
              <span style={{ color: energyColor(contestant.energy) }}>{contestant.energy}</span>
              <span style={{ color: '#6b7280' }}> / 100</span>
            </span>
          }
        />
        {contestant.energy === 0 && (
          <div style={{ color: '#f87171', fontSize: 11, textAlign: 'center', padding: '4px 0' }}>⚠ 精力耗尽 — 仅可移动</div>
        )}
      </Section>

      {/* Heartbeat */}
      <Section title="心跳详情">
        <Row label="最近心跳" value={formatTime(heartbeat.lastTimestamp)} />
        <Row label="当前延迟" value={heartbeat.latencyMs !== null ? `${heartbeat.latencyMs}ms` : '—'} />
        <Row label="CPU 负载" value={heartbeat.cpuLoad !== null ? `${heartbeat.cpuLoad}%` : '—'} />
        <Row label="内存使用" value={heartbeat.memoryUsage !== null ? `${heartbeat.memoryUsage}%` : '—'} />
        <Row label="响应延迟" value={heartbeat.responseLatency !== null ? `${heartbeat.responseLatency}ms` : '—'} />
      </Section>

      {/* Zone API availability */}
      {zoneRule && (
        <Section title="区域 API 状态">
          {allowedAPIs.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ color: '#4ade80', fontSize: 11, marginBottom: 2 }}>✓ 可用</div>
              <div style={{ color: '#d1fae5', fontSize: 11 }}>
                {allowedAPIs[0] === '*' ? '全部 API' : allowedAPIs.join(', ')}
              </div>
            </div>
          )}
          {forbiddenAPIs.length > 0 && (
            <div>
              <div style={{ color: '#f87171', fontSize: 11, marginBottom: 2 }}>✗ 禁用</div>
              <div style={{ color: '#fee2e2', fontSize: 11 }}>{forbiddenAPIs.join(', ')}</div>
            </div>
          )}
        </Section>
      )}

      {/* Votes */}
      <Section title="观众评价">
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: '4px 0' }}>
          <button
            onClick={() => handleVote('like')}
            style={{
              flex: 1, padding: '6px 0', background: 'rgba(74, 222, 128, 0.15)',
              border: '1px solid rgba(74, 222, 128, 0.4)', borderRadius: 8,
              color: '#4ade80', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            👍 {votes.likes}
          </button>
          <button
            onClick={() => handleVote('dislike')}
            style={{
              flex: 1, padding: '6px 0', background: 'rgba(248, 113, 113, 0.15)',
              border: '1px solid rgba(248, 113, 113, 0.4)', borderRadius: 8,
              color: '#f87171', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            👎 {votes.dislikes}
          </button>
        </div>
      </Section>
    </div>
  );
}

export default AttributePanel;

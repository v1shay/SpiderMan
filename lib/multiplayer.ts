'use client';

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { SUITS as SUIT_CONFIGS, type DistrictId, type SuitId } from '@/lib/game-config';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

export type MultiplayerStatus = 'disabled' | 'connecting' | 'online' | 'error';

export type NetworkPlayerState = {
  playerId: string;
  suitId: SuitId;
  districtId: DistrictId;
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  mode: string;
  sequence: number;
  sentAt: number;
};

type Handlers = {
  onPlayerState: (state: NetworkPlayerState) => void;
  onPeers: (peerIds: Set<string>) => void;
  onStatus: (status: MultiplayerStatus) => void;
};

const VALID_SUITS = new Set<SuitId>(SUIT_CONFIGS.map((suit) => suit.id));
const DISTRICTS = new Set<DistrictId>(['new-york-city', 'new-york-buildings', 'street-city', 'city-night', 'backstreet']);
const finiteTuple = (value: unknown): value is [number, number, number] => Array.isArray(value)
  && value.length === 3
  && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

function validState(value: unknown): value is NetworkPlayerState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<NetworkPlayerState>;
  return typeof state.playerId === 'string'
    && state.playerId.length >= 8
    && state.playerId.length <= 80
    && VALID_SUITS.has(state.suitId as SuitId)
    && DISTRICTS.has(state.districtId as DistrictId)
    && finiteTuple(state.position)
    && finiteTuple(state.velocity)
    && state.position.every((entry) => Math.abs(entry) < 1_000_000)
    && state.velocity.every((entry) => Math.abs(entry) < 500)
    && typeof state.yaw === 'number'
    && Number.isFinite(state.yaw)
    && typeof state.mode === 'string'
    && state.mode.length <= 32
    && typeof state.sequence === 'number'
    && typeof state.sentAt === 'number';
}

function playerId() {
  const key = 'spiderman-multiplayer-id';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

export class SpiderMultiplayer {
  readonly id: string;
  private readonly client: SupabaseClient;
  private readonly handlers: Handlers;
  private channel: RealtimeChannel | null = null;
  private channelVersion = 0;
  private subscribed = false;
  private suitId: SuitId;
  private districtId: DistrictId;

  private constructor(client: SupabaseClient, suitId: SuitId, districtId: DistrictId, handlers: Handlers) {
    this.client = client;
    this.suitId = suitId;
    this.districtId = districtId;
    this.handlers = handlers;
    this.id = playerId();
  }

  static create(suitId: SuitId, districtId: DistrictId, handlers: Handlers) {
    const client = getSupabaseBrowserClient();
    if (!client) {
      handlers.onStatus('disabled');
      return null;
    }
    return new SpiderMultiplayer(client, suitId, districtId, handlers);
  }

  async join(districtId = this.districtId, suitId = this.suitId) {
    this.districtId = districtId;
    this.suitId = suitId;
    this.subscribed = false;
    this.handlers.onStatus('connecting');
    const version = ++this.channelVersion;
    if (this.channel) await this.client.removeChannel(this.channel);
    if (version !== this.channelVersion) return;

    const channel = this.client.channel(`spiderman:${districtId}`, {
      config: {
        private: true,
        broadcast: { ack: false, self: false },
        presence: { key: this.id },
      },
    });
    this.channel = channel;

    const syncPeers = () => {
      if (channel !== this.channel) return;
      const peers = new Set<string>();
      const presence = channel.presenceState<{ playerId?: string }>();
      for (const entries of Object.values(presence)) {
        for (const entry of entries) {
          if (entry.playerId && entry.playerId !== this.id) peers.add(entry.playerId);
        }
      }
      this.handlers.onPeers(peers);
    };

    channel
      .on('broadcast', { event: 'player_state' }, ({ payload }) => {
        if (!validState(payload) || payload.playerId === this.id || payload.districtId !== this.districtId) return;
        this.handlers.onPlayerState(payload);
      })
      .on('presence', { event: 'sync' }, syncPeers)
      .on('presence', { event: 'join' }, syncPeers)
      .on('presence', { event: 'leave' }, syncPeers)
      .subscribe(async (status) => {
        if (channel !== this.channel) return;
        if (status === 'SUBSCRIBED') {
          this.subscribed = true;
          await channel.track({ playerId: this.id, suitId: this.suitId, districtId: this.districtId, joinedAt: Date.now() });
          this.handlers.onStatus('online');
          syncPeers();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.subscribed = false;
          this.handlers.onStatus('error');
        } else if (status === 'CLOSED') {
          this.subscribed = false;
        }
      });
  }

  publish(state: Omit<NetworkPlayerState, 'playerId' | 'districtId'>) {
    if (!this.channel || !this.subscribed) return;
    void this.channel.send({
      type: 'broadcast',
      event: 'player_state',
      payload: { ...state, playerId: this.id, districtId: this.districtId } satisfies NetworkPlayerState,
    });
  }

  async dispose() {
    this.channelVersion += 1;
    this.subscribed = false;
    this.handlers.onPeers(new Set());
    if (this.channel) await this.client.removeChannel(this.channel);
    this.channel = null;
  }
}

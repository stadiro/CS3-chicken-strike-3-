import { DEFAULT_MATCH_CONFIG } from './config';
import type { BuyItemId, GrenadeType, MatchMode, Side } from './economy';
import type { BombSiteId } from './map';
import type { Vec3 } from './math';
import type { WeaponId, WeaponSlot } from './weapons';

/**
 * Wire protocol shared by the browser client and the authoritative server.
 * Bump PROTOCOL_VERSION on every breaking change.
 */
export const PROTOCOL_VERSION = 13;

export const TICK_RATE = DEFAULT_MATCH_CONFIG.tickRate;
export const SNAPSHOT_BUFFER_MS = DEFAULT_MATCH_CONFIG.snapshotBufferMs;
export const MATCH_FRAG_LIMIT = DEFAULT_MATCH_CONFIG.fragLimit;
export const MATCH_DURATION_MS = DEFAULT_MATCH_CONFIG.matchDurationMs;
export const RESPAWN_DELAY_MS = DEFAULT_MATCH_CONFIG.respawnMs;
export const RECONNECT_WINDOW_MS = DEFAULT_MATCH_CONFIG.reconnectWindowMs;

export type Team = 'alpha' | 'bravo';
export type MatchPhase = 'lobby' | 'countdown' | 'round_over' | 'live' | 'paused' | 'ended';
export type MatchEndReason = 'frags' | 'rounds' | 'time' | 'abandon' | 'bomb' | 'defuse';
export type HitZone = 'head' | 'body' | 'legs';
export type PickupKind = 'spawn' | 'dropped';
export type DamageSource = 'weapon' | 'grenade' | 'fall' | 'bomb';
export type DeathCause = WeaponId | 'fall' | 'c4';
export type BombPhase = 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded';

export interface ServerHello {
  protocolVersion: number;
  tickRate: number;
  serverTime: number;
  mapId: string;
  mapName: string;
  mode: MatchMode;
}

export interface PingMessage {
  clientTime: number;
}

export interface PongMessage {
  clientTime: number;
  serverTime: number;
  protocolVersion: number;
}

export interface JoinRequest {
  name: string;
  roomId?: string;
  playerId?: string;
  sessionToken?: string;
}

export interface JoinResult {
  ok: boolean;
  roomId?: string;
  mapId?: string;
  mapName?: string;
  mode?: MatchMode;
  playerId?: string;
  sessionToken?: string;
  name?: string;
  team?: Team;
  side?: Side;
  resumed?: boolean;
  error?: string;
}

export interface RoomSummary {
  id: string;
  name: string;
  mapId: string;
  mapName: string;
  mode: MatchMode;
  playerCount: number;
  maxPlayers: number;
  phase: MatchPhase;
  createdAt: number;
}

export interface CreateRoomRequest {
  name: string;
  mapId: string;
}

export interface CreateRoomResult {
  ok: boolean;
  roomId?: string;
  error?: string;
}

export interface InputFrame {
  seq: number;
  clientTime: number;
  /** Server time of the rendered remote frame used to aim this input. */
  aimTime: number;
  forward: number;
  strafe: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  crouch: boolean;
  walk: boolean;
  fire: boolean;
  scoped: boolean;
  reload: boolean;
  use: boolean;
  useHeld?: boolean;
  drop: boolean;
  switchTo: WeaponSlot | null;
}

export interface BuyRequest {
  itemId: string;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  team: Team;
  side: Side;
  position: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  armor: number;
  helmet: boolean;
  defuseKit: boolean;
  money: number;
  grenades: Partial<Record<GrenadeType, number>>;
  lastPurchaseId: BuyItemId | null;
  blindUntil: number;
  alive: boolean;
  crouching: boolean;
  walking: boolean;
  scoped: boolean;
  activeSlot: WeaponSlot;
  activeWeapon: WeaponId;
  ammo: number;
  reserve: number;
  reloadingUntil: number | null;
  respawnAt: number | null;
  kills: number;
  deaths: number;
  connected: boolean;
}

export interface PickupSnapshot {
  id: string;
  weapon: WeaponId;
  position: Vec3;
  kind: PickupKind;
}

export interface ArmorPickupSnapshot {
  id: string;
  amount: number;
  position: Vec3;
}

export interface GrenadeSnapshot {
  id: string;
  ownerId: string;
  type: GrenadeType;
  position: Vec3;
  fuseAt: number;
}

export interface BombSnapshot {
  state: BombPhase;
  carrierId: string | null;
  position: Vec3 | null;
  siteId: BombSiteId | null;
  plantedAt: number | null;
  explodeAt: number | null;
  planterId: string | null;
  defuserId: string | null;
  defuseHasKit: boolean;
  plantProgress: number;
  defuseProgress: number;
}

export type BombEventKind =
  | 'plant_started'
  | 'plant_cancelled'
  | 'planted'
  | 'defuse_started'
  | 'defuse_cancelled'
  | 'defused'
  | 'exploded'
  | 'dropped'
  | 'picked_up';

export interface BombEvent {
  kind: BombEventKind;
  playerId: string | null;
  siteId: BombSiteId | null;
  position: Vec3;
  explodeAt: number | null;
  hasKit?: boolean;
}

export interface MatchSnapshot {
  mode: MatchMode;
  phase: MatchPhase;
  round: number;
  scores: Record<Team, number>;
  timeRemainingMs: number;
  countdownEndsAt: number | null;
  roundOverEndsAt: number | null;
  matchEndsAt: number | null;
  buyEndsAt: number | null;
  roundEndsAt: number | null;
  pauseDeadline: number | null;
  rematchVotes: string[];
  winnerId: string | null;
  endReason: MatchEndReason | null;
  fragLimit: number;
  roundsToWin: number;
  sideSwapAfterRound: number;
}

export interface Snapshot {
  tick: number;
  serverTime: number;
  mapId: string;
  match: MatchSnapshot;
  players: PlayerSnapshot[];
  pickups: PickupSnapshot[];
  armorPickups: ArmorPickupSnapshot[];
  grenades: GrenadeSnapshot[];
  bomb: BombSnapshot | null;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  team: Team;
  side: Side;
  connected: boolean;
  kills: number;
  deaths: number;
  money: number;
  rematchVote: boolean;
}

export interface LobbyState {
  mapId: string;
  mapName: string;
  mode: MatchMode;
  phase: MatchPhase;
  round: number;
  players: LobbyPlayer[];
  scores: Record<Team, number>;
  countdownEndsAt: number | null;
  roundOverEndsAt: number | null;
  matchEndsAt: number | null;
  buyEndsAt: number | null;
  roundEndsAt: number | null;
  pauseDeadline: number | null;
  winnerId: string | null;
  endReason: MatchEndReason | null;
  fragLimit: number;
  roundsToWin: number;
  sideSwapAfterRound: number;
}

export interface CountdownState {
  endsAt: number;
  seconds: number;
  round: number;
  resumed: boolean;
}

export interface KillEvent {
  killerId: string;
  killerName: string;
  victimId: string;
  victimName: string;
  weapon: DeathCause;
  headshot: boolean;
  at: number;
}

export interface HitEvent {
  shooterId: string;
  victimId: string;
  damage: number;
  headshot: boolean;
  zone: HitZone;
  healthAfter: number;
  armorAfter: number;
  hitPoint: Vec3;
  /** Where the damage came from, used for the directional damage indicator. */
  sourcePosition: Vec3;
  source: DamageSource;
}

export interface ShotEvent {
  shooterId: string;
  weapon: WeaponId;
  from: Vec3;
  to: Vec3;
  hitPlayerId: string | null;
  headshot: boolean;
}

export interface PickupEvent {
  playerId: string;
  weapon: WeaponId;
  pickupId: string;
  replacedWeapon: WeaponId | null;
}

export interface ArmorPickupEvent {
  playerId: string;
  amount: number;
  pickupId: string;
}

export interface GrenadeThrownEvent {
  playerId: string;
  grenadeId: string;
  type: GrenadeType;
  position: Vec3;
  velocity: Vec3;
}

export interface ExplosionEvent {
  grenadeId: string;
  ownerId: string;
  type: GrenadeType;
  position: Vec3;
  radius: number;
  damage: number;
  durationMs: number;
}

export interface BuyResultEvent {
  playerId: string;
  itemId: BuyItemId;
  action: 'buy' | 'refund';
  ok: boolean;
  error?: string;
  money: number;
}

export interface MapChangedEvent {
  mapId: string;
  mapName: string;
  mode: MatchMode;
}

export interface AnnouncementEvent {
  text: string;
  tone: 'info' | 'success' | 'error';
}

export interface ScoreUpdate {
  scores: Record<Team, number>;
  killerId: string;
  victimId: string;
  killerKills: number;
  victimDeaths: number;
}

export interface RoundEndEvent {
  winnerId: string | null;
  winnerName: string | null;
  scores: Record<Team, number>;
  reason: MatchEndReason;
}

export interface RoundPlayerStats {
  playerId: string;
  name: string;
  team: Team;
  side: Side;
  /** Round-only combat stats. */
  damage: number;
  hits: number;
  shots: number;
  headshots: number;
  /** Cumulative combat stats for the whole match, shown on TAB. */
  matchDamage: number;
  matchHits: number;
  matchShots: number;
  matchHeadshots: number;
  matchHeadshotKills: number;
  kills: number;
  deaths: number;
}

export interface RoundSummaryEvent {
  round: number;
  winnerId: string | null;
  winnerName: string | null;
  reason?: MatchEndReason;
  players: RoundPlayerStats[];
}

export interface ClientToServerEvents {
  ping: (payload: PingMessage) => void;
  list_rooms: (ack: (rooms: RoomSummary[]) => void) => void;
  create_room: (payload: CreateRoomRequest, ack: (result: CreateRoomResult) => void) => void;
  join: (payload: JoinRequest, ack: (result: JoinResult) => void) => void;
  input: (payload: InputFrame) => void;
  buy: (payload: BuyRequest) => void;
  refund: (payload: BuyRequest) => void;
  rematch: () => void;
  leave: () => void;
}

export interface ServerToClientEvents {
  serverHello: (payload: ServerHello) => void;
  rooms_update: (rooms: RoomSummary[]) => void;
  pong: (payload: PongMessage) => void;
  lobby: (state: LobbyState) => void;
  countdown: (state: CountdownState) => void;
  snapshot: (snapshot: Snapshot) => void;
  hit: (event: HitEvent) => void;
  shot: (event: ShotEvent) => void;
  kill: (event: KillEvent) => void;
  pickup: (event: PickupEvent) => void;
  armor_pickup: (event: ArmorPickupEvent) => void;
  grenade_thrown: (event: GrenadeThrownEvent) => void;
  explosion: (event: ExplosionEvent) => void;
  bomb_event: (event: BombEvent) => void;
  buy_result: (event: BuyResultEvent) => void;
  score_update: (event: ScoreUpdate) => void;
  round_summary: (event: RoundSummaryEvent) => void;
  round_end: (event: RoundEndEvent) => void;
  map_changed: (event: MapChangedEvent) => void;
  announce: (event: AnnouncementEvent) => void;
  server_error: (message: string) => void;
}

export type InterServerEvents = Record<string, never>;

export interface SocketData {
  playerId?: string;
  roomId?: string;
}

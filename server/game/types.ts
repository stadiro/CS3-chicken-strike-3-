import type { Vec3 } from '../../shared/math';
import type { BuyItemId, GrenadeType, Side } from '../../shared/economy';
import type { BombSiteId } from '../../shared/map';
import type { BombPhase, InputFrame, PickupKind, Team } from '../../shared/protocol';
import type { WeaponId, WeaponSlot } from '../../shared/weapons';

export interface WeaponInstance {
  id: WeaponId;
  ammo: number;
  reserve: number;
}

export interface Inventory {
  primary: WeaponInstance | null;
  secondary: WeaponInstance | null;
  knife: WeaponInstance;
  grenade: WeaponInstance | null;
  grenadeCounts: Partial<Record<GrenadeType, number>>;
}

export interface PurchaseRestore {
  primary?: WeaponInstance | null;
  secondary?: WeaponInstance | null;
  grenadeCounts?: Partial<Record<GrenadeType, number>>;
  armor?: number;
  helmet?: boolean;
  defuseKit?: boolean;
}

export interface BuyPurchase {
  itemId: BuyItemId;
  price: number;
  at: number;
  restore: PurchaseRestore;
}

export interface HistorySample {
  time: number;
  position: Vec3;
  height: number;
  alive: boolean;
}

export type PlayerAction =
  { type: 'switch'; slot: WeaponSlot } | { type: 'reload' } | { type: 'use' } | { type: 'drop' };

export interface PendingFire {
  aimTime: number;
  yaw: number;
  pitch: number;
  scoped: boolean;
  receivedAt: number;
}

export interface PlayerState {
  id: string;
  sessionToken: string;
  name: string;
  team: Team;
  side: Side;
  socketId: string | null;
  connected: boolean;
  joinedAt: number;
  disconnectedAt: number | null;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  armor: number;
  helmet: boolean;
  defuseKit: boolean;
  money: number;
  lossStreak: number;
  grenadeCounts: Partial<Record<GrenadeType, number>>;
  blindUntil: number;
  roundGrenadesThrown: number;
  purchases: BuyPurchase[];
  alive: boolean;
  crouching: boolean;
  walking: boolean;
  grounded: boolean;
  scoped: boolean;
  lastFireHeld: boolean;
  pendingFire: PendingFire | null;
  fallVelocity: number;
  jumpBufferUntil: number;
  respawnAt: number | null;
  kills: number;
  deaths: number;
  inventory: Inventory;
  activeSlot: WeaponSlot;
  lastFireAt: number;
  /** Number of consecutive shots in the current spray; reset after a pause. */
  sprayShots: number;
  roundShots: number;
  roundHits: number;
  roundDamage: number;
  roundHeadshots: number;
  matchShots: number;
  matchHits: number;
  matchDamage: number;
  matchHeadshots: number;
  matchHeadshotKills: number;
  reloadingUntil: number | null;
  reloadWeapon: WeaponId | null;
  lastUseAt: number;
  lastInput: InputFrame | null;
  lastInputSeq: number;
  pendingActions: PlayerAction[];
  lastInputReceivedAt: number;
  history: HistorySample[];
  lastDamageAt: number;
  lastAttackerId: string | null;
  rematchVote: boolean;
}

export interface PickupState {
  id: string;
  weapon: WeaponId;
  position: Vec3;
  kind: PickupKind;
  ammo: number;
  reserve: number;
  available: boolean;
  createdAt: number;
}

export interface ArmorPickupState {
  id: string;
  amount: number;
  position: Vec3;
  available: boolean;
}

export interface GrenadeState {
  id: string;
  ownerId: string;
  team: Team;
  type: GrenadeType;
  position: Vec3;
  velocity: Vec3;
  fuseAt: number;
}

export interface AreaEffectState {
  id: string;
  ownerId: string;
  type: 'molotov' | 'incendiary' | 'smokegrenade';
  position: Vec3;
  radius: number;
  endAt: number;
  nextTickAt: number;
  tickMs: number;
  damage: number;
}

export interface DamageResult {
  damage: number;
  armorDamage: number;
  healthAfter: number;
  armorAfter: number;
  killed: boolean;
  headshot: boolean;
  zone: 'head' | 'body' | 'legs';
}

export interface BombState {
  state: BombPhase;
  carrierId: string | null;
  position: Vec3 | null;
  siteId: BombSiteId | null;
  plantedAt: number | null;
  explodeAt: number | null;
  planterId: string | null;
  plantStartedAt: number | null;
  plantEndsAt: number | null;
  defuserId: string | null;
  defuseStartedAt: number | null;
  defuseEndsAt: number | null;
  defuseHasKit: boolean;
}

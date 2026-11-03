import { randomBytes } from 'node:crypto';
import { DEFAULT_MAP_ID, getMapById, type ArenaMap, type MapId } from '../../shared/map';
import type { RoomSummary } from '../../shared/protocol';
import { Match, type MatchEvent, type MatchOptions } from './match';

export interface GameRoom {
  readonly id: string;
  name: string;
  readonly map: ArenaMap;
  readonly match: Match;
  readonly createdAt: number;
  readonly isDefault: boolean;
}

export interface CreateRoomOptions {
  id?: string;
  name: string;
  mapId: MapId | string;
  matchOptions?: Partial<MatchOptions>;
  isDefault?: boolean;
}

export interface RoomTickResult {
  room: GameRoom;
  events: MatchEvent[];
}

export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();
  private defaultRoomId: string | null = null;

  constructor(defaultOptions?: CreateRoomOptions) {
    if (defaultOptions !== undefined) {
      const defaultRoom = this.createRoom({
        ...defaultOptions,
        id: defaultOptions.id ?? 'default',
        isDefault: true,
      });
      this.defaultRoomId = defaultRoom.id;
    }
  }

  generateRoomId(): string {
    return `game-${randomBytes(3).toString('hex')}`;
  }

  createRoom(options: CreateRoomOptions): GameRoom {
    const id = options.id ?? this.generateRoomId();
    if (this.rooms.has(id)) {
      throw new Error(`Room with id "${id}" already exists`);
    }

    const map = getMapById(options.mapId) ?? getMapById(DEFAULT_MAP_ID);
    if (map === undefined) {
      throw new Error(`Invalid map: ${options.mapId}`);
    }

    const match = new Match({
      map,
      ...options.matchOptions,
    });

    const room: GameRoom = {
      id,
      name: options.name.trim() || `Игра на ${map.name}`,
      map,
      match,
      createdAt: Date.now(),
      isDefault: options.isDefault ?? false,
    };

    this.rooms.set(id, room);
    return room;
  }

  getRoom(id: string): GameRoom | undefined {
    return this.rooms.get(id);
  }

  getDefaultRoom(): GameRoom | undefined {
    if (this.defaultRoomId !== null) {
      return this.rooms.get(this.defaultRoomId);
    }
    // Return first available room or create one
    const first = this.rooms.values().next().value;
    if (first !== undefined) {
      return first;
    }
    const created = this.createRoom({
      id: 'default',
      name: 'Основная игра',
      mapId: DEFAULT_MAP_ID,
      isDefault: true,
    });
    this.defaultRoomId = created.id;
    return created;
  }

  findRoomForPlayer(playerId: string): GameRoom | undefined {
    for (const room of this.rooms.values()) {
      if (room.match.getPlayer(playerId) !== undefined) {
        return room;
      }
    }
    return undefined;
  }

  findRoomBySocket(socketId: string): GameRoom | undefined {
    for (const room of this.rooms.values()) {
      for (const player of room.match.getPlayers()) {
        if (player.socketId === socketId) {
          return room;
        }
      }
    }
    return undefined;
  }

  removeRoom(id: string): boolean {
    const room = this.rooms.get(id);
    if (room === undefined) {
      return false;
    }
    if (room.isDefault) {
      return false;
    }
    this.rooms.delete(id);
    return true;
  }

  /**
   * Immediately destroys non-default rooms when empty (0 connected players).
   */
  cleanupEmptyRoom(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (room === undefined || room.isDefault) {
      return false;
    }
    const players = room.match.getPlayers();
    const hasConnected = players.some((p) => p.connected);
    if (!hasConnected) {
      this.rooms.delete(roomId);
      return true;
    }
    return false;
  }

  listRooms(): RoomSummary[] {
    const list: RoomSummary[] = [];
    for (const room of this.rooms.values()) {
      const players = room.match.getPlayers();
      const connectedCount = players.filter((p) => p.connected).length;
      list.push({
        id: room.id,
        name: room.name,
        mapId: room.map.id,
        mapName: room.map.name,
        mode: room.match.getMode(),
        playerCount: connectedCount,
        maxPlayers: 2,
        phase: room.match.currentPhase,
        createdAt: room.createdAt,
      });
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  getAllRooms(): GameRoom[] {
    return Array.from(this.rooms.values());
  }

  tick(now: number, dt: number): RoomTickResult[] {
    const results: RoomTickResult[] = [];
    for (const room of this.rooms.values()) {
      room.match.tick(now, dt);
      const events = room.match.drainEvents();
      results.push({ room, events });
    }
    return results;
  }
}

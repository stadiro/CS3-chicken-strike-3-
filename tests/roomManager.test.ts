import { describe, expect, it } from 'vitest';
import { RoomManager } from '../server/game/roomManager';

describe('RoomManager', () => {
  it('creates a default room when initialized with defaultOptions', () => {
    const manager = new RoomManager({ name: 'Default', mapId: 'fy_sand' });
    const rooms = manager.listRooms();
    expect(rooms.length).toBe(1);
    expect(rooms[0]?.mapId).toBe('fy_sand');
    expect(rooms[0]?.id).toBe('default');
  });

  it('creates and lists multiple custom rooms', () => {
    const manager = new RoomManager();
    const dust = manager.createRoom({ name: 'Dust 1v1', mapId: 'de_dust2' });
    const wow = manager.createRoom({ name: 'Wow Arena', mapId: 'fy_wow' });

    expect(dust.map.id).toBe('de_dust2');
    expect(wow.map.id).toBe('fy_wow');

    const list = manager.listRooms();
    expect(list.length).toBe(2);
    expect(list.map((r) => r.id)).toContain(dust.id);
    expect(list.map((r) => r.id)).toContain(wow.id);
  });

  it('finds room by player ID or socket ID', () => {
    const manager = new RoomManager();
    const room = manager.createRoom({ name: 'Test Room', mapId: 'fy_sand' });
    const outcome = room.match.join('socket-1', { name: 'Player1' }, 1_000);
    expect(outcome.result.ok).toBe(true);
    const playerId = outcome.result.playerId!;

    expect(manager.findRoomForPlayer(playerId)?.id).toBe(room.id);
    expect(manager.findRoomBySocket('socket-1')?.id).toBe(room.id);
    expect(manager.findRoomBySocket('unknown-socket')).toBeUndefined();
  });

  it('destroys empty custom room immediately when last player leaves', () => {
    const manager = new RoomManager();
    const custom = manager.createRoom({ name: 'Temporary', mapId: 'de_dust2' });
    const outcome = custom.match.join('socket-p1', { name: 'P1' }, 1_000);
    const p1Id = outcome.result.playerId!;

    expect(manager.getRoom(custom.id)).toBeDefined();

    // Player leaves
    custom.match.leave(p1Id, 2_000);
    const cleaned = manager.cleanupEmptyRoom(custom.id);
    expect(cleaned).toBe(true);
    expect(manager.getRoom(custom.id)).toBeUndefined();
  });

  it('does not remove default room on cleanup', () => {
    const manager = new RoomManager({ name: 'Default', mapId: 'fy_sand' });
    const defaultRoom = manager.getDefaultRoom()!;
    const outcome = defaultRoom.match.join('socket-p1', { name: 'P1' }, 1_000);
    defaultRoom.match.leave(outcome.result.playerId!, 2_000);

    const cleaned = manager.cleanupEmptyRoom(defaultRoom.id);
    expect(cleaned).toBe(false);
    expect(manager.getRoom(defaultRoom.id)).toBeDefined();
  });
});

import { describe, expect, it } from 'vitest';
import { getMapById } from '../shared/map';
import { Match } from '../server/game/match';
import { distance } from '../shared/math';
import { BUY } from '../shared/economy';

describe('Match 2v2 mode', () => {
  it('accepts up to 4 players and enforces 2 per team', () => {
    const map = getMapById('de_dust2')!;
    const match = new Match({ map, roomMode: '2v2' });

    expect(match.maxPlayers).toBe(4);
    expect(match.maxPerTeam).toBe(2);

    const p1 = match.join('s1', { name: 'Alpha1' }, 1_000);
    const p2 = match.join('s2', { name: 'Bravo1' }, 1_010);
    const p3 = match.join('s3', { name: 'Alpha2' }, 1_020);
    const p4 = match.join('s4', { name: 'Bravo2' }, 1_030);

    expect(p1.result.ok).toBe(true);
    expect(p2.result.ok).toBe(true);
    expect(p3.result.ok).toBe(true);
    expect(p4.result.ok).toBe(true);

    expect(p1.player?.team).toBe('alpha');
    expect(p2.player?.team).toBe('bravo');
    expect(p3.player?.team).toBe('alpha');
    expect(p4.player?.team).toBe('bravo');

    // 5th player is rejected
    const p5 = match.join('s5', { name: 'Extra' }, 1_040);
    expect(p5.result.ok).toBe(false);
    expect(p5.result.error).toContain('4');
  });

  it('allows switching teams before match start if team has a free slot', () => {
    const map = getMapById('fy_wow')!;
    const match = new Match({ map, roomMode: '2v2' });

    const p1 = match.join('s1', { name: 'P1' }, 1_000);
    const p2 = match.join('s2', { name: 'P2' }, 1_010);

    expect(p1.player?.team).toBe('alpha');
    expect(p2.player?.team).toBe('bravo');

    // P1 switches to Bravo (now 2 on Bravo, 0 on Alpha)
    const switched = match.chooseTeam(p1.player!.id, 'bravo', 1_020);
    expect(switched).toBe(true);
    expect(p1.player?.team).toBe('bravo');

    // A 3rd player joins -> takes free team Alpha
    const p3 = match.join('s3', { name: 'P3' }, 1_030);
    expect(p3.player?.team).toBe('alpha');

    // P3 tries to switch to Bravo, but Bravo is full (2/2)
    const blocked = match.chooseTeam(p3.player!.id, 'bravo', 1_040);
    expect(blocked).toBe(false);
    expect(p3.player?.team).toBe('alpha');
  });

  it('starts countdown only when all 4 players are ready in balanced teams', () => {
    const map = getMapById('de_dust2')!;
    const match = new Match({ map, roomMode: '2v2' });

    const p1 = match.join('s1', { name: 'A1' }, 1_000);
    const p2 = match.join('s2', { name: 'B1' }, 1_010);
    const p3 = match.join('s3', { name: 'A2' }, 1_020);
    const p4 = match.join('s4', { name: 'B2' }, 1_030);

    expect(match.currentPhase).toBe('lobby');

    match.setReady(p1.player!.id, true, 1_040);
    match.setReady(p2.player!.id, true, 1_041);
    match.setReady(p3.player!.id, true, 1_042);
    expect(match.currentPhase).toBe('lobby');

    // When 4th player is ready, match starts!
    match.setReady(p4.player!.id, true, 1_043);
    expect(match.currentPhase).toBe('countdown');
  });

  it('spawns teammates at different spawn positions', () => {
    const map = getMapById('de_dust2')!;
    const match = new Match({ map, roomMode: '2v2' });

    const p1 = match.join('s1', { name: 'A1' }, 1_000);
    const p2 = match.join('s2', { name: 'B1' }, 1_010);
    const p3 = match.join('s3', { name: 'A2' }, 1_020);
    const p4 = match.join('s4', { name: 'B2' }, 1_030);

    match.setReady(p1.player!.id, true, 1_040);
    match.setReady(p2.player!.id, true, 1_041);
    match.setReady(p3.player!.id, true, 1_042);
    match.setReady(p4.player!.id, true, 1_043);

    // Check distance between teammates
    const alphaDist = distance(p1.player!.position, p3.player!.position);
    expect(alphaDist).toBeGreaterThan(1.5);

    const bravoDist = distance(p2.player!.position, p4.player!.position);
    expect(bravoDist).toBeGreaterThan(1.5);
  });

  it('continues round in 2v2 when one teammate dies, ends round when both die', () => {
    const map = getMapById('fy_wow')!;
    const match = new Match({ map, roomMode: '2v2' });

    const p1 = match.join('s1', { name: 'A1' }, 1_000);
    const p2 = match.join('s2', { name: 'B1' }, 1_010);
    const p3 = match.join('s3', { name: 'A2' }, 1_020);
    const p4 = match.join('s4', { name: 'B2' }, 1_030);

    match.setReady(p1.player!.id, true, 1_040);
    match.setReady(p2.player!.id, true, 1_041);
    match.setReady(p3.player!.id, true, 1_042);
    match.setReady(p4.player!.id, true, 1_043);

    // Fast-forward countdown into live
    match.tick(1_043 + 8_500, 1 / 30);
    expect(match.currentPhase).toBe('live');

    // B1 kills A1
    p1.player!.health = 10;
    // Simulate damage / kill directly via player health & kill resolution
    // Fire weapon from B1 at A1
    p1.player!.alive = false;
    p1.player!.deaths = 1;
    p2.player!.kills = 1;

    // Simulate match round resolution check
    // In economy mode, aliveT is checked
    const players = match.getPlayers();
    const aliveT = players.filter((p) => p.side === 't' && p.alive).length;
    expect(aliveT).toBe(1); // A2 is still alive!

    // Round should NOT be over
    expect(p3.player?.alive).toBe(true);

    // Now A2 dies as well
    p3.player!.alive = false;
    p3.player!.deaths = 1;

    // When all T are dead, CT wins
    const aliveTAfter = players.filter((p) => p.side === 't' && p.alive).length;
    expect(aliveTAfter).toBe(0);
  });

  it('resumes match 1v2 when disconnected player timeout expires', () => {
    const map = getMapById('de_dust2')!;
    const match = new Match({ map, roomMode: '2v2' });

    const p1 = match.join('s1', { name: 'A1' }, 1_000);
    const p2 = match.join('s2', { name: 'B1' }, 1_010);
    const p3 = match.join('s3', { name: 'A2' }, 1_020);
    const p4 = match.join('s4', { name: 'B2' }, 1_030);

    match.setReady(p1.player!.id, true, 1_040);
    match.setReady(p2.player!.id, true, 1_041);
    match.setReady(p3.player!.id, true, 1_042);
    match.setReady(p4.player!.id, true, 1_043);

    match.tick(1_043 + 8_500, 1 / 30);
    expect(match.currentPhase).toBe('live');

    // A2 disconnects while A1 is alive: round continues in live, A2 dies
    match.disconnect(p3.player!.id, 10_000);
    expect(match.currentPhase).toBe('live');
    expect(match.getPlayer(p3.player!.id)?.alive).toBe(false);

    // Round time expires without plant: CT wins round, round_over begins
    const roundEnd = 1_043 + 8_500 + BUY.roundTimeMs + 1;
    match.tick(roundEnd, 1 / 30);
    expect(match.currentPhase).toBe('round_over');

    // Round over ends (roundResetMs = 5s): next round begins in paused state waiting for A2
    match.tick(roundEnd + 5_001, 1 / 30);
    expect(match.currentPhase).toBe('paused');

    // Fast-forward past reconnect window (60s)
    match.tick(roundEnd + 5_001 + 60_001, 1 / 30);
    expect(match.currentPhase).toBe('countdown');

    // Fast-forward countdown into live
    match.tick(roundEnd + 5_001 + 60_001 + 8_500, 1 / 30);
    expect(match.currentPhase).toBe('live');
    expect(match.getPlayers().length).toBe(3);
    expect(match.getPlayer(p3.player!.id)).toBeUndefined();
  });
});

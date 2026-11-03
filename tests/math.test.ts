import { describe, expect, it } from 'vitest';
import {
  add,
  angleDelta,
  clamp,
  directionFromYawPitch,
  distance,
  distanceSq,
  length,
  lengthSq,
  lerp,
  lerpAngle,
  normalize,
  normalizeAngle,
  scale,
  sub,
  vec3,
  yawPitchFromDirection,
} from '../shared/math';

describe('shared math', () => {
  it('creates vectors and clamps values', () => {
    expect(vec3()).toEqual({ x: 0, y: 0, z: 0 });
    expect(vec3(1, 2, 3)).toEqual({ x: 1, y: 2, z: 3 });
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-2, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('interpolates numbers and angles', () => {
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerp(-5, 5, 0.5)).toBe(0);
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4);
    expect(lerpAngle(Math.PI - 0.2, -Math.PI + 0.2, 0.5)).toBeCloseTo(-Math.PI, 5);
  });

  it('normalizes angles into the canonical range', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI * 2)).toBe(0);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(-Math.PI);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI);
    expect(normalizeAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5);
  });

  it('computes shortest angular deltas', () => {
    expect(angleDelta(0.2, 0.5)).toBeCloseTo(0.3);
    expect(angleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2);
  });

  it('adds, subtracts, scales, and measures vectors', () => {
    const a = vec3(1, 2, 3);
    const b = vec3(-2, 4, 0.5);
    expect(add(a, b)).toEqual({ x: -1, y: 6, z: 3.5 });
    expect(sub(a, b)).toEqual({ x: 3, y: -2, z: 2.5 });
    expect(scale(a, 2)).toEqual({ x: 2, y: 4, z: 6 });
    expect(lengthSq(vec3(3, 4, 0))).toBe(25);
    expect(length(vec3(3, 4, 0))).toBe(5);
    expect(distanceSq(vec3(0, 0, 0), vec3(1, 2, 2))).toBe(9);
    expect(distance(vec3(0, 0, 0), vec3(1, 2, 2))).toBe(3);
  });

  it('normalizes vectors safely', () => {
    const normalized = normalize(vec3(0, 5, 0));
    expect(normalized).toEqual({ x: 0, y: 1, z: 0 });
    expect(normalize(vec3(0, 0, 0))).toEqual({ x: 0, y: 0, z: 0 });
    expect(length(normalize(vec3(2, 3, 6)))).toBeCloseTo(1);
  });

  it('builds directions from yaw and pitch', () => {
    expect(directionFromYawPitch(0, 0).x).toBeCloseTo(0);
    expect(directionFromYawPitch(0, 0).y).toBeCloseTo(0);
    expect(directionFromYawPitch(0, 0).z).toBeCloseTo(-1);
    expect(directionFromYawPitch(Math.PI, 0).z).toBeCloseTo(1);
    const up = directionFromYawPitch(0.7, Math.PI / 2);
    expect(up.y).toBeCloseTo(1);
    expect(up.x).toBeCloseTo(0);
    expect(up.z).toBeCloseTo(0);
  });

  it('round-trips yaw and pitch from a direction', () => {
    const yaw = 1.2;
    const pitch = -0.42;
    const direction = directionFromYawPitch(yaw, pitch);
    const result = yawPitchFromDirection(direction);
    expect(result.yaw).toBeCloseTo(yaw);
    expect(result.pitch).toBeCloseTo(pitch);
  });
});

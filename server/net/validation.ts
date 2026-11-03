import { z } from 'zod';

const weaponSlotSchema = z.enum(['primary', 'secondary', 'knife', 'grenade']);

export const pingSchema = z.object({
  clientTime: z.number().finite().nonnegative(),
});

export const joinSchema = z.object({
  name: z.string().min(1).max(64),
  roomId: z.string().min(1).max(64).optional(),
  playerId: z.string().uuid().optional(),
  sessionToken: z
    .string()
    .regex(/^[a-f0-9]{48}$/)
    .optional(),
});

export const createRoomSchema = z.object({
  name: z.string().min(1).max(48),
  mapId: z.string().min(1).max(32),
});

export type ValidatedCreateRoomRequest = z.infer<typeof createRoomSchema>;

export const inputSchema = z.object({
  seq: z.number().int().nonnegative(),
  clientTime: z.number().finite(),
  aimTime: z.number().finite(),
  forward: z.number().finite().min(-1).max(1),
  strafe: z.number().finite().min(-1).max(1),
  yaw: z
    .number()
    .finite()
    .min(-Math.PI * 8)
    .max(Math.PI * 8),
  pitch: z
    .number()
    .finite()
    .min(-Math.PI / 2)
    .max(Math.PI / 2),
  jump: z.boolean(),
  crouch: z.boolean(),
  walk: z.boolean(),
  fire: z.boolean(),
  scoped: z.boolean(),
  reload: z.boolean(),
  use: z.boolean(),
  useHeld: z.boolean().optional(),
  drop: z.boolean(),
  switchTo: weaponSlotSchema.nullable(),
});

export type ValidatedJoinRequest = z.infer<typeof joinSchema>;
export const buySchema = z.object({
  itemId: z.string().min(1).max(32),
});

export type ValidatedInputFrame = z.infer<typeof inputSchema>;
export type ValidatedBuyRequest = z.infer<typeof buySchema>;
export type ValidatedPing = z.infer<typeof pingSchema>;

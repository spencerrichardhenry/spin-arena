// All playtest numbers. Distances are metres, times are seconds, speeds are m/s.

export const ARENA = {
  /** Radius of the gentle floor before the rim starts to curve up. */
  floorRadius: 13,
  /** Radius where the rim reaches its top. */
  rimRadius: 18,
  rimHeight: 6,
  /** Height gain across the floor: y = floorCurve * r². */
  floorCurve: 0.012,
  gravity: 22,
  rings: 28,
  segments: 64,
};

export const TOP = {
  radius: 0.6,
  accel: 26,
  maxSpeed: 11,
  damping: 0.35,
  restitution: 0.8,
  dashSpeed: 26,
  dashTime: 0.8,
  dashCooldown: 5,
  /** Visual spin in radians per second. */
  spinRate: 38,
  spawnRadius: 10,
};

export const SHADOW = {
  /** Delay between a dash start and the shadow that replays it. */
  delay: 3,
  speed: 13,
  radius: 0.6,
  /** A shadow cannot hit the mech again within this time. */
  rehitTime: 1,
  /** Parry pulse speed multiplier for shadows, fading to 1 over flingTime. */
  flingBoost: 3,
  flingTime: 1.4,
};

export const MECH = {
  health: 12,
  plates: 3,
  radius: 1.5,
  height: 3,
  maxRadius: 14.5,
  speed: 8,
  accel: 30,
  turnRate: 3.2,
  /** Base speed lost for each leg hit, as a fraction of the start speed. */
  legHitSpeedLoss: 0.07,
  topHitImmunity: 0.75,
  /** Minimum closing speed for a top to damage the mech. */
  minHitSpeed: 4,
  topBounce: 14,

  slowPerStack: 0.1,
  slowDuration: 4,
  minSpeedFactor: 0.25,
  pushSpeed: 10,
  pushDecay: 6,
  controlLoss: 0.4,
  pushImmunity: 2,

  boostFactor: 2.6,
  boostTime: 0.35,
  boostCooldown: 4,

  jumpRange: 10,
  /** Jump range lost for each rear hit, as a fraction of the start range. */
  jumpHitLoss: 0.25,
  jumpTime: 1.1,
  jumpHeight: 5,
  jumpCooldown: 7,

  parryRadius: 6,
  parryHitLoss: 0.2,
  parryActive: 0.35,
  parryCooldown: 9,
  parryTopSpeed: 30,
};

export const MATCH = {
  countdown: 3,
  maxTops: 4,
  tickRate: 60,
  snapshotRate: 20,
  interpDelayMs: 100,
  highScores: 10,
};

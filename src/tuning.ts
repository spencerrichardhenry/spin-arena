// All playtest numbers. Distances are metres, times are seconds, speeds are m/s.

export const ARENA = {
  /** The bowl is an oval: x distances are stretched by this factor. Radii below are along z. */
  stretch: 1.5,
  /** Radius of the gentle floor before the rim starts to curve up. */
  floorRadius: 21,
  /** Radius where the rim reaches its top. The wide rim leaves room to get around the outer buildings. */
  rimRadius: 31,
  rimHeight: 8,
  /** Height gain across the floor: y = floorCurve * r². */
  floorCurve: 0.005,
  gravity: 22,
  rings: 40,
  segments: 112,
};

export const TOP = {
  radius: 0.6,
  accel: 26,
  maxSpeed: 11,
  damping: 0.35,
  restitution: 0.8,
  dashSpeed: 26,
  dashTime: 0.8,
  /** Ability cooldowns with one top. They are multiplied by the number of tops in the round. */
  dashCooldown: 5.5,
  empowerCooldown: 6,
  whirlpoolCooldown: 8,
  leapCooldown: 5.5,
  /** Empower: the next hit on the mech within this time does double damage. */
  empowerTime: 3,
  /** Whirlpool: a vortex at the top's position that pulls the mech in and slows it. */
  whirlpoolTime: 3,
  whirlpoolRadius: 6,
  whirlpoolPull: 4,
  whirlpoolSlow: 0.55,
  /** Leap: a jump the way the top moves. */
  leapSpeed: 15,
  leapUp: 10,
  /** Visual spin in radians per second. */
  spinRate: 38,
};

export const SHADOW = {
  /** Delay between a dash start and the shadow that replays it. */
  delay: 3,
  speed: 13,
  radius: 0.6,
  /** A shadow cannot hit the mech again within this time. */
  rehitTime: 1,
};

/** Open edges (Sawmill): a top below outY is out, and respawns after respawnTime. */
export const FALL = {
  outY: -6,
  respawnTime: 3,
};

/** Map hazards. */
export const HAZARD = {
  /** A belt pushes a top along it with this acceleration, up to this speed (more than TOP.maxSpeed). */
  beltTopSpeed: 18,
  beltAccel: 30,
  /** Extra speed of the mech on the ground along a belt. */
  beltMechSpeed: 5,
  sawRadius: 1.6,
  /** A saw throws a top away from the blade at this speed. */
  sawThrow: 30,
  bumperRadius: 1.4,
  /** A top leaves a bumper at this speed or more. */
  bumperKick: 24,
};

export const MECH = {
  health: 12,
  plates: 3,
  radius: 1.5,
  height: 3,
  /** Normalized oval radius the mech cannot pass (see rho in bowl.ts). */
  maxRadius: 27,
  /** Height per second the mech rises or falls to a tunnel roof it stands on. */
  climbRate: 6,
  speed: 8,
  accel: 30,
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
  parryTopSpeed: 44,
  /** After a parry, a top ignores its own movement input for this long, so it flies across the arena. */
  parryFlingTime: 0.7,
  /** A parried top is stunned for this long: no steering and no ability. */
  parryStun: 3.5,

  // Alternative abilities (see MechKit in sim/rules.ts).
  /** Blink (legs): teleport toward the mouse. Range falls with leg damage like boost. */
  blinkRange: 8,
  blinkCooldown: 6,
  /** Hover (back): hold to fly low over walls and tunnels. Fuel falls with rear hits. */
  hoverHeight: 3.2,
  hoverFuel: 2.5,
  hoverSpeedFactor: 0.75,
  hoverCooldown: 6,
  /** Shield (arms): armour all around the mech; blocks tops and deletes shadows. Time falls with front hits. */
  shieldTime: 5,
  shieldCooldown: 9,
  shieldBounce: 22,
  /** Phase (legs): a short teleport the way the mech faces, through walls and buildings. */
  phaseRange: 6,
  phaseCooldown: 7,
  /** Cloak (back): the tops cannot see the mech. */
  cloakTime: 4,
  cloakCooldown: 10,
  /** Lock (arms): freezes every top on the map. */
  lockTime: 2.5,
  lockCooldown: 10,
};

export const CAMERA = {
  /** Height and distance behind the followed player. */
  height: 21,
  back: 16,
  follow: 6,
};

export const MATCH = {
  countdown: 3,
  maxTops: 4,
  tickRate: 60,
  snapshotRate: 20,
  interpDelayMs: 100,
  highScores: 10,
};

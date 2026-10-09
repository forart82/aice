export class StatusSet {
  SlowTimer = 0;
  SlowFactor = 1;
  FreezeTimer = 0;
  StunTimer = 0;
  BurnTimer = 0;
  BurnDps = 0;
  MarkTimer = 0;
  get_slowTimer(): number {
    return this.SlowTimer;
  }
  set_slowTimer(v: number): void {
    this.SlowTimer = v;
  }
  get_slowFactor(): number {
    return this.SlowFactor;
  }
  set_slowFactor(v: number): void {
    this.SlowFactor = v;
  }
  get_freezeTimer(): number {
    return this.FreezeTimer;
  }
  set_freezeTimer(v: number): void {
    this.FreezeTimer = v;
  }
  get_stunTimer(): number {
    return this.StunTimer;
  }
  set_stunTimer(v: number): void {
    this.StunTimer = v;
  }
  get_burnTimer(): number {
    return this.BurnTimer;
  }
  set_burnTimer(v: number): void {
    this.BurnTimer = v;
  }
  get_burnDps(): number {
    return this.BurnDps;
  }
  set_burnDps(v: number): void {
    this.BurnDps = v;
  }
  get_markTimer(): number {
    return this.MarkTimer;
  }
  set_markTimer(v: number): void {
    this.MarkTimer = v;
  }
  get_isFrozen(): boolean {
    return (this.FreezeTimer > 0);
  }
  get_isStunned(): boolean {
    return (this.StunTimer > 0);
  }
  get_isBurning(): boolean {
    return (this.BurnTimer > 0);
  }
  get_isSlowed(): boolean {
    return (this.SlowTimer > 0);
  }
  get_isChilled(): boolean {
    return (this.SlowTimer > 0);
  }
  get_isMarked(): boolean {
    return (this.MarkTimer > 0);
  }
  Chill(seconds: number, factor: number): void {
    this.SlowTimer = Math.max(this.SlowTimer, seconds);
    this.SlowFactor = Math.min((((this.SlowFactor === 1) && factor) || this.SlowFactor), factor);
  }
  chill(seconds: number, factor: number): void {
    this.Chill(seconds, factor);
  }
  Freeze(seconds: number): void {
    this.FreezeTimer = Math.max(this.FreezeTimer, seconds);
  }
  freeze(seconds: number): void {
    this.Freeze(seconds);
  }
  Stun(seconds: number): void {
    this.StunTimer = Math.max(this.StunTimer, seconds);
  }
  stun(seconds: number): void {
    this.Stun(seconds);
  }
  Mark(seconds: number): void {
    this.MarkTimer = Math.max(this.MarkTimer, seconds);
  }
  mark(seconds: number): void {
    this.Mark(seconds);
  }
  Burn(seconds: number, dps: number): void {
    this.BurnTimer = Math.max(this.BurnTimer, seconds);
    this.BurnDps = Math.max(this.BurnDps, dps);
  }
  burn(seconds: number, dps: number): void {
    this.Burn(seconds, dps);
  }
  get_Immobile(): boolean {
    return ((this.FreezeTimer > 0) || (this.StunTimer > 0));
  }
  get_immobile(): boolean {
    return this.Immobile;
  }
  get_SpeedMult(): number {
    if ((this.SlowTimer > 0)) {
      return this.SlowFactor;
    } else {
      return 1;
    }
  }
  get_speedMult(): number {
    return this.SpeedMult;
  }
  get_DamageTakenMult(): number {
    if ((this.MarkTimer > 0)) {
      return 1.25;
    } else {
      return 1;
    }
  }
  get_damageTakenMult(): number {
    return this.DamageTakenMult;
  }
  Update(dt: number): number {
    if ((this.SlowTimer > 0)) {
      this.SlowTimer = (this.SlowTimer - dt);
      if ((this.SlowTimer <= 0)) {
        this.SlowTimer = 0;
        this.SlowFactor = 1;
      }
    }
    if ((this.FreezeTimer > 0)) {
      this.FreezeTimer = Math.max(0, (this.FreezeTimer - dt));
    }
    if ((this.StunTimer > 0)) {
      this.StunTimer = Math.max(0, (this.StunTimer - dt));
    }
    if ((this.MarkTimer > 0)) {
      this.MarkTimer = Math.max(0, (this.MarkTimer - dt));
    }
    let burnDamage = 0;
    if ((this.BurnTimer > 0)) {
      const step = Math.min(dt, this.BurnTimer);
      burnDamage = (this.BurnDps * step);
      this.BurnTimer = (this.BurnTimer - dt);
      if ((this.BurnTimer <= 0)) {
        this.BurnTimer = 0;
        this.BurnDps = 0;
      }
    }
    return burnDamage;
  }
  update(dt: number): number {
    return this.Update(dt);
  }
}

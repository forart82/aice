export class PlayerStats {
  MaxHp = 100;
  Speed = 1;
  DashCooldown = 3;
  BitePower = 25;
  MagnetRadius = 70;
  CritChance = 0.05;
  CritMult = 1.5;
  Armor = 0;
  MaxShield = 0;
  XpGain = 1;
  ShardGain = 1;
  ComboWindow = 1;
  Thorns = 0;
  SkillCooldown = 20;
  HpRegen = 0;
  get_maxHp(): number {
    return this.MaxHp;
  }
  set_maxHp(v: number): void {
    this.MaxHp = v;
  }
  get_speed(): number {
    return this.Speed;
  }
  set_speed(v: number): void {
    this.Speed = v;
  }
  get_dashCooldown(): number {
    return this.DashCooldown;
  }
  set_dashCooldown(v: number): void {
    this.DashCooldown = v;
  }
  get_bitePower(): number {
    return this.BitePower;
  }
  set_bitePower(v: number): void {
    this.BitePower = v;
  }
  get_magnetRadius(): number {
    return this.MagnetRadius;
  }
  set_magnetRadius(v: number): void {
    this.MagnetRadius = v;
  }
  get_critChance(): number {
    return this.CritChance;
  }
  set_critChance(v: number): void {
    this.CritChance = v;
  }
  get_critMult(): number {
    return this.CritMult;
  }
  set_critMult(v: number): void {
    this.CritMult = v;
  }
  get_armor(): number {
    return this.Armor;
  }
  set_armor(v: number): void {
    this.Armor = v;
  }
  get_maxShield(): number {
    return this.MaxShield;
  }
  set_maxShield(v: number): void {
    this.MaxShield = v;
  }
  get_xpGain(): number {
    return this.XpGain;
  }
  set_xpGain(v: number): void {
    this.XpGain = v;
  }
  get_shardGain(): number {
    return this.ShardGain;
  }
  set_shardGain(v: number): void {
    this.ShardGain = v;
  }
  get_comboWindow(): number {
    return this.ComboWindow;
  }
  set_comboWindow(v: number): void {
    this.ComboWindow = v;
  }
  get_thorns(): number {
    return this.Thorns;
  }
  set_thorns(v: number): void {
    this.Thorns = v;
  }
  get_skillCooldown(): number {
    return this.SkillCooldown;
  }
  set_skillCooldown(v: number): void {
    this.SkillCooldown = v;
  }
  get_hpRegen(): number {
    return this.HpRegen;
  }
  set_hpRegen(v: number): void {
    this.HpRegen = v;
  }
}

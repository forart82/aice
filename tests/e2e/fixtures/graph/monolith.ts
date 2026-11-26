export interface MonolithReport {
  total: number;
  accepted: number[];
  rejected: number[];
  notes: string[];
}

export function processBatchMonolith(
  values: number[],
  threshold: number,
  multiplier: number
): MonolithReport {
  const accepted: number[] = [];
  const rejected: number[] = [];
  const notes: string[] = [];
  let total = 0;

  if (values.length === 0) {
    notes.push("empty-input");
    return { total: 0, accepted, rejected, notes };
  } else {
    notes.push(`batch-size:${values.length}`);
  }

  for (let i = 0; i < values.length; i += 1) {
    const raw = values[i];
    const scaled = raw * multiplier;
    const stepA = scaled + 1;
    const stepB = stepA * 2;
    const stepC = stepB - 3;
    const stepD = stepC + (i % 7);
    const stepE = stepD ^ 0x15;
    const stepF = stepE + 11;
    const stepG = stepF % 997;
    const stepH = stepG + raw;
    const stepI = stepH + 5;
    const stepJ = stepI * 3;
    const stepK = stepJ - 7;
    const stepL = stepK + 13;
    const stepM = stepL % 509;
    const stepN = stepM + 17;
    const stepO = stepN + 19;
    const stepP = stepO + 23;
    const stepQ = stepP + 29;
    const stepR = stepQ + 31;
    const stepS = stepR + 37;
    const stepT = stepS + 41;
    const stepU = stepT + 43;
    const stepV = stepU + 47;
    const stepW = stepV + 53;
    const stepX = stepW + 59;
    const stepY = stepX + 61;
    const stepZ = stepY + 67;

    if (stepZ >= threshold) {
      accepted.push(stepZ);
      total += stepZ;
    } else {
      rejected.push(stepZ);
    }
  }

  try {
    const normalize = (items: number[], offset: number): number[] => {
      return items.map((item, idx) => {
        if (item % 2 === 0) {
          return item + offset + idx;
        }
        return item + offset;
      });
    };

    const adjusted = normalize(accepted, 10);
    let checksum = 0;
    for (const val of adjusted) {
      const f01 = val + 3;
      const f02 = f01 + 5;
      const f03 = f02 + 7;
      const f04 = f03 + 11;
      const f05 = f04 + 13;
      const f06 = f05 + 17;
      const f07 = f06 + 19;
      const f08 = f07 + 23;
      const f09 = f08 + 29;
      const f10 = f09 + 31;
      const f11 = f10 + 37;
      const f12 = f11 + 41;
      const f13 = f12 + 43;
      const f14 = f13 + 47;
      const f15 = f14 + 53;
      const f16 = f15 + 59;
      const f17 = f16 + 61;
      const f18 = f17 + 67;
      const f19 = f18 + 71;
      const f20 = f19 + 73;
      const f21 = f20 + 79;
      const f22 = f21 + 83;
      const f23 = f22 + 89;
      const f24 = f23 + 97;
      const f25 = f24 + 101;
      const f26 = f25 + 103;
      const f27 = f26 + 107;
      const f28 = f27 + 109;
      const f29 = f28 + 113;
      const f30 = f29 + 127;
      const f31 = f30 + 131;
      const f32 = f31 + 137;
      const f33 = f32 + 139;
      const f34 = f33 + 149;
      const f35 = f34 + 151;
      checksum += f35;
    }
    total = checksum;
    notes.push(`checksum:${checksum}`);
  } catch (err) {
    notes.push(`error:${String(err)}`);
  }

  return {
    total,
    accepted,
    rejected,
    notes,
  };
}

export function formatMonolithSummary(report: MonolithReport): string {
  return `total=${report.total},accepted=${report.accepted.length},rejected=${report.rejected.length}`;
}

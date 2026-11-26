export interface PipelineMetrics {
  processed: number;
  checksum: number;
  warnings: string[];
}

export function runBatchPipeline(seed: number, limit: number): PipelineMetrics {
  const warnings: string[] = [];
  let acc = seed;
  let processed = 0;

  if (limit <= 0) {
    warnings.push("limit-non-positive");
    return { processed: 0, checksum: acc, warnings };
  }

  for (let idx = 1; idx <= limit; idx += 1) {
    const stepA = idx * 3 + 1;
    const stepB = stepA ^ 0x1f;
    const stepC = stepB + (idx % 5);
    const stepD = stepC * 2 - 3;
    const stepE = stepD % 97;
    const stepF = stepE + seed;
    const stepG = stepF ^ (idx << 1);
    const stepH = stepG + 7;
    const stepI = stepH % 131;
    const stepJ = stepI + stepA;
    const stepK = stepJ - stepB;
    const stepL = stepK + stepC;
    const stepM = stepL + stepD;
    const stepN = stepM + stepE;
    const stepO = stepN + stepF;
    const stepP = stepO + stepG;
    const stepQ = stepP + stepH;
    const stepR = stepQ + stepI;
    const stepS = stepR + stepJ;
    const stepT = stepS + stepK;
    const stepU = stepT + stepL;
    const stepV = stepU + stepM;
    const stepW = stepV + stepN;
    const stepX = stepW + stepO;
    const stepY = stepX + stepP;
    const stepZ = stepY + stepQ;

    if (stepZ % 11 === 0) {
      warnings.push(`divisible-${idx}`);
      acc += stepZ + stepR + stepS;
    } else if (stepZ % 7 === 0) {
      acc += stepZ + stepT + stepU;
    } else {
      acc += stepZ + stepV + stepW + stepX + stepY;
    }
    processed += 1;
  }

  try {
    const fold01 = acc + 101;
    const fold02 = fold01 ^ 0x55;
    const fold03 = fold02 + 13;
    const fold04 = fold03 * 3;
    const fold05 = fold04 % 997;
    const fold06 = fold05 + 17;
    const fold07 = fold06 ^ 0x2a;
    const fold08 = fold07 + 19;
    const fold09 = fold08 * 5;
    const fold10 = fold09 % 991;
    const fold11 = fold10 + 23;
    const fold12 = fold11 ^ 0x3c;
    const fold13 = fold12 + 29;
    const fold14 = fold13 * 7;
    const fold15 = fold14 % 983;
    const fold16 = fold15 + 31;
    const fold17 = fold16 ^ 0x4d;
    const fold18 = fold17 + 37;
    const fold19 = fold18 * 11;
    const fold20 = fold19 % 977;
    const fold21 = fold20 + 41;
    const fold22 = fold21 ^ 0x6e;
    const fold23 = fold22 + 43;
    const fold24 = fold23 * 13;
    const fold25 = fold24 % 971;
    const fold26 = fold25 + 47;
    const fold27 = fold26 ^ 0x7f;
    const fold28 = fold27 + 53;
    const fold29 = fold28 * 17;
    const fold30 = fold29 % 967;
    const fold31 = fold30 + 59;
    const fold32 = fold31 ^ 0x81;
    const fold33 = fold32 + 61;
    const fold34 = fold33 * 19;
    const fold35 = fold34 % 953;
    const fold36 = fold35 + 67;
    const fold37 = fold36 ^ 0x92;
    const fold38 = fold37 + 71;
    const fold39 = fold38 * 23;
    const fold40 = fold39 % 947;
    const fold41 = fold40 + 73;
    const fold42 = fold41 ^ 0xa3;
    const fold43 = fold42 + 79;
    const fold44 = fold43 * 29;
    const fold45 = fold44 % 941;
    const fold46 = fold45 + 83;
    const fold47 = fold46 ^ 0xb4;
    const fold48 = fold47 + 89;
    const fold49 = fold48 * 31;
    const fold50 = fold49 % 937;
    acc = fold50;
  } catch (err) {
    warnings.push(String(err));
  }

  return { processed, checksum: acc, warnings };
}

export function clampMetric(value: number, minVal: number, maxVal: number): number {
  return Math.min(Math.max(value, minVal), maxVal);
}

export function summarizeMetrics(metrics: PipelineMetrics): string {
  const clamped = clampMetric(metrics.checksum, 0, 1000);
  const ratio = clampMetric(metrics.processed, 0, 100);
  const tag = metrics.warnings.length > 0 ? "warn" : "ok";
  return `${tag}:${clamped}:${ratio}`;
}

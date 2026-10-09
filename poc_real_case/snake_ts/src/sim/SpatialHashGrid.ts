export type SpatialLayer = "Segments" | "Enemies" | "Projectiles" | "Hazards" | "Collectibles";

export const SPATIAL_LAYER_COUNT = 5;

export const SpatialLayerMask = { None: 0, Segments: (1 === SpatialLayer.Segments), Enemies: (1 === SpatialLayer.Enemies), Projectiles: (1 === SpatialLayer.Projectiles), Hazards: (1 === SpatialLayer.Hazards), Collectibles: (1 === SpatialLayer.Collectibles), All: (1 === (SPATIAL_LAYER_COUNT - 1)) };

export type SpatialLayerMaskValue = number;

export interface SpatialQueryResult {
  id: number;
  layer: SpatialLayer;
  distSq: number;
  dist: number;
  x: number;
  y: number;
  radius: number;
}

export function SpatialQueryResult(id: number, layer: SpatialLayer, distSq: number, dist: number, x: number, y: number, radius: number): SpatialQueryResult {
  return { id, layer, distSq, dist, x, y, radius };
}

export class SpatialHashGrid {
  _cellSize: number;
  _invCellSize: number;
  _cols: number;
  _rows: number;
  _maxCells: number;
  _gridHead: Int32Array;
  _capacities: Int32Array;
  _gridNext: Int32Array[];
  _posX: Float64Array[];
  _posY: Float64Array[];
  _radius: Float64Array[];
  _itemCount: Int32Array;
  _maxRadius: Float64Array;
  constructor(cellSize: unknown = 48, maxArenaW: unknown = 3200, maxArenaH: unknown = 2400) {
    this._cellSize = cellSize;
    this._invCellSize = (1 / cellSize);
    this._cols = (Math.ceil(Math) + 2);
    this._rows = (Math.ceil(Math) + 2);
    this._maxCells = (this._cols * this._rows);
    this._gridHead = new Int32Array((SPATIAL_LAYER_COUNT * this._maxCells));
    this._gridHead.fill(-(1));
    this._capacities = new Int32Array([2048, 512, 2048, 512, 1024]);
    this._itemCount = new Int32Array(SPATIAL_LAYER_COUNT);
    this._maxRadius = new Float64Array(SPATIAL_LAYER_COUNT);
    this._gridNext = Array(SPATIAL_LAYER_COUNT);
    this._posX = Array(SPATIAL_LAYER_COUNT);
    this._posY = Array(SPATIAL_LAYER_COUNT);
    this._radius = Array(SPATIAL_LAYER_COUNT);
  }
  get_cellSize(): number {
    return this._cellSize;
  }
  get_cols(): number {
    return this._cols;
  }
  get_rows(): number {
    return this._rows;
  }
  get_maxCells(): number {
    return this._maxCells;
  }
  get_layerCount(): number {
    return SPATIAL_LAYER_COUNT;
  }
  getCapacity(layer: SpatialLayer): number {
    return (this._capacities[layer] ?? 0);
  }
  getItemCount(layer: SpatialLayer): number {
    return (this._itemCount[layer] ?? 0);
  }
  getTotalItemCount(): number {
    let total = 0;
    return total;
  }
  getMaxRadius(layer: SpatialLayer): number {
    return (this._maxRadius[layer] ?? 0);
  }
  clear(): void {
    this._gridHead.fill(-(1));
    this._itemCount.fill(0);
    this._maxRadius.fill(0);
  }
  clearLayer(layer: SpatialLayer): void {
    if (((layer < 0) || (layer >= SPATIAL_LAYER_COUNT))) {
      return;
    }
    const offset = (layer * this._maxCells);
    this._gridHead.fill(-(1), offset, (offset + this._maxCells));
    this._itemCount[layer] = 0;
    this._maxRadius[layer] = 0;
  }
  _ensureCapacity(layer: number, minCapacity: number): void {
    const current = this._capacities[layer];
    if ((minCapacity <= current)) {
      return;
    }
    const nextCap = Math.max((minCapacity * 2), (current * 2));
    this._capacities[layer] = nextCap;
    const newNext = new Int32Array(nextCap);
    newNext.set(this._gridNext[layer]);
    newNext.fill(-(1), current);
    this._gridNext[layer] = newNext;
    const newPosX = new Float64Array(nextCap);
    newPosX.set(this._posX[layer]);
    this._posX[layer] = newPosX;
    const newPosY = new Float64Array(nextCap);
    newPosY.set(this._posY[layer]);
    this._posY[layer] = newPosY;
    const newRad = new Float64Array(nextCap);
    newRad.set(this._radius[layer]);
    this._radius[layer] = newRad;
  }
  insert(x: number, y: number, id: number): void {
  }
  insert(layer: SpatialLayer, x: number, y: number, id: number, radius: number): void {
  }
  insert(arg0: number, arg1: number, arg2: number, arg3: number, arg4: number): void {
    let layer: number = undefined;
    let x: number = undefined;
    let y: number = undefined;
    let id: number = undefined;
    let radius: number = undefined;
    if ((arg3 === undefined)) {
      layer = SpatialLayer.Segments;
      x = arg0;
      y = arg1;
      id = arg2;
      radius = 0;
    } else {
      layer = arg0;
      x = arg1;
      y = arg2;
      id = arg3;
      radius = (arg4 ?? 0);
    }
    if (((((layer < 0) || (layer >= SPATIAL_LAYER_COUNT)) || (id < 0)) || !(Number.isFinite(id)))) {
      return;
    }
    if ((!(Number.isFinite(x)) || !(Number.isFinite(y)))) {
      return;
    }
    if ((!(Number.isFinite(radius)) || (radius < 0))) {
      radius = 0;
    }
    if ((id >= this._capacities[layer])) {
      this._ensureCapacity(layer, (id + 1));
    }
    this._posX[layer][id] = x;
    this._posY[layer][id] = y;
    this._radius[layer][id] = radius;
    if ((radius > this._maxRadius[layer])) {
      this._maxRadius[layer] = radius;
    }
    const invCs = this._invCellSize;
    const cols = this._cols;
    const rows = this._rows;
    let cx = Math.floor(Math);
    let cy = Math.floor(Math);
    if ((cx < 0)) {
      cx = 0;
    } else if ((cx >= cols)) {
      cx = (cols - 1);
    }
    if ((cy < 0)) {
      cy = 0;
    } else if ((cy >= rows)) {
      cy = (rows - 1);
    }
    const cellIdx = (((layer * this._maxCells) + (cy * cols)) + cx);
    this._gridNext[layer][id] = this._gridHead[cellIdx];
    this._gridHead[cellIdx] = id;
    this._itemCount[layer] = (this._itemCount[layer] + 1);
  }
  insertSegments(segs: unknown[]): void {
    const n = segs.length;
    this.clearLayer(SpatialLayer.Segments);
    if ((n === 0)) {
      return;
    }
    if ((n > this._capacities[SpatialLayer.Segments])) {
      this._ensureCapacity(SpatialLayer.Segments, n);
    }
    const invCs = this._invCellSize;
    const cols = this._cols;
    const rows = this._rows;
    const layer = SpatialLayer.Segments;
    const layerOffset = (layer * this._maxCells);
    const gridHead = this._gridHead;
    const next = this._gridNext[layer];
    const posX = this._posX[layer];
    const posY = this._posY[layer];
    const rad = this._radius[layer];
    let maxR = 0;
    this._maxRadius[SpatialLayer.Segments] = maxR;
    this._itemCount[SpatialLayer.Segments] = n;
  }
  queryRadius(x: number, y: number, radius: number, callback: (number) => boolean | void): boolean {
  }
  queryRadius(layerMask: SpatialLayerMaskValue, x: number, y: number, radius: number, callback: (number, SpatialLayer, number) => boolean | void): boolean {
  }
  queryRadius(arg0: number, arg1: number, arg2: number, arg3: int | (number) => boolean | void, arg4: (number, SpatialLayer, number) => boolean | void): boolean {
    let layerMask: number = undefined;
    let x: number = undefined;
    let y: number = undefined;
    let radius: number = undefined;
    let callback: (number, SpatialLayer, number) => boolean | void = undefined;
    if ((typeof (arg3) === "function")) {
      layerMask = SpatialLayerMask.Segments;
      x = arg0;
      y = arg1;
      radius = arg2;
      callback = arg3;
    } else {
      layerMask = arg0;
      x = arg1;
      y = arg2;
      radius = arg3;
      callback = arg4;
    }
    if ((layerMask === 0)) {
      return false;
    }
    if ((((!(Number.isFinite(x)) || !(Number.isFinite(y))) || !(Number.isFinite(radius))) || (radius < 0))) {
      return false;
    }
    const invCs = this._invCellSize;
    const cols = this._cols;
    const rows = this._rows;
    const maxCells = this._maxCells;
    const gridHead = this._gridHead;
    return false;
  }
  findFirst(layerMask: SpatialLayerMaskValue, x: number, y: number, radius: number): number {
  }
  findFirst(x: number, y: number, radius: number): number {
  }
  findFirst(arg0: number, arg1: number, arg2: number, arg3: number): number {
    let layerMask: number = undefined;
    let x: number = undefined;
    let y: number = undefined;
    let radius: number = undefined;
    if ((arg3 === undefined)) {
      layerMask = SpatialLayerMask.Segments;
      x = arg0;
      y = arg1;
      radius = arg2;
    } else {
      layerMask = arg0;
      x = arg1;
      y = arg2;
      radius = arg3;
    }
    if ((layerMask === 0)) {
      return -(1);
    }
    if ((((!(Number.isFinite(x)) || !(Number.isFinite(y))) || !(Number.isFinite(radius))) || (radius < 0))) {
      return -(1);
    }
    const invCs = this._invCellSize;
    const cols = this._cols;
    const rows = this._rows;
    const maxCells = this._maxCells;
    const gridHead = this._gridHead;
    return -(1);
  }
  findFirstSegment(x: number, y: number, radius: number, minIndex: unknown = 0): number {
    if ((((!(Number.isFinite(x)) || !(Number.isFinite(y))) || !(Number.isFinite(radius))) || (radius < 0))) {
      return -(1);
    }
    const invCs = this._invCellSize;
    const cols = this._cols;
    const rows = this._rows;
    const maxCells = this._maxCells;
    const gridHead = this._gridHead;
    const l = SpatialLayer.Segments;
    const layerMaxRad = this._maxRadius[l];
    const searchR = (radius + layerMaxRad);
    let minCx = Math.floor(Math);
    if ((minCx < 0)) {
      minCx = 0;
    }
    let maxCx = Math.floor(Math);
    if ((maxCx >= cols)) {
      maxCx = (cols - 1);
    }
    let minCy = Math.floor(Math);
    if ((minCy < 0)) {
      minCy = 0;
    }
    let maxCy = Math.floor(Math);
    if ((maxCy >= rows)) {
      maxCy = (rows - 1);
    }
    if (((minCx > maxCx) || (minCy > maxCy))) {
      return -(1);
    }
    const layerOffset = (l * maxCells);
    const next = this._gridNext[l];
    const posX = this._posX[l];
    const posY = this._posY[l];
    const rad = this._radius[l];
    const maxLayerRSq = (searchR * searchR);
    return -(1);
  }
  queryRadiusBuffer(layerMask: SpatialLayerMaskValue, x: number, y: number, radius: number, outBuffer: Int32Array, maxHits: number = outBuffer.length): number {
    if (((layerMask === 0) || (maxHits <= 0))) {
      return 0;
    }
    if ((((!(Number.isFinite(x)) || !(Number.isFinite(y))) || !(Number.isFinite(radius))) || (radius < 0))) {
      return 0;
    }
    let hitCount = 0;
    const invCs = this._invCellSize;
    const cols = this._cols;
    const rows = this._rows;
    const maxCells = this._maxCells;
    const gridHead = this._gridHead;
    return hitCount;
  }
  queryNearest(layerMask: SpatialLayerMaskValue, x: number, y: number, maxRadius: number): SpatialQueryResult | null {
  }
  queryNearest(layerMask: SpatialLayerMaskValue, x: number, y: number, maxRadius: number, outResult: SpatialQueryResult): boolean {
  }
  queryNearest(layerMask: SpatialLayerMaskValue, x: number, y: number, maxRadius: unknown = Infinity, outResult: SpatialQueryResult): unknown | bool {
    if ((((((layerMask === 0) || !(Number.isFinite(x))) || !(Number.isFinite(y))) || !(Number.isFinite(maxRadius))) || (maxRadius <= 0))) {
      if ((outResult !== null)) {
        return false;
      } else {
        return null;
      }
    }
    const cs = this._cellSize;
    const invCs = this._invCellSize;
    const cols = this._cols;
    const rows = this._rows;
    const maxCells = this._maxCells;
    const gridHead = this._gridHead;
    let bestDistSq = (maxRadius * maxRadius);
    let bestDist = maxRadius;
    let bestId = -(1);
    let bestLayer = SpatialLayer.Segments;
    let bestX = 0;
    let bestY = 0;
    let bestRadius = 0;
    const centerCx = Math.floor(Math);
    const centerCy = Math.floor(Math);
    if (((((centerCx >= 0) && (centerCx < cols)) && (centerCy >= 0)) && (centerCy < rows))) {
      null;
    }
    let minCx = Math.floor(Math);
    if ((minCx < 0)) {
      minCx = 0;
    }
    let maxCx = Math.floor(Math);
    if ((maxCx >= cols)) {
      maxCx = (cols - 1);
    }
    let minCy = Math.floor(Math);
    if ((minCy < 0)) {
      minCy = 0;
    }
    let maxCy = Math.floor(Math);
    if ((maxCy >= rows)) {
      maxCy = (rows - 1);
    }
    if (((minCx > maxCx) || (minCy > maxCy))) {
      if ((bestId === -(1))) {
        if ((outResult !== null)) {
          return false;
        } else {
          return null;
        }
      }
    } else {
      null;
    }
    if ((bestId === -(1))) {
      if ((outResult !== null)) {
        return false;
      } else {
        return null;
      }
    }
    if ((outResult !== null)) {
      outResult.id = bestId;
      outResult.layer = bestLayer;
      outResult.distSq = bestDistSq;
      outResult.dist = bestDist;
      outResult.x = bestX;
      outResult.y = bestY;
      outResult.radius = bestRadius;
      return true;
    }
    return { id: bestId, layer: bestLayer, distSq: bestDistSq, dist: bestDist, x: bestX, y: bestY, radius: bestRadius };
  }
  queryRay(layerMask: SpatialLayerMaskValue, startX: number, startY: number, dirX: number, dirY: number, maxDistance: number, callback: (number, SpatialLayer, number, number, number) => boolean | void): boolean {
    if ((((layerMask === 0) || !(Number.isFinite(maxDistance))) || (maxDistance <= 0))) {
      return false;
    }
    if ((((!(Number.isFinite(startX)) || !(Number.isFinite(startY))) || !(Number.isFinite(dirX))) || !(Number.isFinite(dirY)))) {
      return false;
    }
    const len = Math.hypot(dirX, dirY);
    if ((!(Number.isFinite(len)) || (len <= 0.000001))) {
      return false;
    }
    const dx = (dirX / len);
    const dy = (dirY / len);
    const cs = this._cellSize;
    const invCs = this._invCellSize;
    const cols = this._cols;
    const rows = this._rows;
    const maxCells = this._maxCells;
    const gridHead = this._gridHead;
    const gridW = (cols * cs);
    const gridH = (rows * cs);
    if ((((startX < 0) && (dx <= 0)) || ((startX >= gridW) && (dx >= 0)))) {
      return false;
    }
    if ((((startY < 0) && (dy <= 0)) || ((startY >= gridH) && (dy >= 0)))) {
      return false;
    }
    let cx = Math.floor(Math);
    let cy = Math.floor(Math);
    const stepX = ((((dx > 0) && 1) || ((dx < 0) && -(1))) || 0);
    const stepY = ((((dy > 0) && 1) || ((dy < 0) && -(1))) || 0);
    let tMaxX = ((((dx > 0) && ((cx + (1 * cs)) - (startX / dx))) || ((dx < 0) && ((cx * cs) - (startX / dx)))) || Infinity);
    let tMaxY = ((((dy > 0) && ((cy + (1 * cs)) - (startY / dy))) || ((dy < 0) && ((cy * cs) - (startY / dy)))) || Infinity);
    const tDeltaX = (((dx !== 0) && Math.abs((cs / dx))) || Infinity);
    const tDeltaY = (((dy !== 0) && Math.abs((cs / dy))) || Infinity);
    let tCurrent = 0;
    while ((tCurrent <= maxDistance)) {
      if (((((cx >= 0) && (cx < cols)) && (cy >= 0)) && (cy < rows))) {
        null;
      }
      if ((tMaxX < tMaxY)) {
        tCurrent = tMaxX;
        tMaxX = (tMaxX + tDeltaX);
        cx = (cx + stepX);
      } else {
        tCurrent = tMaxY;
        tMaxY = (tMaxY + tDeltaY);
        cy = (cy + stepY);
      }
      if ((((stepX > 0) && (cx >= cols)) || ((stepX < 0) && (cx < 0)))) {
        null;
      }
      if ((((stepY > 0) && (cy >= rows)) || ((stepY < 0) && (cy < 0)))) {
        null;
      }
    }
    return false;
  }
}

export const SegmentSpatialGrid = SpatialHashGrid;

export type SegmentSpatialGrid = SpatialHashGrid;

/**
 * Headless Mock DOM Environment for Testing UI Components in Vitest / Node.js
 */

export class MockClassList {
  private _classes: Set<string> = new Set();
  constructor(private _el: MockElement) {}

  public add(...names: string[]): void {
    for (const name of names) {
      if (name) this._classes.add(name);
    }
    this._sync();
  }

  public remove(...names: string[]): void {
    for (const name of names) {
      this._classes.delete(name);
    }
    this._sync();
  }

  public toggle(name: string, force?: boolean): boolean {
    const has = this._classes.has(name);
    const next = force !== undefined ? force : !has;
    if (next) this._classes.add(name);
    else this._classes.delete(name);
    this._sync();
    return next;
  }

  public contains(name: string): boolean {
    return this._classes.has(name);
  }

  public _fromClassName(cn: string): void {
    this._classes.clear();
    const parts = (cn || '').split(/\s+/).filter(Boolean);
    for (const p of parts) this._classes.add(p);
  }

  private _sync(): void {
    this._el._classNameDirect = Array.from(this._classes).join(' ');
  }
}

/**
 * Headless Mock WebGL Rendering Context for deterministic testing in Vitest / Node.js
 */
export function createMockWebGLContext(canvas?: any): any {
  const shaders: any[] = [];
  const programs: any[] = [];
  const buffers: any[] = [];
  const textures: any[] = [];
  const drawCalls: Array<{ mode: number; first?: number; count?: number }> = [];

  const targetCanvas = canvas || {
    width: 1280,
    height: 720,
    clientWidth: 1280,
    clientHeight: 720,
  };

  const gl: any = {
    canvas: targetCanvas,
    drawingBufferWidth: targetCanvas.clientWidth || targetCanvas.width || 1280,
    drawingBufferHeight: targetCanvas.clientHeight || targetCanvas.height || 720,

    // WebGL Buffer & Clear Bits
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    STENCIL_BUFFER_BIT: 0x0400,

    // Primitive Drawing Modes
    TRIANGLES: 0x0004,
    TRIANGLE_STRIP: 0x0005,
    TRIANGLE_FAN: 0x0006,
    LINES: 0x0001,
    LINE_STRIP: 0x0003,
    LINE_LOOP: 0x0002,
    POINTS: 0x0000,

    // Buffers & Targets
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    DYNAMIC_DRAW: 0x88e8,
    STATIC_DRAW: 0x88e4,
    STREAM_DRAW: 0x88e0,

    // Data Types
    FLOAT: 0x1406,
    UNSIGNED_SHORT: 0x1403,
    UNSIGNED_INT: 0x1405,
    UNSIGNED_BYTE: 0x1401,
    BYTE: 0x1400,
    SHORT: 0x1402,

    // Shaders
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    VALIDATE_STATUS: 0x8b83,

    // Blending & State
    BLEND: 0x0be2,
    DEPTH_TEST: 0x0b71,
    CULL_FACE: 0x0b44,
    SCISSOR_TEST: 0x0c11,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    ONE: 1,
    ZERO: 0,
    SRC_COLOR: 0x0300,
    ONE_MINUS_SRC_COLOR: 0x0301,
    DST_ALPHA: 0x0304,
    ONE_MINUS_DST_ALPHA: 0x0305,
    DST_COLOR: 0x0306,
    ONE_MINUS_DST_COLOR: 0x0307,
    FUNC_ADD: 0x8006,
    FUNC_SUBTRACT: 0x800a,
    FUNC_REVERSE_SUBTRACT: 0x800b,

    // Textures
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE2: 0x84c2,
    TEXTURE3: 0x84c3,
    LINEAR: 0x2601,
    NEAREST: 0x2600,
    NEAREST_MIPMAP_NEAREST: 0x2700,
    LINEAR_MIPMAP_NEAREST: 0x2701,
    NEAREST_MIPMAP_LINEAR: 0x2702,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    CLAMP_TO_EDGE: 0x812f,
    REPEAT: 0x2901,
    MIRRORED_REPEAT: 0x8370,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    RGBA: 0x1908,
    RGB: 0x1907,
    ALPHA: 0x1906,
    LUMINANCE: 0x1909,
    LUMINANCE_ALPHA: 0x190a,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    MAX_TEXTURE_SIZE: 0x0d33,

    // Tracking lists for test introspection
    _drawCalls: drawCalls,
    drawCalls: drawCalls,
    drawArraysCalls: drawCalls,
    _shaders: shaders,
    _programs: programs,
    _buffers: buffers,
    _textures: textures,

    viewport: (_x: number, _y: number, _w: number, _h: number) => {},
    scissor: (_x: number, _y: number, _w: number, _h: number) => {},
    clearColor: (_r: number, _g: number, _b: number, _a: number) => {},
    clear: (_mask: number) => {},
    enable: (_cap: number) => {},
    disable: (_cap: number) => {},
    blendFunc: (_s: number, _d: number) => {},
    blendFuncSeparate: (_srcRgb: number, _dstRgb: number, _srcA: number, _dstA: number) => {},
    blendEquation: (_eq: number) => {},
    blendEquationSeparate: (_rgb: number, _a: number) => {},
    colorMask: (_r: boolean, _g: boolean, _b: boolean, _a: boolean) => {},
    depthMask: (_flag: boolean) => {},

    createBuffer: () => {
      const buf = { id: buffers.length + 1, data: null };
      buffers.push(buf);
      return buf;
    },
    bindBuffer: (_target: number, _buf: any) => {},
    bufferData: (_target: number, _data: any, _usage: number) => {},
    bufferSubData: (_target: number, _offset: number, _data: any) => {},
    deleteBuffer: (_buf: any) => {},

    createShader: (type: number) => {
      const shader = { id: shaders.length + 1, type, source: '' };
      shaders.push(shader);
      return shader;
    },
    shaderSource: (s: any, src: string) => {
      if (s) s.source = src;
    },
    compileShader: (_s: any) => {},
    getShaderParameter: (_s: any, _pname: number) => true,
    getShaderInfoLog: (_s: any) => '',
    deleteShader: (_s: any) => {},

    createProgram: () => {
      const prog = { id: programs.length + 1, attached: [] as any[] };
      programs.push(prog);
      return prog;
    },
    attachShader: (p: any, s: any) => {
      if (p && p.attached) p.attached.push(s);
    },
    linkProgram: (_p: any) => {},
    getProgramParameter: (_p: any, _pname: number) => true,
    getProgramInfoLog: (_p: any) => '',
    useProgram: (_p: any) => {},
    deleteProgram: (_p: any) => {},

    getAttribLocation: (_prog: any, name: string) => {
      if (name === 'a_position') return 0;
      if (name === 'a_color') return 1;
      if (name === 'a_uv') return 2;
      if (name === 'a_params' || name === 'a_type') return 3;
      return 0;
    },
    getUniformLocation: (_prog: any, name: string) => ({ name }),
    enableVertexAttribArray: (_index: number) => {},
    disableVertexAttribArray: (_index: number) => {},
    vertexAttribPointer: (_index: number, _size: number, _type: number, _norm: boolean, _stride: number, _offset: number) => {},

    uniform1f: (_loc: any, _x: number) => {},
    uniform2f: (_loc: any, _x: number, _y: number) => {},
    uniform3f: (_loc: any, _x: number, _y: number, _z: number) => {},
    uniform4f: (_loc: any, _x: number, _y: number, _z: number, _w: number) => {},
    uniform1i: (_loc: any, _x: number) => {},
    uniform2i: (_loc: any, _x: number, _y: number) => {},
    uniform3i: (_loc: any, _x: number, _y: number, _z: number) => {},
    uniform4i: (_loc: any, _x: number, _y: number, _z: number, _w: number) => {},
    uniform1fv: (_loc: any, _val: any) => {},
    uniform2fv: (_loc: any, _val: any) => {},
    uniform3fv: (_loc: any, _val: any) => {},
    uniform4fv: (_loc: any, _val: any) => {},
    uniform1iv: (_loc: any, _val: any) => {},
    uniform2iv: (_loc: any, _val: any) => {},
    uniform3iv: (_loc: any, _val: any) => {},
    uniform4iv: (_loc: any, _val: any) => {},
    uniformMatrix2fv: (_loc: any, _t: boolean, _val: any) => {},
    uniformMatrix3fv: (_loc: any, _t: boolean, _val: any) => {},
    uniformMatrix4fv: (_loc: any, _t: boolean, _val: any) => {},

    createTexture: () => {
      const tex = { id: textures.length + 1 };
      textures.push(tex);
      return tex;
    },
    bindTexture: (_target: number, _tex: any) => {},
    deleteTexture: (_tex: any) => {},
    texParameteri: (_target: number, _pname: number, _param: number) => {},
    texParameterf: (_target: number, _pname: number, _param: number) => {},
    texImage2D: (..._args: any[]) => {},
    texSubImage2D: (..._args: any[]) => {},
    activeTexture: (_unit: number) => {},
    generateMipmap: (_target: number) => {},
    pixelStorei: (_pname: number, _param: any) => {},

    drawArrays: (mode: number, first: number, count: number) => {
      drawCalls.push({ mode, first, count });
    },
    drawElements: (mode: number, count: number, _type: number, _offset: number) => {
      drawCalls.push({ mode, count });
    },

    createVertexArray: () => ({ id: 1 }),
    bindVertexArray: (_vao: any) => {},
    deleteVertexArray: (_vao: any) => {},
    createVertexArrayOES: () => ({ id: 1 }),
    bindVertexArrayOES: (_vao: any) => {},
    deleteVertexArrayOES: (_vao: any) => {},

    getExtension: (name: string) => {
      if (name === 'OES_vertex_array_object') {
        return {
          createVertexArrayOES: () => ({ id: 1 }),
          bindVertexArrayOES: () => {},
          deleteVertexArrayOES: () => {},
        };
      }
      if (name === 'WEBGL_lose_context') {
        return {
          loseContext: () => {},
          restoreContext: () => {},
        };
      }
      return {};
    },

    getParameter: (pname: number) => {
      if (pname === 0x0d33) return 4096; // MAX_TEXTURE_SIZE
      if (pname === 0x8872) return 16;   // MAX_TEXTURE_IMAGE_UNITS
      if (pname === 0x8869) return 16;   // MAX_VERTEX_ATTRIBS
      return 0;
    },

    getError: () => 0,
    isContextLost: () => false,
    finish: () => {},
    flush: () => {},
  };

  return gl;
}

export class MockElement {
  public tagName: string;
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public classList: MockClassList;
  public style: Record<string, string> & { setProperty?: (k: string, v: string) => void };
  public listeners: Map<string, Function[]> = new Map();

  public _classNameDirect: string = '';
  public _text: string = '';
  public id: string = '';
  public disabled: boolean = false;
  public value: string = '';
  public checked: boolean = false;
  public title: string = '';
  public type: string = '';
  public min: string = '0';
  public max: string = '1';
  public step: string = '0.1';
  public clientWidth: number = 800;
  public clientHeight: number = 600;
  public scrollTop: number = 0;
  public dataset: Record<string, string>;

  constructor(tagName: string = 'DIV') {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList(this);
    this.style = {
      setProperty: (k: string, v: string) => {
        (this.style as any)[k] = v;
      },
    } as any;
    this.dataset = new Proxy({} as Record<string, string>, {
      set: (target, prop: string | symbol, val: any) => {
        if (typeof prop !== 'string') return true;
        target[prop] = `${val}`;
        const attrName = 'data-' + prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
        this.attributes.set(attrName.toLowerCase(), `${val}`);
        return true;
      },
      get: (target, prop: string | symbol) => {
        if (typeof prop !== 'string') return (target as any)[prop];
        if (prop in target) return target[prop];
        const attrName = 'data-' + prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
        return this.attributes.get(attrName.toLowerCase());
      }
    });
  }

  public get className(): string {
    return this._classNameDirect;
  }

  public set className(val: string) {
    this._classNameDirect = val;
    this.classList._fromClassName(val);
  }

  public get src(): string {
    return this.attributes.get('src') || '';
  }

  public set src(val: string) {
    this.attributes.set('src', `${val}`);
  }

  public attributes: Map<string, string> = new Map();

  public getAttributeNames(): string[] {
    return Array.from(this.attributes.keys());
  }

  public setAttribute(name: string, value: string): void {
    const key = name.toLowerCase();
    this.attributes.set(key, `${value}`);
    if (key.startsWith('data-')) {
      const prop = key.slice(5).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
      this.dataset[prop] = `${value}`;
    }
    if (key === 'id') this.id = `${value}`;
    if (key === 'class') this.className = `${value}`;
    if (key === 'title') this.title = `${value}`;
    if (key === 'type') this.type = `${value}`;
    if (key === 'value') this.value = `${value}`;
    if (key === 'alt') (this as any).alt = `${value}`;
    if (key === 'style') {
      const decls = `${value}`.split(';');
      for (const decl of decls) {
        const colonIdx = decl.indexOf(':');
        if (colonIdx > 0) {
          const prop = decl.slice(0, colonIdx).trim();
          const val = decl.slice(colonIdx + 1).trim();
          if (prop && val) {
            (this.style as any)[prop] = val;
            const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            (this.style as any)[camelProp] = val;
          }
        }
      }
    }
  }

  public getAttribute(name: string): string | null {
    const key = name.toLowerCase();
    if (this.attributes.has(key)) return this.attributes.get(key)!;
    if (key === 'id') return this.id || null;
    if (key === 'class') return this.className || null;
    if (key === 'title') return this.title || null;
    if (key === 'type') return this.type || null;
    if (key === 'value') return this.value || null;
    if (key === 'src') return (this as any).src || null;
    if (key === 'alt') return (this as any).alt || null;
    return null;
  }

  public hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name.toLowerCase());
  }

  public appendChild(child: MockElement): MockElement {
    if (!child) return child;
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  public insertBefore(newChild: MockElement, refChild: MockElement | null): MockElement {
    if (!newChild) return newChild;
    if (!refChild) return this.appendChild(newChild);
    if (newChild.parentElement) {
      newChild.parentElement.removeChild(newChild);
    }
    const idx = this.children.indexOf(refChild);
    if (idx < 0) {
      return this.appendChild(newChild);
    }
    newChild.parentElement = this;
    this.children.splice(idx, 0, newChild);
    return newChild;
  }

  public removeChild(child: MockElement): MockElement {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  public addEventListener(event: string, fn: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(fn);
  }

  public removeEventListener(event: string, fn: Function): void {
    const list = this.listeners.get(event);
    if (list) {
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  public dispatchEvent(event: any): boolean {
    const type = typeof event === 'string' ? event : event?.type;
    const list = this.listeners.get(type);
    if (list) {
      for (const fn of [...list]) {
        fn.call(this, event);
      }
    }
    return true;
  }

  public click(): void {
    this.dispatchEvent({
      type: 'click',
      target: this,
      clientX: 100,
      clientY: 100,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  }

  public select(): void {}
  public focus(): void {}
  public blur(): void {}
  public scrollIntoView(_arg?: any): void {}
  public scrollTo(_arg?: any): void {}

  public getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    return {
      left: 0,
      top: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
      width: this.clientWidth,
      height: this.clientHeight,
    };
  }

  public getContext(type: string): any {
    if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
      return createMockWebGLContext(this);
    }
    if (type === '2d') {
      console.warn('Warning: Canvas2D (type="2d") is strictly forbidden in Ouroboros pure WebGL engine! Use WebGLGameRenderer/GLBatch instead.');
      return null;
    }
    return null;
  }

  public get textContent(): string {
    if (this.children.length === 0) return this._text;
    const childTexts = this.children.map((c) => c.textContent).filter(Boolean);
    if (this._text) return (this._text + ' ' + childTexts.join(' ')).trim();
    return childTexts.join(' ');
  }

  public set textContent(val: string) {
    this._text = val;
    this.children = [];
  }

  public get innerHTML(): string {
    return this._text;
  }

  public set innerHTML(html: string) {
    this.children = [];
    this._text = '';
    this._parseHtml(html);
  }

  private _parseHtml(html: string): void {
    // Robust stack-based HTML tag parser handling nested elements and text nodes
    const tagTokenRegex = /<!--[\s\S]*?-->|<(?:\/([a-zA-Z0-9\-]+)|([a-zA-Z0-9\-]+)([^>]*?)(\/)?\s*)>|([^<]+)/g;
    let match: RegExpExecArray | null;
    const stack: { el: MockElement; tag: string }[] = [{ el: this, tag: 'root' }];

    while ((match = tagTokenRegex.exec(html)) !== null) {
      if (match[0].startsWith('<!--')) continue;

      const textChunk = match[5];
      if (textChunk !== undefined) {
        const trimmed = textChunk.replace(/&nbsp;/g, ' ').trim();
        if (trimmed) {
          const current = stack[stack.length - 1]!.el;
          current._text = (current._text ? current._text + ' ' : '') + trimmed;
        }
        continue;
      }

      const isClosing = !!match[1];
      const closeTag = (match[1] || '').toLowerCase();
      const openTag = (match[2] || '').toLowerCase();
      const attrs = match[3] || '';
      const isSelfClosing = !!match[4] || openTag === 'input' || openTag === 'br' || openTag === 'hr' || openTag === 'img';

      if (isClosing) {
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i]!.tag === closeTag) {
            stack.length = i;
            break;
          }
        }
      } else if (openTag) {
        const el = new MockElement(openTag);
        const attrRegex = /([a-zA-Z0-9\-_:]+)(?:=["']([^"']*)["'])?/g;
        let attrMatch: RegExpExecArray | null;
        while ((attrMatch = attrRegex.exec(attrs)) !== null) {
          const attrName = attrMatch[1];
          const attrVal = attrMatch[2] !== undefined ? attrMatch[2] : '';
          if (attrName) {
            el.setAttribute(attrName, attrVal);
          }
        }

        if (attrs.includes('disabled')) el.disabled = true;
        if (attrs.includes('checked')) el.checked = true;

        const parent = stack[stack.length - 1]!.el;
        parent.appendChild(el);

        if (!isSelfClosing) {
          stack.push({ el, tag: openTag });
        }
      }
    }
  }

  public contains(other: MockElement | null): boolean {
    if (!other) return false;
    let curr: MockElement | null = other;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
  }

  public closest(selector: string): MockElement | null {
    let current: MockElement | null = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  public matches(selector: string): boolean {
    const sel = selector.trim();
    if (sel.startsWith('.')) {
      return this.classList.contains(sel.slice(1));
    }
    if (sel.startsWith('#')) {
      return this.id === sel.slice(1);
    }
    if (sel.startsWith('[') && sel.endsWith(']')) {
      const inner = sel.slice(1, -1);
      const eqIdx = inner.indexOf('=');
      if (eqIdx !== -1) {
        const attrName = inner.slice(0, eqIdx).trim();
        let attrVal = inner.slice(eqIdx + 1).trim();
        if ((attrVal.startsWith('"') && attrVal.endsWith('"')) || (attrVal.startsWith("'") && attrVal.endsWith("'"))) {
          attrVal = attrVal.slice(1, -1);
        }
        return this.getAttribute(attrName) === attrVal;
      }
      return this.hasAttribute(inner.trim());
    }
    return this.tagName.toLowerCase() === sel.toLowerCase();
  }

  public querySelector(selector: string): MockElement | null {
    const results = this.querySelectorAll(selector);
    return results.length > 0 ? results[0]! : null;
  }

  public querySelectorAll(selector: string): MockElement[] {
    const cleanSel = selector.trim();
    if (cleanSel.includes(',')) {
      const subSelectors = cleanSel.split(',').map((s) => s.trim()).filter(Boolean);
      const results: MockElement[] = [];
      for (const sub of subSelectors) {
        for (const el of this.querySelectorAll(sub)) {
          if (!results.includes(el)) results.push(el);
        }
      }
      return results;
    }
    const parts = cleanSel.split(/\s+/).filter(Boolean);

    if (parts.length > 1) {
      let currentMatches: MockElement[] = this.querySelectorAll(parts[0]!);
      for (let i = 1; i < parts.length; i++) {
        const nextPart = parts[i]!;
        const nextMatches: MockElement[] = [];
        for (const parent of currentMatches) {
          const subMatches = parent.querySelectorAll(nextPart);
          for (const sub of subMatches) {
            if (!nextMatches.includes(sub)) nextMatches.push(sub);
          }
        }
        currentMatches = nextMatches;
      }
      return currentMatches;
    }

    const results: MockElement[] = [];
    const token = parts[0] || '';

    const matches = (el: MockElement): boolean => {
      if (el.matches(token)) return true;
      let t = token;
      const tagMatch = t.match(/^([a-zA-Z0-9-]+)/);
      if (tagMatch) {
        if (el.tagName.toLowerCase() !== tagMatch[1]!.toLowerCase()) return false;
        t = t.slice(tagMatch[1]!.length);
      }
      if (!t) return true;

      const classMatches = t.match(/\.([a-zA-Z0-9_-]+)/g);
      if (classMatches) {
        for (const cm of classMatches) {
          const cls = cm.slice(1);
          if (!el.classList.contains(cls)) return false;
        }
      }

      const idMatch = t.match(/#([a-zA-Z0-9_-]+)/);
      if (idMatch && (el as any).id !== idMatch[1]) return false;

      const attrMatch = t.match(/\[([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?\]/);
      if (attrMatch) {
        const attrName = attrMatch[1]!;
        const attrVal = attrMatch[2];
        if (attrVal !== undefined) {
          if (el.getAttribute(attrName) !== attrVal) return false;
        } else {
          if (!el.hasAttribute(attrName)) return false;
        }
      }

      return true;
    };

    const traverse = (node: MockElement) => {
      for (const child of node.children) {
        if (matches(child)) {
          results.push(child);
        }
        traverse(child);
      }
    };

    traverse(this);
    return results;
  }
}

export class MockStorage {
  private store: Map<string, string> = new Map();

  public getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  public setItem(key: string, val: string): void {
    this.store.set(key, String(val));
  }

  public removeItem(key: string): void {
    this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }
}

export function setupMockDom(): () => void {
  const originalDocument = (globalThis as any).document;
  const originalWindow = (globalThis as any).window;
  const originalLocalStorage = (globalThis as any).localStorage;
  const originalNavigator = (globalThis as any).navigator;

  const mockLocalStorage = new MockStorage();
  const documentElement = new MockElement('html');
  const body = new MockElement('body');
  documentElement.appendChild(body);

  const docListeners = new Map<string, Function[]>();
  const mockDoc = {
    documentElement,
    body,
    readyState: 'complete',
    createElement: (tag: string) => new MockElement(tag),
    getElementById: (id: string) => documentElement.querySelector('#' + id),
    querySelector: (sel: string) => documentElement.querySelector(sel),
    querySelectorAll: (sel: string) => documentElement.querySelectorAll(sel),
    addEventListener: (event: string, fn: Function) => {
      if (!docListeners.has(event)) docListeners.set(event, []);
      docListeners.get(event)!.push(fn);
    },
    removeEventListener: (event: string, fn: Function) => {
      const list = docListeners.get(event);
      if (list) {
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      }
    },
    dispatchEvent: (event: any) => {
      const list = docListeners.get(event.type);
      if (list) {
        for (const fn of [...list]) fn(event);
      }
      return true;
    },
  };

  const winListeners = new Map<string, Function[]>();
  const mockWin: any = {
    document: mockDoc,
    localStorage: mockLocalStorage,
    location: { origin: 'http://localhost:3000' },
    innerWidth: 1280,
    innerHeight: 720,
    getComputedStyle: (_el: any) => ({
      getPropertyValue: (_name: string) => '',
    }),
    setTimeout: (fn: Function, ms: number = 0) => setTimeout(fn, ms),
    clearTimeout: (id: any) => clearTimeout(id),
    open: (_url: string, _target?: string, _features?: string) => ({}),
    addEventListener: (event: string, fn: Function) => {
      if (!winListeners.has(event)) winListeners.set(event, []);
      winListeners.get(event)!.push(fn);
    },
    removeEventListener: (event: string, fn: Function) => {
      const list = winListeners.get(event);
      if (list) {
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      }
    },
    dispatchEvent: (event: any) => {
      const list = winListeners.get(event.type);
      if (list) {
        for (const fn of [...list]) fn(event);
      }
      return true;
    },
    requestAnimationFrame: (fn: Function) => setTimeout(fn, 16),
    cancelAnimationFrame: (id: any) => clearTimeout(id),
  };

  const defineGlobal = (key: string, value: any) => {
    try {
      Object.defineProperty(globalThis, key, {
        value,
        writable: true,
        configurable: true,
      });
    } catch {
      (globalThis as any)[key] = value;
    }
    if (typeof global !== 'undefined' && global !== globalThis) {
      try {
        (global as any)[key] = value;
      } catch {}
    }
  };

  defineGlobal('document', mockDoc);
  defineGlobal('window', mockWin);
  defineGlobal('getComputedStyle', mockWin.getComputedStyle);
  defineGlobal('requestAnimationFrame', mockWin.requestAnimationFrame);
  defineGlobal('cancelAnimationFrame', mockWin.cancelAnimationFrame);
  defineGlobal('localStorage', mockLocalStorage);
  defineGlobal('navigator', {
    clipboard: {
      writeText: async (_text: string) => {},
    },
  });
  defineGlobal('HTMLElement', MockElement);
  defineGlobal('HTMLButtonElement', MockElement);
  defineGlobal('HTMLInputElement', MockElement);
  defineGlobal('HTMLSelectElement', MockElement);
  defineGlobal('HTMLCanvasElement', MockElement);

  class MockEvent {
    public type: string;
    public defaultPrevented: boolean = false;
    constructor(type: string, _dict?: any) {
      this.type = type;
    }
    public preventDefault(): void {
      this.defaultPrevented = true;
    }
    public stopPropagation(): void {}
  }

  class MockKeyboardEvent extends MockEvent {
    public code: string;
    public key: string;
    constructor(type: string, dict: any = {}) {
      super(type, dict);
      this.code = dict.code || '';
      this.key = dict.key || '';
    }
  }

  class MockPointerEvent extends MockEvent {
    public clientX: number;
    public clientY: number;
    constructor(type: string, dict: any = {}) {
      super(type, dict);
      this.clientX = dict.clientX || 0;
      this.clientY = dict.clientY || 0;
    }
  }

  defineGlobal('Event', MockEvent);
  defineGlobal('KeyboardEvent', MockKeyboardEvent);
  defineGlobal('PointerEvent', MockPointerEvent);
  defineGlobal('MouseEvent', MockPointerEvent);

  return () => {
    defineGlobal('document', originalDocument);
    defineGlobal('window', originalWindow);
    defineGlobal('localStorage', originalLocalStorage);
    defineGlobal('navigator', originalNavigator);
  };
}

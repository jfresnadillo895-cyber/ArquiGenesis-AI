/* <comprender-mark> — marca viva de Comprender (ARQUIGÉNESIS)
 * Web component sin dependencias. Uso:
 *   <script src="comprender-mark.js"></script>
 *   <comprender-mark size="96"></comprender-mark>            // marca por defecto
 *   <comprender-mark size="120" autoplay></comprender-mark>
 *
 * Atributos
 *   phase    origin | spiral_deployment | mirror_exchange | organization | return | dna_reorganization
 *   variant  full (default) | compact   — compact = media vuelta, trazo grueso, para <40px
 *   tone     color (default) | mono | inverse
 *   size     px (default 96)
 *   autoplay recorre las seis fases en bucle
 *   speed    ms por fase en autoplay (default 2200)
 */
(function () {
  const PHASES = ['origin', 'spiral_deployment', 'mirror_exchange', 'organization', 'return', 'dna_reorganization'];

  function spiral({ turns = 1.05, dir = 1, r0 = 9, r1 = 48, start = -Math.PI / 2, steps = 160, reverse = false }) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = dir * (t * turns * Math.PI * 2) + start;
      const r = r0 + (r1 - r0) * t;
      pts.push((60 + r * Math.cos(a)).toFixed(2) + ' ' + (60 + r * Math.sin(a)).toFixed(2));
    }
    if (reverse) pts.reverse();
    return 'M ' + pts.join(' L ');
  }

  const GEOM = {
    full: { turns: 1.05, r0: 9, r1: 48, w: 5 },
    compact: { turns: 0.62, r0: 13, r1: 44, w: 13 }
  };

  const TONES = {
    color: { macro: '#1F3BC4', micro: '#F1553F', seed: '#C2258F', grid: '#DAD5CA', ink: '#14161A', dim: '#E2DDD2' },
    mono: { macro: '#14161A', micro: '#14161A', seed: '#14161A', grid: '#D6D2C8', ink: '#14161A', dim: '#DCD8CF' },
    inverse: { macro: '#6E86F0', micro: '#F98B78', seed: '#E85FB8', grid: '#3A3D45', ink: '#F7F5F0', dim: '#34373E' }
  };

  // fase -> estado visual
  const STATE = {
    origin:             { draw: 1, dir: 1, grid: 0, nodes: 0, seed: 9,   ring: 0, dim: true,  pulse: true },
    spiral_deployment:  { draw: 1, dir: 1, grid: 0, nodes: 0, seed: 6.5, ring: 0, dim: false, pulse: false },
    mirror_exchange:    { draw: 1, dir: 1, grid: 0, nodes: 1, seed: 6.5, ring: 0, dim: false, pulse: false },
    organization:       { draw: 1, dir: 1, grid: 1, nodes: 0, seed: 6.5, ring: 0, dim: false, pulse: false },
    return:             { draw: 1, dir: -1, grid: 0, nodes: 0, seed: 8,  ring: 0, dim: false, pulse: false },
    dna_reorganization: { draw: 1, dir: 1, grid: 0, nodes: 0, seed: 8,   ring: 1, dim: true,  pulse: true }
  };

  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  class ComprenderMark extends HTMLElement {
    static get observedAttributes() { return ['phase', 'variant', 'tone', 'size', 'autoplay', 'speed']; }

    connectedCallback() {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this._build();
      this._render();
      this._timer && clearInterval(this._timer);
      if (this.hasAttribute('autoplay')) {
        const speed = +this.getAttribute('speed') || 2200;
        let i = PHASES.indexOf(this.getAttribute('phase')) ;
        if (i < 0) i = 0;
        this._timer = setInterval(() => {
          i = (i + 1) % PHASES.length;
          this.setAttribute('phase', PHASES[i]);
        }, speed);
      }
    }

    disconnectedCallback() { this._timer && clearInterval(this._timer); }
    attributeChangedCallback() { if (this.shadowRoot && this._svg) this._render(); }

    _build() {
      if (this._svg) return;
      const style = document.createElement('style');
      style.textContent = `:host{display:inline-block;line-height:0}
        svg{display:block;overflow:visible}
        .p{transition:stroke-dashoffset .9s cubic-bezier(.65,.02,.25,1),stroke .45s ease}
        .g,.n{transition:opacity .45s ease}
        .s{transition:r .5s cubic-bezier(.5,0,.3,1.4),fill .45s ease}
        .pulse{animation:cm-breathe 3.6s ease-in-out infinite;transform-origin:60px 60px}
        @keyframes cm-breathe{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.18);opacity:.72}}
        @media (prefers-reduced-motion: reduce){.p,.g,.n,.s{transition:none}.pulse{animation:none}}`;
      const svg = el('svg', { viewBox: '0 0 120 120', role: 'img' });
      this._grid = el('g', { class: 'g' });
      this._grid.appendChild(el('circle', { cx: 60, cy: 60, r: 54, fill: 'none', 'stroke-width': 1.25 }));
      this._grid.appendChild(el('ellipse', { cx: 60, cy: 60, rx: 54, ry: 21, fill: 'none', 'stroke-width': 1.25 }));
      this._macro = el('path', { class: 'p', fill: 'none', 'stroke-linecap': 'round' });
      this._micro = el('path', { class: 'p', fill: 'none', 'stroke-linecap': 'round' });
      this._nodes = el('g', { class: 'n' });
      this._link = el('line', { x1: 60, y1: 12, x2: 60, y2: 108, 'stroke-width': 1.5, 'stroke-dasharray': '3 5' });
      this._nMacro = el('circle', { cx: 60, cy: 12, r: 7 });
      this._nMicro = el('circle', { cx: 60, cy: 108, r: 7 });
      this._nodes.append(this._link, this._nMacro, this._nMicro);
      this._ring = el('circle', { class: 'n', cx: 60, cy: 60, r: 13, fill: 'none', 'stroke-width': 2 });
      this._seed = el('circle', { class: 's', cx: 60, cy: 60, r: 7 });
      svg.append(this._grid, this._macro, this._micro, this._nodes, this._ring, this._seed);
      this.shadowRoot.append(style, svg);
      this._svg = svg;
    }

    _render() {
      // por defecto la marca dibujada; 'origin' es un estado explícito (toroide tenue)
      const phase = STATE[this.getAttribute('phase')] ? this.getAttribute('phase') : 'spiral_deployment';
      const st = STATE[phase];
      const variant = this.getAttribute('variant') === 'compact' ? 'compact' : 'full';
      const g = GEOM[variant];
      const c = TONES[this.getAttribute('tone')] || TONES.color;
      const size = +this.getAttribute('size') || 96;

      this._svg.setAttribute('width', size);
      this._svg.setAttribute('height', size);
      this._svg.setAttribute('aria-label', 'Comprender — ' + phase);

      const rev = st.dir === -1;
      const base = { turns: g.turns, r0: g.r0, r1: g.r1, reverse: rev };
      this._setPath(this._macro, spiral(Object.assign({}, base, { start: -Math.PI / 2 })), st.draw, g.w, st.dim ? c.dim : c.macro);
      this._setPath(this._micro, spiral(Object.assign({}, base, { start: Math.PI / 2 })), st.draw, g.w, st.dim ? c.dim : c.micro);

      this._grid.style.opacity = st.grid;
      [...this._grid.children].forEach(n => n.setAttribute('stroke', c.grid));
      this._nodes.style.opacity = st.nodes;
      this._link.setAttribute('stroke', c.ink);
      this._nMacro.setAttribute('fill', c.macro);
      this._nMicro.setAttribute('fill', c.micro);
      this._ring.style.opacity = st.ring;
      this._ring.setAttribute('stroke', c.seed);
      this._seed.setAttribute('r', variant === 'compact' ? st.seed + 2 : st.seed);
      this._seed.setAttribute('fill', c.seed);
      this._seed.classList.toggle('pulse', !!st.pulse && !this.hasAttribute('static'));
    }

    _setPath(node, d, draw, w, stroke) {
      const changed = node.getAttribute('d') !== d;
      node.setAttribute('d', d);
      node.setAttribute('stroke-width', w);
      node.setAttribute('stroke', stroke);
      const len = node.getTotalLength ? node.getTotalLength() : 300;
      node.style.strokeDasharray = len;
      if (changed) {                       // reinicia el trazado al cambiar de sentido
        node.style.transition = 'none';
        node.style.strokeDashoffset = len;
        void node.getBoundingClientRect();
        node.style.transition = '';
      }
      node.style.strokeDashoffset = draw ? 0 : len;
    }
  }

  if (!customElements.get('comprender-mark')) customElements.define('comprender-mark', ComprenderMark);
})();

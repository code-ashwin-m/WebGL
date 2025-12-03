// UI.js
// Contains your interaction logic (touch/mouse), mask data and glue to RenderEngine.
// Keeps your original behavior and variable names where possible.

class Mask {
  constructor(id, type = "circle") {
    this.id = id;              // Unique identifier
    this.type = type;          // "circle" or "ellipse"
    this.center = { x: 500, y: 500 };
    this.rx = 150; this.ry = 150; // For ellipse
    this.rotation = 0;         // Rotation in radians (for ellipse)
    this.selected = false;     // If this mask is active/selected
    this.outline = true;
    this.feather = 30;         // default feather radius in screen px
    this.exposure = 0.0;       // exposure in stops (Lightroom style)
  }
}

export class UI {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;
    this.gl = engine.gl;
    this.engine.draw();
    console.log("UI loaded!");

    this.camX = 0; this.camY = 0; this.zoom = 1;
    this.MIN_ZOOM = 0.2; this.MAX_ZOOM = 5;
    this.lastX = 0; this.lastY = 0;
    this.lastDist = 0; this.lastMid = { x: 0, y: 0 };
    this.isPinching = false; this.isTouching = false;
    this.engine.setCamera(this.camX, this.camY, this.zoom);

    this.masks = [];
    this.nextMaskId = 1;
    this.HANDLE_PX = 8;
    this.maskCurrent = null;
    this.activeMaskHandle = null;
    this.isCenterDragging = false;

    this._installEvents();

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = "img1.jpg";
    img.onload = () => {
      console.log('Image loaded!');
      this.engine.setImage(img);
      this.resetViewToFit();
      this._addMask();
      this._addMask();
      this.engine.draw();
    }
  }

  _addMask(type = "circle") {
    const mask = new Mask(this.nextMaskId++, type);
    this.masks.push(mask);
    this.engine.setMasks(this.masks);
    return mask;
  }

  screenToWorld(px, py) {
    const w = this.canvas.width / this.zoom;
    const h = this.canvas.height / this.zoom;
    const left = this.camX;
    const bottom = this.camY;
    const x = left + (px / this.canvas.width) * w;
    const y = bottom + ((this.canvas.height - py) / this.canvas.height) * h
    return { x, y };
  }

  midpoint(t1, t2) {
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  }
  distance(t1, t2) {
    const dx = t2.clientX - t1.clientX; const dy = t2.clientY - t1.clientY; return Math.hypot(dx, dy);
  }

  _isInsideHandle(px, py, hx, hy) {
    const w = this.screenToWorld(px, py);
    const dx = w.x - hx;
    const dy = w.y - hy;
    const r = (this.HANDLE_PX + 10) / this.zoom;
    return (dx * dx + dy * dy) <= (r * r);
  }

  _hitHandle(px, py) {
    for (let mask of this.masks) {
      const h = this.engine.getHandlePositions(mask);
      if (this._isInsideHandle(px, py, h.center.x, h.center.y)) return { type: 'center', mask };
      if (this._isInsideHandle(px, py, h.right.x, h.right.y) && mask.outline) return { type: 'resize-right', mask };
      if (this._isInsideHandle(px, py, h.left.x, h.left.y) && mask.outline) return { type: 'resize-left', mask };
      if (this._isInsideHandle(px, py, h.top.x, h.top.y) && mask.outline) return { type: 'resize-top', mask };
      if (this._isInsideHandle(px, py, h.bottom.x, h.bottom.y) && mask.outline) return { type: 'resize-bottom', mask };
      if (this._isInsideHandle(px, py, h.rotate.x, h.rotate.y) && mask.outline) return { type: 'rotate', mask };
    }
    return null;
  }

  _worldDeltaToLocal(dx, dy) {
    const c = Math.cos(-this.maskCurrent.rotation || 0);
    const s = Math.sin(-this.maskCurrent.rotation || 0);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  _startEvent(clientX, clientY) {
    this.lastX = clientX;
    this.lastY = clientY;
    const hit = this._hitHandle(clientX, clientY);
    if (hit) {
      this.maskCurrent = hit.mask;
      this.activeMaskHandle = hit.type;
      if (hit.type === 'rotate') {
        const worldStart = this.screenToWorld(clientX, clientY);
        this.rotateStartAngle = Math.atan2(worldStart.y - this.maskCurrent.center.y, worldStart.x - this.maskCurrent.center.x);
        this.rotateStartRot = this.maskCurrent.rotation;
      }
      return true;
    }
    this.isTouching = true;
    return false;
  }

  _moveEvent(clientX, clientY) {
    if (this.activeMaskHandle) {
      const before = this.screenToWorld(this.lastX, this.lastY);
      const now = this.screenToWorld(clientX, clientY);
      const dx = now.x - before.x; const dy = now.y - before.y;
      let loc = null;
      switch (this.activeMaskHandle) {
        case 'center':
          this.isCenterDragging = true;
          this.maskCurrent.center.x += dx;
          this.maskCurrent.center.y += dy;
          break;
        case 'resize-right':
          loc = this._worldDeltaToLocal(dx, dy);
          this.maskCurrent.rx += loc.x; if (this.maskCurrent.rx < 5) this.maskCurrent.rx = 5;
          break;
        case 'resize-left':
          loc = this._worldDeltaToLocal(dx, dy);
          this.maskCurrent.rx -= loc.x; if (this.maskCurrent.rx < 5) this.maskCurrent.rx = 5;
          break;
        case 'resize-top':
          loc = this._worldDeltaToLocal(dx, dy);
          this.maskCurrent.ry += loc.y; if (this.maskCurrent.ry < 5) this.maskCurrent.ry = 5;
          break;
        case 'resize-bottom':
          loc = this._worldDeltaToLocal(dx, dy);
          this.maskCurrent.ry -= loc.y; if (this.maskCurrent.ry < 5) this.maskCurrent.ry = 5;
          break;
        case 'rotate':
          const worldNow = this.screenToWorld(clientX, clientY);
          const nowAngle = Math.atan2(worldNow.y - this.maskCurrent.center.y, worldNow.x - this.maskCurrent.center.x);
          const delta = nowAngle - this.rotateStartAngle;
          this.maskCurrent.rotation = this.rotateStartRot + delta;
          break;
      }
      this.lastX = clientX; this.lastY = clientY;
      this.engine.draw();
      return true;
    }
    return false;
  }

  _stopEvent() {
    this.isCenterDragging = false;
    this.activeMaskHandle = null;
    this.isTouching = false;
    this.centerTouchId = null;
    this.engine.draw()
  }

  _installEvents() {
    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.touches[0];

      if (this._startEvent(t.clientX, t.clientY)) {
        this.centerTouchId = t.identifier;
        return;
      }

      if (e.touches.length === 1) {
        this.isTouching = true; this.isPinching = false;
        this.lastX = e.touches[0].clientX; this.lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        this.isPinching = true;
        this.lastDist = this.distance(e.touches[0], e.touches[1]);
        this.lastMid = this.midpoint(e.touches[0], e.touches[1]);
      }

    });

    this.canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      const t = [...e.touches].find(x => x.identifier === this.centerTouchId);
      if (t != null && this._moveEvent(t.clientX, t.clientY)) {
        return;
      }

      // pinch zoom
      if (this.isPinching && e.touches.length === 2) {
        const t1 = e.touches[0], t2 = e.touches[1];
        const mid = this.midpoint(t1, t2);
        const worldBefore = this.screenToWorld(mid.x, mid.y);
        const newDist = this.distance(t1, t2);
        const scale = newDist / this.lastDist;
        let newZoom = this.zoom * scale;
        newZoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, newZoom));
        this.zoom = newZoom;
        const worldAfter = this.screenToWorld(mid.x, mid.y)
        this.camX += (worldBefore.x - worldAfter.x);
        this.camY += (worldBefore.y - worldAfter.y);
        this.lastDist = newDist;
        this.lastMid = mid;
        this.engine.setCamera(this.camX, this.camY, this.zoom);
        this.engine.draw();
        return;
      }

      // single finger pan
      if (this.isTouching && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - this.lastX;
        const dy = t.clientY - this.lastY;
        this.camX -= dx * (1 / this.zoom);
        this.camY += dy * (1 / this.zoom);
        this.lastX = t.clientX; this.lastY = t.clientY;
        this.engine.setCamera(this.camX, this.camY, this.zoom);
        this.engine.draw();
      }
    });

    this.canvas.addEventListener('touchend', e => {
      this._stopEvent();
    });

    // mouse
    this.isTouching = false;
    this.canvas.addEventListener('mousedown', e => {
      this._startEvent(e.clientX, e.clientY);
    });

    this.canvas.addEventListener('mouseup', () => {
      this._stopEvent();
    });

    this.canvas.addEventListener('mousemove', e => {
      if (this._moveEvent(e.clientX, e.clientY)) {
        return;
      }

      if (!this.isTouching) return;
      const dx = e.clientX - this.lastX; const dy = e.clientY - this.lastY;
      this.camX -= dx * (1 / this.zoom); this.camY += dy * (1 / this.zoom);
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.engine.setCamera(this.camX, this.camY, this.zoom);
      this.engine.draw();
    });

    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const zoomFactor = 1.1;

      // Mouse position on canvas
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Convert screen → world before zoom
      const worldBefore = this.screenToWorld(mx, my);

      // Apply zoom
      if (e.deltaY < 0) {
        this.zoom *= zoomFactor;       // zoom in
      } else {
        this.zoom /= zoomFactor;       // zoom out
      }
      this.zoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, this.zoom));

      // Convert screen → world after zoom
      const worldAfter = this.screenToWorld(mx, my);

      this.camX += (worldBefore.x - worldAfter.x);
      this.camY += (worldBefore.y - worldAfter.y);

      this.engine.setCamera(this.camX, this.camY, this.zoom);
      this.engine.draw();
    });
  }

  resetViewToFit() {
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
    const screenW = this.canvas.clientWidth;
    const screenH = this.canvas.clientHeight;
    this.zoom = Math.min(screenW / this.engine.imgWidth, screenH / this.engine.imgHeight);
    const viewW = screenW / this.zoom;
    const viewH = screenH / this.zoom;
    this.camX = (this.engine.imgWidth - viewW) / 2;
    this.camY = (this.engine.imgHeight - viewH) / 2;
    this.engine.setCamera(this.camX, this.camY, this.zoom);
  }
}







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
    console.log("UI loaded!");

    // Get DPR once (it should match what RenderEngine uses)
    this.dpr = window.devicePixelRatio || 1;
    
    // Camera state
    this.camX = 0; 
    this.camY = 0; 
    this.zoom = 1;
    this.MIN_ZOOM = 0.2; 
    this.MAX_ZOOM = 5;
    
    // Interaction state
    this.lastX = 0; 
    this.lastY = 0;
    this.lastDist = 0; 
    this.lastMid = { x: 0, y: 0 };
    this.isPinching = false; 
    this.isTouching = false;
    
    // Initialize engine camera
    this.engine.setCamera(this.camX, this.camY, this.zoom);

    // Mask state
    this.masks = [];
    this.nextMaskId = 1;
    this.HANDLE_PX = 8;
    this.maskCurrent = null;
    this.activeMaskHandle = null;
    this.isCenterDragging = false;
    this.centerTouchId = null;

    // Setup event handlers
    this._installEvents();

    // Load image
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = "img1.jpg";
    img.onload = () => {
      console.log('Image loaded!');
      this.engine.setImage(img);
      this.resetViewToFit();
      this._addMask();
      // this._addMask();
      this.engine.draw();
    };
  }

  _addMask(type = "circle") {
    const mask = new Mask(this.nextMaskId++, type);
    this.masks.push(mask);
    this.engine.setMasks(this.masks);
    return mask;
  }

  // Convert screen coordinates to world coordinates
  // Note: px, py are in CSS pixels (not canvas pixels)
  screenToWorld(px, py) {
    // Get canvas position and size in CSS pixels
    const rect = this.canvas.getBoundingClientRect();
    
    // Convert to canvas-relative CSS coordinates
    const cssX = px - rect.left;
    const cssY = py - rect.top;
    
    // Convert CSS pixels to canvas pixels (accounting for DPR)
    const canvasX = cssX * (this.canvas.width / rect.width);
    const canvasY = cssY * (this.canvas.height / rect.height);
    
    // Now calculate world coordinates using canvas pixels
    // The engine uses canvas.width/height which already includes DPR
    const w = this.canvas.width / this.zoom;
    const h = this.canvas.height / this.zoom;
    const left = this.camX;
    const bottom = this.camY;
    
    const x = left + (canvasX / this.canvas.width) * w;
    const y = bottom + ((this.canvas.height - canvasY) / this.canvas.height) * h;
    
    return { x, y };
  }

  midpoint(t1, t2) {
    return { 
      x: (t1.clientX + t2.clientX) / 2, 
      y: (t1.clientY + t2.clientY) / 2 
    };
  }

  distance(t1, t2) {
    const dx = t2.clientX - t1.clientX; 
    const dy = t2.clientY - t1.clientY; 
    return Math.hypot(dx, dy);
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
        this.rotateStartAngle = Math.atan2(
          worldStart.y - this.maskCurrent.center.y, 
          worldStart.x - this.maskCurrent.center.x
        );
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
      const dx = now.x - before.x; 
      const dy = now.y - before.y;
      let loc = null;
      switch (this.activeMaskHandle) {
        case 'center':
          this.isCenterDragging = true;
          this.maskCurrent.center.x += dx;
          this.maskCurrent.center.y += dy;
          break;
        case 'resize-right':
          loc = this._worldDeltaToLocal(dx, dy);
          this.maskCurrent.rx += loc.x; 
          if (this.maskCurrent.rx < 5) this.maskCurrent.rx = 5;
          break;
        case 'resize-left':
          loc = this._worldDeltaToLocal(dx, dy);
          this.maskCurrent.rx -= loc.x; 
          if (this.maskCurrent.rx < 5) this.maskCurrent.rx = 5;
          break;
        case 'resize-top':
          loc = this._worldDeltaToLocal(dx, dy);
          this.maskCurrent.ry += loc.y; 
          if (this.maskCurrent.ry < 5) this.maskCurrent.ry = 5;
          break;
        case 'resize-bottom':
          loc = this._worldDeltaToLocal(dx, dy);
          this.maskCurrent.ry -= loc.y; 
          if (this.maskCurrent.ry < 5) this.maskCurrent.ry = 5;
          break;
        case 'rotate':
          const worldNow = this.screenToWorld(clientX, clientY);
          const nowAngle = Math.atan2(
            worldNow.y - this.maskCurrent.center.y, 
            worldNow.x - this.maskCurrent.center.x
          );
          const delta = nowAngle - this.rotateStartAngle;
          this.maskCurrent.rotation = this.rotateStartRot + delta;
          break;
      }
      this.lastX = clientX; 
      this.lastY = clientY;
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
    this.engine.draw();
  }

  _installEvents() {
    // Touch events
    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.touches[0];

      if (this._startEvent(t.clientX, t.clientY)) {
        this.centerTouchId = t.identifier;
        return;
      }

      if (e.touches.length === 1) {
        this.isTouching = true; 
        this.isPinching = false;
        this.lastX = e.touches[0].clientX; 
        this.lastY = e.touches[0].clientY;
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

      // Pinch zoom
      if (this.isPinching && e.touches.length === 2) {
        const t1 = e.touches[0], t2 = e.touches[1];
        const mid = this.midpoint(t1, t2);
        
        // Get world position of midpoint before zoom
        const worldBefore = this.screenToWorld(mid.x, mid.y);
        
        // Calculate new zoom
        const newDist = this.distance(t1, t2);
        const scale = newDist / this.lastDist;
        let newZoom = this.zoom * scale;
        newZoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, newZoom));
        
        // Apply zoom
        this.zoom = newZoom;
        
        // Get world position of midpoint after zoom
        const worldAfter = this.screenToWorld(mid.x, mid.y);
        
        // Adjust camera to keep midpoint in same world position
        this.camX += (worldBefore.x - worldAfter.x);
        this.camY += (worldBefore.y - worldAfter.y);
        
        this.lastDist = newDist;
        this.lastMid = mid;
        this.engine.setCamera(this.camX, this.camY, this.zoom);
        this.engine.draw();
        return;
      }

      // Single finger pan
      if (this.isTouching && e.touches.length === 1) {
        const t = e.touches[0];
        
        // Get world positions before and after movement
        const before = this.screenToWorld(this.lastX, this.lastY);
        const after = this.screenToWorld(t.clientX, t.clientY);
        
        // Calculate delta in world coordinates
        const dx = after.x - before.x;
        const dy = after.y - before.y;
        
        // Move camera opposite to movement direction
        this.camX -= dx;
        this.camY -= dy;
        
        this.lastX = t.clientX; 
        this.lastY = t.clientY;
        this.engine.setCamera(this.camX, this.camY, this.zoom);
        this.engine.draw();
      }
    });

    this.canvas.addEventListener('touchend', e => {
      this._stopEvent();
    });

    // Mouse events
    this.canvas.addEventListener('mousedown', e => {
      this._startEvent(e.clientX, e.clientY);
      this.isTouching = true;
    });

    this.canvas.addEventListener('mouseup', () => {
      this._stopEvent();
      this.isTouching = false;
    });

    this.canvas.addEventListener('mousemove', e => {
      if (this._moveEvent(e.clientX, e.clientY)) {
        return;
      }

      if (!this.isTouching) return;
      
      // Get world positions before and after movement
      const before = this.screenToWorld(this.lastX, this.lastY);
      const after = this.screenToWorld(e.clientX, e.clientY);
      
      // Calculate delta in world coordinates
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      
      // Move camera opposite to movement direction
      this.camX -= dx;
      this.camY -= dy;
      
      this.lastX = e.clientX; 
      this.lastY = e.clientY;
      this.engine.setCamera(this.camX, this.camY, this.zoom);
      this.engine.draw();
    });

    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const zoomFactor = 1.1;

      // Get mouse position relative to viewport
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX;
      const my = e.clientY;

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

      // Adjust camera to keep mouse position in same world position
      this.camX += (worldBefore.x - worldAfter.x);
      this.camY += (worldBefore.y - worldAfter.y);

      this.engine.setCamera(this.camX, this.camY, this.zoom);
      this.engine.draw();
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      this.resetViewToFit();
      this.engine.draw();
    });
  }

  resetViewToFit() {
    // Get current DPR (in case it changed)
    this.dpr = window.devicePixelRatio || 1;
    
    // Calculate actual pixel dimensions based on CSS dimensions and DPR
    const cssWidth = this.canvas.clientWidth;
    const cssHeight = this.canvas.clientHeight;

    // Actual pixel dimensions
    const screenW = Math.round(cssWidth * this.dpr);
    const screenH = Math.round(cssHeight * this.dpr);
    
    if (this.canvas.width !== screenW || this.canvas.height !== screenH) {
      this.canvas.width = screenW;
      this.canvas.height = screenH;
    }

    // Calculate zoom to fit image using actual pixel dimensions
    this.zoom = Math.min(screenW / this.engine.imgWidth, screenH / this.engine.imgHeight);
    const viewW = screenW / this.zoom;
    const viewH = screenH / this.zoom;
    this.camX = (this.engine.imgWidth - viewW) / 2;
    this.camY = (this.engine.imgHeight - viewH) / 2;
    this.engine.setCamera(this.camX, this.camY, this.zoom);
  }
}
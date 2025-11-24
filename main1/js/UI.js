// UI.js
// Contains your interaction logic (touch/mouse), mask data and glue to RenderEngine.
// Keeps your original behavior and variable names where possible.

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
    this.lastDist = 0; this.lastMid = {x:0,y:0};
    this.isPinching = false; this.isTouching = false;

    this.engine.setCamera(this.camX, this.camY, this.zoom);
    
    this._installEvents();
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = "http://192.168.1.35:8080/img.jpg";
    img.onload = () => {
      console.log('Image loaded!');
      this.engine.setImage(img);
      this.resetViewToFit();
      this.engine.draw();
    }
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
    const dx = t2.clientX - t1.clientX; const dy = t2.clientY - t1.clientY; return Math.hypot(dx,dy);
  }

  _installEvents() {
    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.touches[0];
      
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
      
      // pinch zoom
      if (this.isPinching && e.touches.length === 2) {
        const t1 = e.touches[0], t2 = e.touches[1];
        const mid = this.midpoint(t1,t2);
        const worldBefore = this.screenToWorld(mid.x, mid.y);
        const newDist = this.distance(t1,t2);
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
      this.isCenterDragging = false; this.isResizing = false; this.isRotating = false;
      this.centerTouchId = null; this.activeHandle = null;
      if (e.touches.length < 2) { this.isTouching = false; this.isPinching = false; }
      this.engine.draw()
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







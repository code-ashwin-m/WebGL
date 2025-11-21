// UI.js
// Contains your interaction logic (touch/mouse), mask data and glue to RenderEngine.
// Keeps your original behavior and variable names where possible.

export class UI {
    constructor(canvas, engine) {
        this.canvas = canvas;
        this.engine = engine;
        this.gl = engine.gl;

        // keep camera state variables as in original
        this.camX = 0; this.camY = 0; this.zoom = 1;
        this.MIN_ZOOM = 0.2; this.MAX_ZOOM = 5;
        this.lastX = 0; this.lastY = 0;
        this.lastDist = 0; this.lastMid = {x:0,y:0};
        this.isPinching = false; this.isTouching = false;

        // mask list
        this.masks = [];
        this.nextMaskId = 1;

        // selected and active handle state like your original
        this.maskCurrent = null;
        this.isCenterDragging = false;
        this.centerTouchId = null;
        this.isResizing = false;
        this.isRotating = false;
        this.touchArea = 20;
        this.HANDLE_PX = 10;
        this.ROTATE_OFFSET_PX = 40;
        this.activeHandle = null;
        this.rotateStartAngle = 0;
        this.rotateStartRot = 0;

        // set engine to reference our masks and camera
        this.engine.setMasks(this.masks);
        this.engine.setCamera(this.camX, this.camY, this.zoom);

        // create a few masks like before
        this.addMask(); this.addMask(); this.addMask();

        // wire events
        this._installEvents();

        // load demo image (same as original)
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = "http://192.168.1.35:8080/img1.jpg";
        img.onload = () => {
            console.log('IMAGE LOADED');
            this.engine.setImage(img);
            // center view
            this.resetViewToFit();
            this.engine.draw();
        };

        // expose for console
        window.masks = this.masks;
    }

    addMask(type='circle') {
        const m = {
            id: this.nextMaskId++,
            type: type,
            center: { x: 250, y: 250 },
            rx: 150, ry: 100,
            rotation: 0,
            selected: false,
            outline: false,
            feather: 30,
            exposure: 1.0,
            contrast: 1.0,
            brightness: 0.0
        };
        this.masks.push(m);
        this.engine.setMasks(this.masks);
        return m;
    }

    removeMask(id) {
        this.masks = this.masks.filter(x => x.id !== id);
        this.engine.setMasks(this.masks);
    }

    selectMask(id) {
        this.masks.forEach(m => m.selected = (m.id === id));
    }

    getEllipseHandlePositions(mask) {
        const c = Math.cos(mask.rotation || 0);
        const s = Math.sin(mask.rotation || 0);
        const rot = (x,y) => ({ x: mask.center.x + (x*c - y*s), y: mask.center.y + (x*s + y*c) });
        const pixel = 1.0 / this.zoom;
        return {
            center: rot(0,0),
            right: rot(mask.rx,0),
            left: rot(-mask.rx,0),
            top: rot(0,mask.ry),
            bottom: rot(0,-mask.ry),
            rotate: rot(0, -(mask.ry + this.ROTATE_OFFSET_PX * pixel))
        };
    }

    isInsideHandle(px, py, hx, hy) {
        const w = this.screenToWorld(px,py);
        const dx = w.x - hx;
        const dy = w.y - hy;
        const r = (this.HANDLE_PX + 20) / this.zoom;
        return (dx*dx + dy*dy) <= (r*r);
    }

    hitResizeOrRotate(px, py) {
        for (let mask of this.masks) {
            const h = this.getEllipseHandlePositions(mask);
            if (this.isInsideHandle(px, py, h.center.x, h.center.y)) return { type: 'center', mask };
            if (this.isInsideHandle(px, py, h.right.x, h.right.y) && mask.outline) return { type: 'resize-right', mask };
            if (this.isInsideHandle(px, py, h.left.x, h.left.y) && mask.outline) return { type: 'resize-left', mask };
            if (this.isInsideHandle(px, py, h.top.x, h.top.y) && mask.outline) return { type: 'resize-top', mask };
            if (this.isInsideHandle(px, py, h.bottom.x, h.bottom.y) && mask.outline) return { type: 'resize-bottom', mask };
            if (this.isInsideHandle(px, py, h.rotate.x, h.rotate.y) && mask.outline) return { type: 'rotate', mask };
        }
        return null;
    }

    // mapping functions (kept same as your original)
    screenToWorld(px, py) {
        const w = this.canvas.width / this.zoom;
        const h = this.canvas.height / this.zoom;
        const left = this.camX;
        const bottom = this.camY;
        const x = left + (px / this.canvas.width) * w;
        const y = bottom + ((this.canvas.height - py) / this.canvas.height) * h;
        return { x, y };
    }

    midpoint(t1, t2) {
        return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
    }
    distance(t1, t2) {
        const dx = t2.clientX - t1.clientX; const dy = t2.clientY - t1.clientY; return Math.hypot(dx,dy);
    }

    // event plumbing (adapted from your original)
    _installEvents() {
        this.canvas.addEventListener('touchstart', e => {
            e.preventDefault();
            const t = e.touches[0];
            const hit = this.hitResizeOrRotate(t.clientX, t.clientY);
            if (hit) {
                this.maskCurrent = hit.mask;
                this.activeHandle = hit.type;
                this.centerTouchId = t.identifier;
                this.lastX = t.clientX; this.lastY = t.clientY;
                if (hit.type === 'rotate') {
                    const worldStart = this.screenToWorld(t.clientX, t.clientY);
                    this.rotateStartAngle = Math.atan2(worldStart.y - this.maskCurrent.center.y, worldStart.x - this.maskCurrent.center.x);
                    this.rotateStartRot = this.maskCurrent.rotation;
                }
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
            if (this.activeHandle) {
                const t = [...e.touches].find(x => x.identifier === this.centerTouchId);
                if (!t) return;
                const before = this.screenToWorld(this.lastX, this.lastY);
                const now = this.screenToWorld(t.clientX, t.clientY);
                const dx = now.x - before.x; const dy = now.y - before.y;
                let loc = null;
                switch(this.activeHandle) {
                    case 'center':
                        this.isCenterDragging = true;
                        this.maskCurrent.center.x += dx;
                        this.maskCurrent.center.y += dy;
                        break;
                    case 'resize-right':
                        loc = this._worldDeltaToLocal(dx,dy);
                        this.maskCurrent.rx += loc.x; if (this.maskCurrent.rx < 5) this.maskCurrent.rx = 5;
                        break;
                    case 'resize-left':
                        loc = this._worldDeltaToLocal(dx,dy);
                        this.maskCurrent.rx -= loc.x; if (this.maskCurrent.rx < 5) this.maskCurrent.rx = 5;
                        break;
                    case 'resize-top':
                        loc = this._worldDeltaToLocal(dx,dy);
                        this.maskCurrent.ry += loc.y; if (this.maskCurrent.ry < 5) this.maskCurrent.ry = 5;
                        break;
                    case 'resize-bottom':
                        loc = this._worldDeltaToLocal(dx,dy);
                        this.maskCurrent.ry -= loc.y; if (this.maskCurrent.ry < 5) this.maskCurrent.ry = 5;
                        break;
                    case 'rotate':
                        const worldNow = this.screenToWorld(t.clientX, t.clientY);
                        const nowAngle = Math.atan2(worldNow.y - this.maskCurrent.center.y, worldNow.x - this.maskCurrent.center.x);
                        const delta = nowAngle - this.rotateStartAngle;
                        this.maskCurrent.rotation = this.rotateStartRot + delta;
                        break;
                }
                this.lastX = t.clientX; this.lastY = t.clientY;
                this.engine.draw();
                return;
            }

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
                const worldAfter = this.screenToWorld(mid.x, mid.y);
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
            if (this.activeHandle == 'center' && !this.isCenterDragging) {
                this.maskCurrent.outline = !this.maskCurrent.outline;
                this.selectMask(this.maskCurrent.id);
            }
            if (this.activeHandle == null && this.maskCurrent) {
                this.maskCurrent.outline = false;
            }
            this.isCenterDragging = false; this.isResizing = false; this.isRotating = false;
            this.centerTouchId = null; this.activeHandle = null;
            if (e.touches.length < 2) { this.isTouching = false; this.isPinching = false; }
            this.engine.draw();
        });

        // mouse
        let down = false;
        this.canvas.addEventListener('mousedown', e => { down = true; this.lastX = e.clientX; this.lastY = e.clientY; });
        window.addEventListener('mouseup', () => { down = false; });
        this.canvas.addEventListener('mousemove', e => {
            if (!down) return;
            const dx = e.clientX - this.lastX; const dy = e.clientY - this.lastY;
            this.camX -= dx * (1 / this.zoom); this.camY += dy * (1 / this.zoom);
            this.lastX = e.clientX; this.lastY = e.clientY;
            this.engine.setCamera(this.camX, this.camY, this.zoom);
            this.engine.draw();
        });
        this.canvas.addEventListener('wheel', e => {
            const z = 1.1;
            this.zoom *= (e.deltaY < 0 ? z : 1/z);
            this.zoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, this.zoom));
            this.engine.setCamera(this.camX, this.camY, this.zoom);
            this.engine.draw();
        });
    }

    _worldDeltaToLocal(dx, dy) {
        const c = Math.cos(-this.maskCurrent.rotation || 0);
        const s = Math.sin(-this.maskCurrent.rotation || 0);
        return { x: dx * c - dy * s, y: dx * s + dy * c };
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
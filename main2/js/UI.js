// UI.js
// Contains your interaction logic (touch/mouse), mask data and glue to RenderEngine.
// Keeps your original behavior and variable names where possible.

export class UI {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;
    this.gl = engine.gl;
    
    
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
    }
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







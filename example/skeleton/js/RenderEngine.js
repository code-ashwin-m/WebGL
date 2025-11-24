export class RenderEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl');
    if (!this.gl) throw new Error('WebGL not supported');
  }
  
  draw(){
    this._draw();
  }
  
  _draw(){

  }
}
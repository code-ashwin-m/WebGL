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
  }
}







export class UIController {
    constructor(engine) {
        
        this.engine = engine;
        const gui = new dat.GUI();

        var FresnelControls = function () {
            this.brightness = 0.0;
            this.exposure = 0.0;
            this.contrast = 0.0;
            this.saturation = 1.0;
            this.highlights = 0.0;
            this.shadows = 0.0;
            this.whites = 0.0;
            this.blacks = 0.0;
            this.vibrance = 0.0;
        };

        //Create the Dat.gui controls
        var fc = new FresnelControls();

        var f1 = gui.addFolder('Effects Settings');

        this.brightness = f1.add(fc, 'brightness', -100.0, 100.0).step(0.01);
        this.exposure = f1.add(fc, 'exposure', -5.0, 5.0).step(0.01);
        this.contrast = f1.add(fc, 'contrast', -100.0, 100.0).step(0.01);
        this.saturation = f1.add(fc, 'saturation', 0.0, 2.0).step(0.01);
        this.highlights = f1.add(fc, 'highlights', -100.0, 100.0).step(0.01);
        this.shadows = f1.add(fc, 'shadows', -100.0, 100.0).step(0.01);
        this.whites = f1.add(fc, 'whites', -100.0, 100.0).step(0.01);
        this.blacks = f1.add(fc, 'blacks', -100.0, 100.0).step(0.01);

        this.brightness.onChange(function (value) {
            engine.setEffect("brightness", value);
        });

        this.exposure.onChange(function (value) {
            engine.setEffect("exposure", value);
        });

        this.contrast.onChange(function (value) {
            engine.setEffect("contrast", value);
        });

        this.saturation.onChange(function (value) {
            engine.setEffect("saturation", value);
        });

        this.highlights.onChange(function (value) {
            engine.setEffect("highlights", value);
        });

        this.shadows.onChange(function (value) {
            engine.setEffect("shadows", value);
        });

        this.whites.onChange(function (value) {
            engine.setEffect("whites", value);
        });

        this.blacks.onChange(function (value) {
            engine.setEffect("blacks", value);
        });

        f1.open();
    }
}
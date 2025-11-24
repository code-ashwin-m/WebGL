export class App {
  constructor(engine) {
    this.engine = engine;
    this.tools = {
      light: [
        { name: "Exposure", id: "exposure", min: -5, max: 5, value: 0 },
        { name: "Contrast", id: "contrast", min: -1, max: 1, value: 0 },
        { name: "Highlights", id: "highlights", min: -100, max: 100, value: 0 },
        { name: "Shadows", id: "shadows", min: -100, max: 100, value: 0 }
      ],
      color: [
        { name: "Temp", id: "temp", min: -100, max: 100, value: 0 },
        { name: "Tint", id: "tint", min: -100, max: 100, value: 0 }
      ],
      effects: [
        { name: "Clarity", id: "clarity", min: -100, max: 100, value: 0 },
        { name: "Dehaze", id: "dehaze", min: -100, max: 100, value: 0 }
      ]
    };
    this.popup = null;
    this.content = null;
    
    this._initEvents();
  }
  
  _initEvents(){
    const bottomBar = document.getElementById("bottomBar");
    const exportBtn = document.getElementById("exportBtn");
    this.popup = document.getElementById("sliderPopup");
    this.content = document.getElementById("sliderContent");
  
    let currentOpenTool = null;

    bottomBar.addEventListener("click", (e) => {
      if (!e.target.classList.contains("tool")) return;

      const toolName = e.target.dataset.tool;
  
      if (currentOpenTool === toolName) {
        this.popup.classList.remove("open");
        currentOpenTool = null;
        return;
      }

      currentOpenTool = toolName;
      this._showPopup(toolName);
    });
    
    exportBtn.addEventListener("click", (e) => {
      this._downloadExport();
    });
  }
  
  async _downloadExport(filename = "edited.png") {
    alert("exporting1");
    const blob = await this.engine.export();
    alert("exporting2");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }
  
  _showPopup(toolName) {
    const list = this.tools[toolName];
    this.content.innerHTML = "";
    
    list.forEach(item => {
      const row = document.createElement("div");
      row.className = "slider-row";

      row.innerHTML = `
        <div class="sliderLabel">${item.name}</div>
        <input class="sliderInput" type="range"
          min="${item.min}" max="${item.max}"
          step="0.01" value="${item.value}"
          data-id="${item.id}">
        <div class="sliderValue">${item.value}</div>
      `;
      this.content.appendChild(row);
    });
    
    this._addSliderListeners();
    this.popup.classList.add("open");
  }
  
  _addSliderListeners() {
    const sliders = this.content.querySelectorAll(".sliderInput");

    sliders.forEach(sl => {
      sl.addEventListener("input", (e) => {
        const value = Number(e.target.value);
        const label = e.target.parentElement.querySelector(".sliderValue");

        label.textContent = value.toFixed(2);
        this.engine.updateEffect(e.target.dataset.id, value);
      });
    });
  }
}
const tools = {
  light: [
    { name: "Exposure", id:"exposure", min:-5, max:5 },
    { name: "Contrast", id:"contrast", min:-100, max:100 },
    { name: "Highlights", id:"highlights", min:-100, max:100 },
    { name: "Shadows", id:"shadows", min:-100, max:100 }
  ],

  color: [
    { name: "Temp", id:"temp", min:-100, max:100 },
    { name: "Tint", id:"tint", min:-100, max:100 }
  ]
};

const bottomBar = document.getElementById("toolStrip");

function showToolOptions(toolName) {
  const box = document.getElementById("toolOptions");
  box.innerHTML = "";

  tools[toolName].forEach(t => {
    const row = document.createElement("div");
    row.className = "slider-row";
    row.innerHTML = `
      <label>${t.name}</label>
      <input type="range" min="${t.min}" max="${t.max}" data-id="${t.id}">
    `;
    box.appendChild(row);
  });
}

bottomBar.addEventListener("click", (e) => {
  if (!e.target.classList.contains("tool")) return;
  
  const toolName = e.target.dataset.tool;

  showToolOptions(toolName);
});


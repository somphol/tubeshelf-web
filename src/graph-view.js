// Optional 3D graph. The 1.2 MB vendored library is loaded only when this view
// opens; the editor/grid never pays for it.

let vendorPromise = null;

function loadVendor() {
  if (window.ForceGraph3D) return Promise.resolve(window.ForceGraph3D);
  if (vendorPromise) return vendorPromise;
  vendorPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "vendor/3d-force-graph.min.js";
    script.async = true;
    script.onload = () => {
      if (window.ForceGraph3D) resolve(window.ForceGraph3D);
      else reject(new Error("3D graph library did not define ForceGraph3D."));
    };
    script.onerror = () => reject(new Error("Could not load the 3D graph library."));
    document.head.append(script);
  });
  return vendorPromise;
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function webGLAvailable() {
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
}

/**
 * Mount a ForceGraph3D in `container`. Returns `{ destroy, select }`.
 * The caller owns the info card and the "Show videos" action.
 */
export async function mountGraph(container, data, { onSelect } = {}) {
  if (!webGLAvailable()) {
    throw new Error("This browser has no WebGL, so the 3D view cannot run.");
  }
  const ForceGraph3D = await loadVendor();
  if (!container.isConnected) return { destroy() {}, select() {} };

  let selected = null;
  const graph = ForceGraph3D()(container)
    .backgroundColor("#08090c")
    .showNavInfo(false)
    .nodeVal((node) => node.val)
    .nodeRelSize(11)
    .nodeResolution(16)
    .nodeOpacity(0.92)
    .nodeColor((node) => (selected && node.id === selected ? "#ffb347" : node.color))
    .nodeLabel((node) => `
      <div class="graph-tip">
        <strong>${escapeHTML(node.name)}</strong>
        <span>${node.count} video${node.count === 1 ? "" : "s"} · ${escapeHTML(node.group)}</span>
      </div>
    `)
    .linkColor(() => "rgba(170, 180, 200, 0.45)")
    .linkWidth((link) => 0.4 + Math.min(2.4, link.value * 0.35))
    .linkOpacity(0.45)
    .linkDirectionalParticles((link) => (link.value >= 3 ? 1 : 0))
    .linkDirectionalParticleWidth(1.2)
    .linkDirectionalParticleColor(() => "rgba(200, 210, 255, 0.7)")
    .onNodeClick((node) => {
      selected = node.id;
      graph.nodeColor(graph.nodeColor());
      onSelect?.(node);
    })
    .onNodeHover((node) => {
      container.style.cursor = node ? "pointer" : "grab";
    })
    .cooldownTicks(140)
    .warmupTicks(20)
    .graphData(data);

  graph.d3Force("charge").strength(-90);
  graph.d3Force("link").distance(38);
  graph.cameraPosition({ x: 0, y: 30, z: 220 });
  graph.onEngineStop(() => graph.zoomToFit(600, 28));
  setTimeout(() => {
    if (container.isConnected) graph.zoomToFit(700, 28);
  }, 1000);

  const resize = () => {
    if (!container.isConnected) return;
    graph.width(container.clientWidth).height(container.clientHeight);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  // HTML labels for the largest hubs; the library's nodeLabel tooltip still
  // covers every node on hover. Labels follow the camera each frame.
  const labelLayer = document.createElement("div");
  labelLayer.className = "graph-labels";
  container.append(labelLayer);
  const labelNodes = data.nodes.slice(0, 8);
  const labelEls = labelNodes.map((node) => {
    const label = document.createElement("span");
    label.className = "graph-label";
    label.textContent = node.name;
    label.title = `Show ${node.name}`;
    label.addEventListener("click", (event) => {
      event.stopPropagation();
      selected = node.id;
      graph.nodeColor(graph.nodeColor());
      onSelect?.(node);
    });
    label.style.visibility = "hidden";
    label.style.display = "block";
    labelLayer.append(label);
    return { node, label, width: 0, height: 0 };
  });
  for (const entry of labelEls) {
    entry.width = entry.label.offsetWidth || 48;
    entry.height = entry.label.offsetHeight || 16;
  }
  let labelFrame = 0;
  const updateLabels = () => {
    const placed = [];
    for (const entry of labelEls) {
      const { node, label } = entry;
      if (!Number.isFinite(node.x)) {
        label.style.display = "none";
        continue;
      }
      const point = graph.graph2ScreenCoords(node.x, node.y, node.z);
      if (!point || point.x < -40 || point.x > container.clientWidth + 40
          || point.y < -40 || point.y > container.clientHeight + 40) {
        label.style.display = "none";
        continue;
      }
      const rect = {
        left: point.x - entry.width / 2,
        right: point.x + entry.width / 2,
        top: point.y - entry.height / 2,
        bottom: point.y + entry.height / 2,
      };
      const collides = placed.some((other) =>
        !(rect.right < other.left || rect.left > other.right
          || rect.bottom < other.top || rect.top > other.bottom)
      );
      if (collides) {
        label.style.display = "none";
        continue;
      }
      placed.push(rect);
      label.style.display = "block";
      label.style.visibility = "visible";
      label.style.transform = `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`;
    }
    labelFrame = requestAnimationFrame(updateLabels);
  };
  labelFrame = requestAnimationFrame(updateLabels);

  return {
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(labelFrame);
      try {
        graph._destructor?.();
      } catch {}
      container.replaceChildren();
    },
    select(id) {
      selected = id || null;
      graph.nodeColor(graph.nodeColor());
    },
    reset() {
      graph.zoomToFit(600, 28);
    },
  };
}

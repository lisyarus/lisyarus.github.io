import { vec2, vec3, vec4, mat4 } from "https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.min.js";

import { makeShaderDataDefinitions, makeStructuredView } from "https://greggman.github.io/webgpu-utils/dist/2.x/webgpu-utils.module.js";

// Root WebGPU objects
let device;
let canvas;
let surfaceFormat;
let surfaceFormatSRGB;
let context;
let hasTimestampQuery = false;

// Render targets
const hdrFormat = "rgba32float";
let hdrTexture;
let hdrTextureView;

// Bind group layouts
let cameraBindGroupLayout;
let densityBindGroupLayout;
let hdrBindGroupLayout;
let miscBindGroupLayout;
let convertRGB9E5BindGroupLayout;

// Pipelines
let previewPipeline;
let tracePipeline;
let composePipeline;
let composePipelineRgba;
let convertRGB9E5Pipeline;

// Buffers
let cameraUniformBuffer;
let settingsUniformBuffer;
let cameraUniforms;
let settingsUniforms;

// Textures
let blueNoiseTexture;
let densityTexture;
let tonyMcMapfaceLutTexture;

// Samplers
let noiseSampler;
let densitySampler;
let hdrSampler;
let tonyMcMapfaceLutSampler;

// Bind groups
let cameraBindGroup;
let densityBindGroup;
let hdrBindGroup;
let miscBindGroup;

// App state
let framesInFlight = 0;
const MAX_FRAMES_IN_FLIGHT = 2;
let frameId = 0;
let needRedraw = true;
let lastUpdateRedraw = false;

let camera = {
    zoom: 1.0,
    zoomTarget: 1.0,
    angleX: Math.PI * 0.7,
    angleXTarget: Math.PI * 0.7,
    angleY: - Math.PI * 0.1,
    angleYTarget: - Math.PI * 0.1,
};

let mouse = {
    position: [0, 0],
    left: {
        down: false,
    },
};

const activeTouches = new Map();
let lastTouchTime = undefined;

let toolsPanelShown = false;

let lastUpdateTime = undefined;
let moveTimeout = 0;
const MAX_MOVE_TIMEOUT = 0.25;

let frameTimeAverage = 1 / 60;

let selectedDataFilename = new URL("data/disney_cloud.data", window.location.href);
let selectedDataDimensions = [250, 170, 307];
let currentMode = "preview";
let traceFrameId = 0;

let loadingProgressMax = 13589084;
let loadingProgress = 0;

let ui = {
    modeSwitch: undefined,
    samplesCount: undefined,
    fpsCount: undefined,
    toolsPanel: undefined,
    progressBar: undefined,
    progressBarFill: undefined,
    selectedFilename: undefined,
};

function resetTrace() {
    moveTimeout = MAX_MOVE_TIMEOUT;
    traceFrameId = 0;
    needRedraw = true;
}

function rotateCamera(dx, dy) {
    camera.angleXTarget += dx;
    camera.angleYTarget += dy;
    camera.angleYTarget = Math.max(- Math.PI / 2, Math.min(Math.PI / 2, camera.angleYTarget));

    resetTrace();
}

async function fetchWithProgress(url) {
    const response = await fetch(url);

    const reader = response.body.getReader();
    const chunks = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        loadingProgress += value.length;

        ui.progressBarFill.style.width = (100 * Math.min(1, loadingProgress / loadingProgressMax)) + "%";
    }

    return new Blob(chunks);
}

async function readFileWithProgress(file) {
    const totalBytes = file.size;

    const reader = file.stream().getReader();
    const chunks = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        loadingProgress += value.byteLength;

        ui.progressBarFill.style.width = (100 * Math.min(1, loadingProgress / loadingProgressMax)) + "%";
    }

    return new Blob(chunks);
}

async function initWebGPU() {
    canvas = document.querySelector("#main-canvas");

    if (!navigator.gpu) {
        throw new Error("WebGPU is not supported");
    }

    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
        throw new Error("No suitable GPU adapter found");
    }

    hasTimestampQuery = adapter.features.has('timestamp-query');

    device = await adapter.requestDevice({
        requiredFeatures: [
            "float32-blendable",
        ],
    });

    surfaceFormat = navigator.gpu.getPreferredCanvasFormat();
    surfaceFormatSRGB = surfaceFormat + "-srgb";

    context = canvas.getContext("webgpu");

    context.configure({
        device,
        format: surfaceFormat,
        viewFormats: [surfaceFormatSRGB],
    });

    window.addEventListener("resize", resize);

    resize();
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    if (!hdrTexture || hdrTexture.width != canvas.width || hdrTexture.height != canvas.height) {
        hdrTexture = null;
        hdrBindGroup = null;
    }

    needRedraw = true;
    resetTrace();
}

async function loadShader(...paths) {
    const code = (await Promise.all(
        paths.map(path => fetch(path).then(r => r.text()))
    )).join("\n");

    return device.createShaderModule({
        label: paths.at(-1),
        code: code,
    });
}

function initBindGroupLayouts() {
    cameraBindGroupLayout = device.createBindGroupLayout({
        label: "camera",
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        ],
    });

    densityBindGroupLayout = device.createBindGroupLayout({
        label: "density",
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "3d" } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        ],
    });

    hdrBindGroupLayout = device.createBindGroupLayout({
        label: "hdr",
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "non-filtering" } },
        ],
    });

    miscBindGroupLayout = device.createBindGroupLayout({
        label: "misc",
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "3d" } },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        ],
    });

    convertRGB9E5BindGroupLayout = device.createBindGroupLayout({
        label: "convert_rgb9e5",
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        ],
    });
}

async function initPreviewPipeline() {
    let shaderModule = await loadShader("shaders/uniforms.wgsl", "shaders/common.wgsl", "shaders/preview.wgsl");

    previewPipeline = device.createRenderPipeline({
        label: "preview",
        layout: device.createPipelineLayout({
            bindGroupLayouts: [
                cameraBindGroupLayout,
                densityBindGroupLayout,
                miscBindGroupLayout,
            ],
        }),
        vertex: {
            module: shaderModule,
            entryPoint: "vertex_main",
        },
        primitive: {
            topology: "triangle-list",
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fragment_main",
            targets: [{
                format: hdrFormat,
            }],
        },
    });
}

async function initTracePipeline() {
    let shaderModule = await loadShader("shaders/uniforms.wgsl", "shaders/common.wgsl", "shaders/trace.wgsl");

    tracePipeline = device.createRenderPipeline({
        label: "trace",
        layout: device.createPipelineLayout({
            bindGroupLayouts: [
                cameraBindGroupLayout,
                densityBindGroupLayout,
                miscBindGroupLayout,
            ],
        }),
        vertex: {
            module: shaderModule,
            entryPoint: "vertex_main",
        },
        primitive: {
            topology: "triangle-list",
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fragment_main",
            targets: [{
                format: hdrFormat,
                blend: {
                    color: {
                        srcFactor: "src-alpha",
                        dstFactor: "one-minus-src-alpha",
                    },
                    alpha: {
                        srcFactor: "zero",
                        dstFactor: "one",
                    },
                },
            }],
        },
    });
}

async function initComposePipeline() {
    let shaderModule = await loadShader("shaders/uniforms.wgsl", "shaders/compose.wgsl");

    composePipeline = device.createRenderPipeline({
        label: "compose",
        layout: device.createPipelineLayout({
            bindGroupLayouts: [
                densityBindGroupLayout,
                hdrBindGroupLayout,
                miscBindGroupLayout,
            ],
        }),
        vertex: {
            module: shaderModule,
            entryPoint: "vertex_main",
        },
        primitive: {
            topology: "triangle-list",
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fragment_main",
            targets: [{
                format: surfaceFormat,
            }],
        },
    });

    composePipelineRgba = device.createRenderPipeline({
        label: "compose",
        layout: device.createPipelineLayout({
            bindGroupLayouts: [
                densityBindGroupLayout,
                hdrBindGroupLayout,
                miscBindGroupLayout,
            ],
        }),
        vertex: {
            module: shaderModule,
            entryPoint: "vertex_main",
        },
        primitive: {
            topology: "triangle-list",
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fragment_main",
            targets: [{
                format: "rgba8unorm",
            }],
        },
    });
}

async function initConvertRGB9E5Pipeline() {
    let shaderModule = await loadShader("shaders/pack_hdr.wgsl");

    convertRGB9E5Pipeline = device.createComputePipeline({
        label: "convert_rgb9e5",
        layout: device.createPipelineLayout({
            bindGroupLayouts: [
                hdrBindGroupLayout,
                convertRGB9E5BindGroupLayout,
            ],
        }),
        compute: {
            module: shaderModule,
            entryPoint: "compute_main",
        },
    });
}

async function initUniformBuffers() {
    const commonCode = await fetch("shaders/uniforms.wgsl").then(r => r.text());
    const commonDefinitions = makeShaderDataDefinitions(commonCode);
    cameraUniforms = makeStructuredView(commonDefinitions.structs.Camera);
    settingsUniforms = makeStructuredView(commonDefinitions.structs.Settings);

    cameraUniformBuffer = device.createBuffer({
        label: "camera",
        size: cameraUniforms.arrayBuffer.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    settingsUniformBuffer = device.createBuffer({
        label: "density",
        size: settingsUniforms.arrayBuffer.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    settingsUniforms.set({
        bbox_min: [-0.5, -0.5, -0.5],
        bbox_max: [ 0.5,  0.5,  0.5],

        sky_color_0: [0.035 * 2, 0.024 * 2, 0.020 * 2],
        sky_color_1: [0.008 * 2, 0.086 * 2, 0.365 * 2],
        horizon_color: [0.200 * 2, 0.424 * 2, 0.776 * 2],

        sun_direction: [0.0, 0.5, 0.866025404],
        sun_intensity: [100, 80, 70],
        sun_radius: 0.01,

        absorption: [0, 0, 0],
        emission: [0, 0, 0],
        scattering: [40, 40, 40],
        remap_density: [0, 1],
        lobe_1_g: 0.6,
        lobe_2_g: -0.2,
        lobe_mix: 0.5,

        threshold: 50.0,
        exposure: 1,
        tonemapping: 4,

        alpha: 1,
    });
}

async function loadTexture(path, format) {
    const response = await fetchWithProgress(path);
    const bitmap = await createImageBitmap(response);

    const texture = device.createTexture({
        label: path,
        size: [bitmap.width, bitmap.height],
        format: format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // For some reason, copyExternalImageToTexture seems to fail on Pixel 10.
    //     device.queue.copyExternalImageToTexture({source: bitmap}, {texture}, [bitmap.width, bitmap.height]);
    // 
    // Instead, we create a temporary canvas to extract the raw rgba8 bytes to upload them
    // to the GPU.

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;

    device.queue.writeTexture(
      { texture },
      data,
      { bytesPerRow: bitmap.width * 4 },
      [bitmap.width, bitmap.height],
    );

    return texture;
}

async function initTextures() {
    blueNoiseTexture = await loadTexture("textures/blue-noise.png", "rgba8unorm");

    tonyMcMapfaceLutTexture = device.createTexture({
        label: "tony_mc_mapface_lut",
        dimension: "3d",
        size: [48, 48, 48],
        format: "rgb9e5ufloat",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    const tonyMcMapfaceLutResponse = await fetchWithProgress("textures/tony_mc_mapface.data");
    const tonyMcMapfaceLutData = await tonyMcMapfaceLutResponse.arrayBuffer();

    device.queue.writeTexture(
        { texture: tonyMcMapfaceLutTexture },
        tonyMcMapfaceLutData,
        { bytesPerRow: 48 * 4, rowsPerImage: 48 },
        [48, 48, 48]
    );

    noiseSampler = device.createSampler({
        label: "noise",
        magFilter: "nearest",
        minFilter: "nearest",
        addressModeU: "repeat",
        addressModeV: "repeat",
    });

    densitySampler = device.createSampler({
        label: "density",
        magFilter: "linear",
        minFilter: "linear",
    });

    hdrSampler = device.createSampler({
        label: "hdr",
        magFilter: "nearest",
        minFilter: "nearest",
        mipmapFilter: "nearest",
    });

    tonyMcMapfaceLutSampler = device.createSampler({
        label: "tony_mc_mapface_lut",
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "nearest",
    });
}

function createDensityBindGroup() {
    densityBindGroup = device.createBindGroup({
        label: "density",
        layout: densityBindGroupLayout,
        entries: [
            { binding: 0, resource: settingsUniformBuffer },
            { binding: 1, resource: densityTexture },
            { binding: 2, resource: densitySampler },
        ],
    });
}

function initBindGroups() {
    cameraBindGroup = device.createBindGroup({
        label: "camera",
        layout: cameraBindGroupLayout,
        entries: [
            { binding: 0, resource: cameraUniformBuffer },
        ],
    });

    miscBindGroup = device.createBindGroup({
        label: "misc",
        layout: miscBindGroupLayout,
        entries: [
            { binding: 0, resource: blueNoiseTexture },
            { binding: 1, resource: noiseSampler },
            { binding: 2, resource: tonyMcMapfaceLutTexture },
            { binding: 3, resource: tonyMcMapfaceLutSampler },
        ],
    });

    if (densityTexture) {
        createDensityBindGroup();
    }
}

function initAppCallbacks() {
    document.addEventListener("contextmenu", (event) => {
        // event.preventDefault();
    });

    canvas.addEventListener("wheel", (event) => {
        camera.zoomTarget *= Math.pow(2.0, event.deltaY / 480.0);
        resetTrace();
    });

    canvas.addEventListener("mousemove", (event) => {
        let newPosisition = [event.clientX, event.clientY];
        if (mouse.left.down) {
            let delta = vec2.sub(newPosisition, mouse.position);
            rotateCamera(delta[0] * 0.004, delta[1] * 0.004);
        }
        mouse.position = newPosisition;
        event.preventDefault();
    });

    canvas.addEventListener("mousedown", (event) => {
        if (event.button == 0) {
            mouse.left.down = true;
        }
        event.preventDefault();
    });

    canvas.addEventListener("mouseup", (event) => {
        if (event.button == 0) {
            mouse.left.down = false;
        }
        event.preventDefault();
    });

    canvas.addEventListener("touchstart", function(event) {
        for (const touch of event.changedTouches) {
            activeTouches.set(touch.identifier, [touch.pageX, touch.pageY]);
        }

        if (activeTouches.size == 3) {
            toolsPanelShown = !toolsPanelShown;
        }

        const now = window.performance.now() / 1000.0;

        lastTouchTime = now;

        event.preventDefault();
    }, { passive: false });

    canvas.addEventListener("touchmove", function(event) {
        const oldTouches = new Map(activeTouches);

        for (const touch of event.changedTouches) {
            activeTouches.set(touch.identifier, [touch.pageX, touch.pageY]);
        }

        if (oldTouches.size == 1 && activeTouches.size == 1) {
            const oldPosition = oldTouches.entries().next().value[1];
            const newPosition = activeTouches.entries().next().value[1];
            const delta = [newPosition[0] - oldPosition[0], newPosition[1] - oldPosition[1]];

            rotateCamera(delta[0] * 0.004, delta[1] * 0.004);
        }

        if (oldTouches.size == 2 && activeTouches.size == 2) {
            const oldIterator = oldTouches.entries();
            const newIterator = activeTouches.entries();

            const oldPosition1 = oldIterator.next().value[1];
            const oldPosition2 = oldIterator.next().value[1];

            const newPosition1 = newIterator.next().value[1];
            const newPosition2 = newIterator.next().value[1];

            const oldDelta = [oldPosition2[0] - oldPosition1[0], oldPosition2[1] - oldPosition1[1]];
            const newDelta = [newPosition2[0] - newPosition1[0], newPosition2[1] - newPosition1[1]];

            const oldDistance = Math.sqrt(oldDelta[0] * oldDelta[0] + oldDelta[1] * oldDelta[1]);
            const newDistance = Math.sqrt(newDelta[0] * newDelta[0] + newDelta[1] * newDelta[1]);

            camera.zoomTarget *= oldDistance / newDistance;
            resetTrace();
        }

        event.preventDefault();
    }, { passive: false });

    canvas.addEventListener("touchend", function(event) {
        for (const touch of event.changedTouches) {
            activeTouches.delete(touch.identifier);
        }
        event.preventDefault();
    }, { passive: false });

    canvas.addEventListener("touchcancel", function(event) {
        for (const touch of event.changedTouches) {
            activeTouches.delete(touch.identifier);
        }
        event.preventDefault();
    }, { passive: false });
}

function hexToLinearRgb(hex) {
    return hex.match(/[0-9a-f]{2}/gi)
        .map(channel => parseInt(channel, 16) / 255)
        .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
}

function setupColorControl(controlName, uniformName) {
    const element = document.getElementById(controlName);
    element.addEventListener("input", () => {
        settingsUniforms.views[uniformName].set(hexToLinearRgb(element.value));
        resetTrace();
    });
}

function mapSliderValue(slider) {
    if ("map" in slider.dataset) {
        if (slider.dataset["map"] == "log") {
            if (slider.value == slider.min) {
                return 0;
            }
            return Math.pow(10, Number(slider.value));
        }
    }
    return Number(slider.value);
}

function setupSlider(sliderName, textName, uniformName, textSuffix) {
    const slider = document.getElementById(sliderName);
    const text = document.getElementById(textName);

    slider.addEventListener("input", () => {
        let value = mapSliderValue(slider);
        text.innerText = Number(value.toPrecision(3)).toString() + (textSuffix ? textSuffix : "");

        if (uniformName) {
            settingsUniforms.views[uniformName].set([value]);
            needRedraw = true;
            if (!("noreset" in slider.dataset)) {
                resetTrace();
            }
        }
    });
}

function setupSelect(selectName, uniformName) {
    const select = document.getElementById(selectName);

    select.addEventListener("input", () => {
        settingsUniforms.views[uniformName].set([Number(select.value)]);
        needRedraw = true;
        if (!("noreset" in select.dataset)) {
            resetTrace();
        }
    });
}

function setupTwoElementControl(slider1Name, slider2Name, uniformName) {
    const slider1 = document.getElementById(slider1Name);
    const slider2 = document.getElementById(slider2Name);

    let callback = () => {
        let value1 = mapSliderValue(slider1);
        let value2 = mapSliderValue(slider2);
        settingsUniforms.views[uniformName].set([value1, value2]);
        resetTrace();
    };

    slider1.addEventListener("input", callback);
    slider2.addEventListener("input", callback);
}

function setupColorControlWithIntensitySlider(controlName, intensityControlName, uniformName) {
    const element = document.getElementById(controlName);
    const intensityElement = document.getElementById(intensityControlName);

    let callback = () => {
        let intensity = mapSliderValue(intensityElement);
        settingsUniforms.views[uniformName].set(hexToLinearRgb(element.value).map(c => c * intensity));
        resetTrace();
    };

    element.addEventListener("input", callback);
    intensityElement.addEventListener("input", callback);
}

function setupVolumeColorsControl(transmissionControlName, scatteringControlName, absorptionUniformName, scatteringUniformName) {
    const transmissionElement = document.getElementById(transmissionControlName);
    const scatteringElement = document.getElementById(scatteringControlName);

    let callback = () => {
        let extinction = hexToLinearRgb(transmissionElement.value).map(c => 1 / Math.max(c, 0.0001) - 1);
        let scatteringAlbedo = hexToLinearRgb(scatteringElement.value);

        let scattering = [0, 0, 0];
        let absorption = [0, 0, 0];

        for (let i = 0; i < 3; ++i) {
            scattering[i] = extinction[i] * scatteringAlbedo[i];
            absorption[i] = extinction[i] * (1.0 - scatteringAlbedo[i]);
        }

        settingsUniforms.views[absorptionUniformName].set(absorption);
        settingsUniforms.views[scatteringUniformName].set(scattering);
        resetTrace();
    };

    transmissionElement.addEventListener("input", callback);
    scatteringElement.addEventListener("input", callback);
}

function setupDirectionSliders(elevationSliderName, azimuthSliderName, uniformName) {
    const elevationSlider = document.getElementById(elevationSliderName);
    const azimuthSlider = document.getElementById(azimuthSliderName);

    let callback = () => {
        let elevation = Number(elevationSlider.value) / 180 * Math.PI;
        let azimuth = Number(azimuthSlider.value) / 180 * Math.PI;

        settingsUniforms.views[uniformName].set([
            Math.cos(elevation) * Math.cos(azimuth),
            Math.sin(elevation),
            Math.cos(elevation) * Math.sin(azimuth),
        ]);

        resetTrace();
    }

    elevationSlider.addEventListener("input", callback);
    azimuthSlider.addEventListener("input", callback);
}

async function saveFileWithDialog(content, suggestedName, description, mime, extension) {
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: suggestedName,
                types: [{description: description, accept: { [mime]: [extension] }}],
            });

            const writable = await handle.createWritable();
            await writable.write(content);
            await writable.close();
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Failed to save file:', err);
            }
        }
    } else {
        const url = URL.createObjectURL(new Blob([content], { type: mime }));
        const a = document.createElement('a');

        a.href = url;
        a.download = suggestedName;
        a.click();
        URL.revokeObjectURL(url);
    }
}

function initUi() {
    for (let subsectionTitle of document.querySelectorAll(".subsection-title")) {
        let callback = (event) => {
            subsectionTitle.parentElement.classList.toggle("open");
        };

        subsectionTitle.addEventListener("click", callback);
    }

    for (let switchControl of document.querySelectorAll(".switch")) {
        let callback = (event) => {
            const segment = event.target.closest(".switch-segment");
            if (!segment) {
                return;
            }

            switchControl.querySelector(".selected")?.classList.remove("selected");
            segment.classList.add("selected");
            switchControl.dataset.value = segment.dataset.value;
        };

        switchControl.addEventListener("click", callback);
        switchControl.addEventListener("touchstart", callback);
    }

    ui.modeSwitch = document.getElementById("mode-switch");
    ui.samplesCount = document.getElementById("samples-count");
    ui.fpsCount = document.getElementById("fps-count");
    ui.toolsPanel = document.getElementById("tools-panel");
    ui.progressBar = document.getElementById("progress-bar");
    ui.progressBarFill = document.getElementById("progress-bar-fill");
    ui.selectedFilename = document.getElementById("selected-filename");

    setupSlider("density-min-slider", "density-min-text");
    setupSlider("density-max-slider", "density-max-text");
    setupTwoElementControl("density-min-slider", "density-max-slider", "remap_density");

    setupSlider("sky-intensity-slider", "sky-intensity-text");
    setupColorControlWithIntensitySlider("sky-color-0", "sky-intensity-slider", "sky_color_0");
    setupColorControlWithIntensitySlider("sky-color-horizon", "sky-intensity-slider", "horizon_color");
    setupColorControlWithIntensitySlider("sky-color-1", "sky-intensity-slider", "sky_color_1");

    setupSlider("sun-intensity-slider", "sun-intensity-text");
    setupSlider("sun-radius-slider", "sun-radius-text", "sun_radius");
    setupColorControlWithIntensitySlider("sun-color", "sun-intensity-slider", "sun_intensity");
    setupSlider("sun-elevation-slider", "sun-elevation-text", null, "°");
    setupSlider("sun-azimuth-slider", "sun-azimuth-text", null, "°");
    setupDirectionSliders("sun-elevation-slider", "sun-azimuth-slider", "sun_direction");

    setupVolumeColorsControl("transmission-color", "scattering-albedo", "absorption", "scattering");
    setupSlider("emission-intensity-slider", "emission-intensity-text");
    setupColorControlWithIntensitySlider("emission-color", "emission-intensity-slider", "emission");

    setupSlider("lobe1-slider", "lobe1-text", "lobe_1_g");
    setupSlider("lobe2-slider", "lobe2-text", "lobe_2_g");
    setupSlider("lobe-mix-slider", "lobe-mix-text", "lobe_mix");

    setupSlider("clipping-slider", "clipping-text", "threshold");
    setupSlider("exposure-slider", "exposure-text", "exposure");

    setupSelect("tonemapping-select", "tonemapping");

    document.getElementById("panel-collapse-button").addEventListener("click", () => {
        ui.toolsPanel.classList.toggle("collapsed");
    });

    document.getElementById("upload-data").addEventListener("click", async () => {
        var file = null;
        if ("showOpenFilePicker" in window) {
            const [fileHandle] = await window.showOpenFilePicker({ multiple: false });
            file = await fileHandle.getFile();
        } else {
            let files = await new Promise((resolve) => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '*';
                input.multiple = false;

                input.onchange = () => {
                  resolve(Array.from(input.files));
                };

                input.click();
            });
            file = files[0];
        }

        const dimensionsStr = prompt("Enter 3D texture dimensions separated by spaces (X Y Z):", "");

        if (dimensionsStr != null) {
            const dimensions = dimensionsStr.trim().split(/\s+/).map(Number);

            if (dimensions.length != 3 || !dimensions.every(x => x > 0)) {
                alert(`Expected 3 positive numbers, got ${dimensions}`);
                return;
            }

            let expectedSize = dimensions[0] * dimensions[1] * dimensions[2];
            if (file.size != expectedSize) {
                alert(`Dimensions and file size don't match (expected ${dimensions[0]}x${dimensions[1]}x${dimensions[2]}=${expectedSize} single-byte voxels, got ${file.size} bytes`);
                return;
            }

            loadingProgressMax = expectedSize;
            loadingProgress = 0;
            ui.progressBar.style.display = "inline";
            ui.progressBarFill.style.width = "0%";

            const blob = await readFileWithProgress(file);
            const dataArray = await blob.arrayBuffer();

            selectedDataDimensions = dimensions;

            await reloadData(file.name, dataArray);

            ui.progressBar.style.display = "none";

            resetTrace();
        }
    });

    document.getElementById("save-png-button").addEventListener("click", async () => {
        const width = canvas.width;
        const height = canvas.height;

        const composeTexture = device.createTexture({
            size: [width, height],
            format: "rgba8unorm",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });

        const encoder = device.createCommandEncoder();

        {
            const renderPass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: composeTexture.createView(),
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store",
                }],
            });

            renderPass.setBindGroup(0, densityBindGroup);
            renderPass.setBindGroup(1, hdrBindGroup);
            renderPass.setBindGroup(2, miscBindGroup);

            renderPass.setPipeline(composePipelineRgba);
            renderPass.draw(3);

            renderPass.end();
        }

        const bytesPerPixel = 4;
        const unalignedRowSize = width * bytesPerPixel;
        const alignedRowSize = Math.ceil(unalignedRowSize / 256) * 256;

        const readBuffer = device.createBuffer({
            size: alignedRowSize * height,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        encoder.copyTextureToBuffer(
            { texture: composeTexture },
            { buffer: readBuffer, bytesPerRow: alignedRowSize, rowsPerImage: height },
            { width: width, height: height, depthOrArrayLayers: 1 }
        );
        device.queue.submit([encoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const rawData = new Uint8Array(readBuffer.getMappedRange());

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const ctx = tempCanvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);

        for (let y = 0; y < height; ++y) {
            const srcOffset = y * alignedRowSize;
            const dstOffset = y * unalignedRowSize;
            imageData.data.set(rawData.subarray(srcOffset, srcOffset + unalignedRowSize), dstOffset);
        }
        readBuffer.unmap();

        ctx.putImageData(imageData, 0, 0);

        tempCanvas.toBlob((blob) => {
            saveFileWithDialog(blob, "cloud-render.png", 'PNG files', 'image/png', '.png');
        }, 'image/png');
    });

    document.getElementById("save-hdr-button").addEventListener("click", async () => {
        const width = canvas.width;
        const height = canvas.height;

        const header = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\nSOFTWARE=lisyarus volumetric path tracer\n\n-Y ${height} +X ${width}\n`);
        const dataLength = 4 * width * height;
        const totalLength = header.byteLength + dataLength;

        const result = new Uint8Array(totalLength);
        result.set(header, 0);

        const encodeBuffer = device.createBuffer({
            size: width * height * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });

        const copyBuffer = device.createBuffer({
            size: width * height * 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        const encodeBindGroup = device.createBindGroup({
            layout: convertRGB9E5BindGroupLayout,
            entries: [
                { binding: 0, resource: encodeBuffer },
            ],
        });

        const encoder = device.createCommandEncoder();

        {
            const computePass = encoder.beginComputePass();

            computePass.setBindGroup(0, hdrBindGroup);
            computePass.setBindGroup(1, encodeBindGroup);

            computePass.setPipeline(convertRGB9E5Pipeline);
            computePass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));

            computePass.end();
        }

        encoder.copyBufferToBuffer(encodeBuffer, copyBuffer);

        device.queue.submit([encoder.finish()]);

        await copyBuffer.mapAsync(GPUMapMode.READ);
        const rawData = new Uint8Array(copyBuffer.getMappedRange());
        result.set(rawData, header.byteLength);
        copyBuffer.unmap();

        saveFileWithDialog(result, "cloud-render.hdr", 'Radiance HDR files', 'image/vnd.radiance', '.hdr');
    });
}

async function reloadData(filename, dataArray) {
    ui.selectedFilename.innerText = filename.split('/').pop() + ` ${selectedDataDimensions[0]}x${selectedDataDimensions[1]}x${selectedDataDimensions[2]}`;

    densityTexture = device.createTexture({
        label: "density",
        dimension: "3d",
        size: selectedDataDimensions,
        format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    device.queue.writeTexture(
        { texture: densityTexture },
        dataArray,
        { bytesPerRow: selectedDataDimensions[0], rowsPerImage: selectedDataDimensions[1] },
        selectedDataDimensions
    );

    createDensityBindGroup();

    let maxDimension = Math.max(...selectedDataDimensions);
    let extent = [selectedDataDimensions[0] / maxDimension / 2, selectedDataDimensions[1] / maxDimension / 2, selectedDataDimensions[2] / maxDimension / 2];
    settingsUniforms.set({
        bbox_min: [- extent[0], - extent[1], - extent[2]],
        bbox_max: extent,
    });
}

async function initState() {
    initUi();
    initBindGroupLayouts();
    await initPreviewPipeline();
    await initTracePipeline();
    await initComposePipeline();
    await initConvertRGB9E5Pipeline();
    await initUniformBuffers();
    await initTextures();
    initBindGroups();
    initAppCallbacks();
}

function requestDraw() {
    window.requestAnimationFrame((time) => {
        requestDraw();
        update(time);

        lastUpdateRedraw = needRedraw;

        if (framesInFlight >= MAX_FRAMES_IN_FLIGHT) {
            return;
        }

        if (!needRedraw) {
            return;
        }

        ++framesInFlight;
        needRedraw = false;

        draw();

        device.queue.onSubmittedWorkDone().then(() => {
            --framesInFlight;
        });
    })
}

function cameraViewMatrix() {
    let viewMatrix = mat4.identity();
    viewMatrix = mat4.mul(mat4.rotationY(camera.angleX), viewMatrix);
    viewMatrix = mat4.mul(mat4.rotationX(camera.angleY), viewMatrix);
    viewMatrix = mat4.mul(mat4.translation([0, 0, - camera.zoom]), viewMatrix);
    return viewMatrix;
}

function cameraProjectionMatrix() {
    let fov = Math.PI / 3;
    let aspect = canvas.width / canvas.height;
    let near = 0.01;
    let far = 1000.0;
    return mat4.perspective(fov, aspect, near, far);
}

function update(time) {
    let dt = 0.0;
    if (lastUpdateTime) {
        dt = (time - lastUpdateTime) / 1000.0;

        if (lastUpdateRedraw) {
            frameTimeAverage = frameTimeAverage * 0.9 + dt * 0.1;
        }
    }
    lastUpdateTime = time;

    let newMode = ui.modeSwitch.dataset.value;
    if (newMode != currentMode) {
        currentMode = newMode;
        if (currentMode == "preview") {
            needRedraw = true;
        } else {
            traceFrameId = 0;
        }
    }

    camera.zoom += (camera.zoomTarget - camera.zoom) * (- Math.expm1(- 20.0 * dt));
    camera.angleX += (camera.angleXTarget - camera.angleX) * (- Math.expm1(- 40.0 * dt));
    camera.angleY += (camera.angleYTarget - camera.angleY) * (- Math.expm1(- 40.0 * dt));

    moveTimeout -= dt;
    if (moveTimeout <= 0) {
        moveTimeout = 0;
    } else if (currentMode == "preview") {
        needRedraw = true;
    }

    if (currentMode == "trace") {
        needRedraw = true;
        ui.samplesCount.innerText = "Samples: " + traceFrameId;
    } else {
        ui.samplesCount.innerText = "Samples: N/A";
    }

    ui.fpsCount.innerText = "FPS: " + (1 / frameTimeAverage).toFixed(1);
}

function draw() {
    const viewMatrix = cameraViewMatrix();
    const projectionMatrix = cameraProjectionMatrix();
    const viewProjectionMatrix = mat4.mul(projectionMatrix, viewMatrix);
    const viewProjectionInverseMatrix = mat4.inverse(viewProjectionMatrix);
    const cameraPosition = vec4.transformMat4(vec4.fromValues(0, 0, 0, 1), mat4.inverse(viewMatrix));

    frameId += 1;

    cameraUniforms.set({
        view_projection: viewProjectionMatrix,
        view_projection_inverse: viewProjectionInverseMatrix,
        position: cameraPosition.slice(0, 3),
        frame_id: frameId,
    });

    if (currentMode == "preview") {
        settingsUniforms.set({
            alpha: 1,
        });
    } else {
        settingsUniforms.set({
            alpha: 1 / (1 + traceFrameId),
        });
    }

    device.queue.writeBuffer(cameraUniformBuffer, 0, cameraUniforms.arrayBuffer);
    device.queue.writeBuffer(settingsUniformBuffer, 0, settingsUniforms.arrayBuffer);

    if (!hdrTexture) {
        hdrTexture = device.createTexture({
            label: "hdr",
            size: [canvas.width, canvas.height],
            format: hdrFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });

        hdrTextureView = hdrTexture.createView();

        hdrBindGroup = device.createBindGroup({
            label: "hdr",
            layout: hdrBindGroupLayout,
            entries: [
                { binding: 0, resource: hdrTexture },
                { binding: 1, resource: hdrSampler },
            ],
        });
    }

    const targetView = context.getCurrentTexture().createView({
        format: surfaceFormat,
    });

    const encoder = device.createCommandEncoder();

    const effectiveMode = (currentMode == "trace" && moveTimeout <= 0) ? "trace" : "preview";

    {
        const needClear = (effectiveMode == "preview") || (effectiveMode == "trace" && traceFrameId == 0);

        const renderPass = encoder.beginRenderPass({
            colorAttachments: [{
                view: hdrTextureView,
                clearValue: [0, 0, 0, 1],
                loadOp: needClear ? "clear" : "load",
                storeOp: "store",
            }],
        });

        renderPass.setBindGroup(0, cameraBindGroup);
        renderPass.setBindGroup(1, densityBindGroup);
        renderPass.setBindGroup(2, miscBindGroup);

        renderPass.setPipeline((effectiveMode == "preview") ? previewPipeline : tracePipeline);
        renderPass.draw(3);

        renderPass.end();
    }

    {
        const renderPass = encoder.beginRenderPass({
            colorAttachments: [{
                view: targetView,
                clearValue: [0, 0, 0, 0],
                loadOp: "clear",
                storeOp: "store",
            }],
        });

        renderPass.setBindGroup(0, densityBindGroup);
        renderPass.setBindGroup(1, hdrBindGroup);
        renderPass.setBindGroup(2, miscBindGroup);

        renderPass.setPipeline(composePipeline);
        renderPass.draw(3);

        renderPass.end();
    }

    if (effectiveMode == "trace") {
        traceFrameId += 1;
    }

    device.queue.submit([encoder.finish()]);
}

async function initAll() {
    await initWebGPU();
    await initState();
    
    let dataResponse = await fetchWithProgress(selectedDataFilename)
    let dataArray = await dataResponse.arrayBuffer();
    await reloadData(selectedDataFilename.pathname, dataArray);

    await requestDraw();

    ui.progressBar.style.display = "none";
    ui.toolsPanel.classList.toggle("collapsed");
}

initAll().catch(error => {
    let errorDisplay = document.getElementById("error-display");
    canvas.style.display = "none";
    errorDisplay.style.display = "grid";
    errorDisplay.innerText = error.message;
    ui.progressBar.style.display = "none";
});
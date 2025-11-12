import { Matrix4 } from './math.js';

// WebGPU base stuff

var canvas;
var device;
var context;
var surfaceFormat;

// Constants

const hdrFormat = 'rgba16float';
const renderUniformsBufferSize = 208;

// Buffers

var voxelTypesBuffer;

var renderUniformsBuffer;

// Textures

// TODO: replace with sparse wide (4x4x4) octree
var voxelsTexture;
var voxelsTextureView;

var blueNoiseTexture;
var blueNoiseTextureView;

var hdrTexture;
var hdrTextureView;

// Bind groups

var voxelsBindGroupLayout;
var voxelsBindGroup;

var renderUniformsBindGroupLayout;
var renderUniformsBindGroup;

var composeBindGroupLayout;
var composeBindGroup;

// Shader modules

var renderDirectRaytraceShaderModule;
var composeShaderModule;

// Pipelines

var renderDirectRaytracePipeline;
var composePipeline;

// Frame management

var frameID = 0;
var framesInFlight = 0;

// Event state

var lastFrameTimestamp = window.performance.now() / 1000.0;
var keydown = new Set();
var trackedKeys = new Set(['a', 'd', 's', 'w']);
var mouse = null;
var mouseDelta = [0, 0];

// Camera

var camera = {
    position: [128, -200, 192],
    xangle: 0,
    yangle: 0,
    xfov: Math.PI / 2,
    yfov: Math.PI / 2,
};

function cameraViewMatrix(camera)
{
    return Matrix4.identity()
        .mult(Matrix4.rotationYZ(camera.yangle))
        .mult(Matrix4.rotationZX(-camera.xangle))
        .mult(Matrix4.rotationYZ(-Math.PI/2.0))
        .mult(Matrix4.translation([-camera.position[0], -camera.position[1], -camera.position[2]]));
}

function cameraProjectionMatrix(camera)
{
    // NB: near and far aren't really relevant, raytracing ignores them anyway
    // They do affect the precision of inverse camera matrix though
    return Matrix4.perspective(camera.xfov, camera.yfov, 10.0, 11.0);
}

// Data loading functions

async function loadShaderModule(path)
{
	const response = await fetch(path);
    const shaderCode = await response.text();
    return device.createShaderModule({
        label: path,
        code: shaderCode,
    });
}

async function loadImage(path)
{
    const res = await fetch(path);
    const blob = await res.blob();
    return await createImageBitmap(blob, { colorSpaceConversion: 'none' });
}

async function loadTexture(path, format, usage)
{
    const image = await loadImage(path);
    
    const texture = device.createTexture({
        label: path,
        format: format,
        size: [image.width, image.height],
        usage: usage | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
        { source: image },
        { texture: texture },
        { width: image.width, height: image.height },
    );

    return texture;
}

// Initialization functions

function initCanvas()
{
	canvas = document.getElementById("mainCanvas");

    window.addEventListener('keydown', function(event) {
        keydown.add(event.key);
        if (trackedKeys.has(event.key)) {
            event.preventDefault();
        }
    }, false);

    window.addEventListener('keyup', function(event) {
        keydown.delete(event.key);
        if (trackedKeys.has(event.key)) {
            event.preventDefault();
        }
    }, false);

    canvas.addEventListener("click", async () => {
        if (document.pointerLockElement != canvas) {
            await canvas.requestPointerLock();
        }
    });

    canvas.addEventListener("mousemove", (event) => {
        if ("movementX" in event) {
            mouseDelta[0] += event.movementX;
            mouseDelta[1] += event.movementY;
        } else {
            const newMouse = [event.clientX, event.clientY];
            if (mouse != null) {
                mouseDelta[0] += newMouse[0] - mouse[0];
                mouseDelta[1] += newMouse[1] - mouse[1];
            }
            mouse = newMouse;
        }
    });
}

async function initWebGPU()
{
    if (!navigator) {
        alert("Your browser doesn't support WebGPU (navigator is null)");
        return;
    }

    if (!navigator.gpu) {
        alert("Your browser doesn't support WebGPU (navigator.gpu is null)");
        return;
    }

    const adapter = await navigator.gpu?.requestAdapter();

    if (!adapter) {
        alert("Your browser doesn't support WebGPU (failed to create adapter)");
        return;
    }

    device = await adapter?.requestDevice({});

    if (!device) {
        alert("Your browser doesn't support WebGPU (failed to create device)");
        return;
    }

    context = canvas.getContext('webgpu');
    surfaceFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: surfaceFormat,
    });

    console.log("Initialized WebGPU, surface format:", surfaceFormat);
}

function initVoxelTypes()
{
    voxelTypesBuffer = device.createBuffer({
        label: "voxelTypes",
        size: 4 * 256,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });

    const voxelTypes = new Uint32Array(256);
    // In 0xAABBGGRR format
    // RGB is raw color (albedo / emission)
    // A is 0 for diffuse and 255 for emissive
    voxelTypes[0] = 0x00000000; // zero is always empty space, the value is meaningless
    voxelTypes[1] = 0x00c0c0c0; // light-grey diffuse
    voxelTypes[2] = 0xff2060ff; // orange emissive

    device.queue.writeBuffer(voxelTypesBuffer, 0, voxelTypes);
}

function initBuffers()
{
    initVoxelTypes();

    renderUniformsBuffer = device.createBuffer({
        label: "renderUniforms",
        size: renderUniformsBufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
}

function initTestMap()
{
    voxelsTexture = device.createTexture({
        dimension: '3d',
        format: 'r8uint',
        size: [256, 256, 256],
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    })

    voxelsTextureView = voxelsTexture.createView({});

    const testMap = new Uint8Array(256 * 256 * 256);

    testMap.fill(2);

    for (var i = 0; i < testMap.length; i += 1) {
        const x = ((i >>  0) & 255);
        const y = ((i >>  8) & 255);
        const z = ((i >> 16) & 255);

        testMap[i] = 0;
        const l = Math.sqrt((x - 128) * (x - 128) + (y - 128) * (y - 128));
        if (z <= 120 + (8 + 8 * Math.cos(l * 0.25)) / (1 + l * 0.01)) {
            testMap[i] = 1;
            if (z == 120) {
                testMap[i] = 2;
            }
        }
    }

    if (false) {
        // For some reason this loads just the first layer :/
        device.queue.writeTexture(
            { texture: voxelsTexture },
            testMap,
            { bytesPerRow: 256, rowsPerImage: 256 },
            { width: 256, height: 256, depthOrArraySlices: 256 }
        );
    }

    for (var i = 0; i < 256; i += 1) {
        device.queue.writeTexture(
            { texture: voxelsTexture, origin: [0, 0, i] },
            testMap,
            { offset: 256 * 256 * i, bytesPerRow: 256, rowsPerImage: 256 },
            { width: 256, height: 256 }
        );
    }

    console.log("Loaded test map");
}

async function initTextures()
{
    initTestMap();

    blueNoiseTexture = await loadTexture("/webgpu/blue-noise.png", 'rgba8unorm-srgb', GPUTextureUsage.TEXTURE_BINDING);
    blueNoiseTextureView = blueNoiseTexture.createView({});
}

function initBindGroups()
{
    voxelsBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { // Voxel types buffer
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: {
                    type: 'read-only-storage',
                },
            },
            { // Voxels texture
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: 'uint',
                    viewDimension: '3d',
                },
            },
        ],
    });

    voxelsBindGroup = device.createBindGroup({
        layout: voxelsBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: voxelTypesBuffer,
            },
            {
                binding: 1,
                resource: voxelsTextureView,
            },
        ],
    });

    renderUniformsBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: {
                    type: 'uniform',
                    minBindingSize: renderUniformsBufferSize,
                },
            },
        ],
    });

    renderUniformsBindGroup = device.createBindGroup({
        layout: renderUniformsBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: renderUniformsBuffer,
            },
        ],
    })

    composeBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {},
            },
            {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {},
            },
        ],
    });
}

async function initShaderModules()
{
    renderDirectRaytraceShaderModule = await loadShaderModule("shaders/render-direct-raytrace.wgsl");
	composeShaderModule = await loadShaderModule("shaders/compose.wgsl");
}

function initPipelines()
{
    renderDirectRaytracePipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [
                voxelsBindGroupLayout,
                renderUniformsBindGroupLayout,
            ],
        }),
        vertex: {
            module: renderDirectRaytraceShaderModule,
            entryPoint: 'vertexMain',
        },
        primitive: {
            topology: 'triangle-list',
        },
        fragment: {
            module: renderDirectRaytraceShaderModule,
            entryPoint: 'fragmentMain',
            targets: [
                {
                    format: hdrFormat,
                    blend: {
                        color: {
                            srcFactor: 'src-alpha',
                            dstFactor: 'one-minus-src-alpha',

                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                        },
                    },
                },
            ],
        }
    });

    composePipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [
                composeBindGroupLayout,
            ],
        }),
        vertex: {
            module: composeShaderModule,
            entryPoint: 'vertexMain',
        },
        primitive: {
            topology: 'triangle-list',
        },
        fragment: {
            module: composeShaderModule,
            entryPoint: 'fragmentMain',
            targets: [
                {
                    format: surfaceFormat,
                },
            ],
        }
    });
}

export function resize()
{
    if (!canvas || !device) {
        return;
    }

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    camera.xfov = 2.0 * Math.atan(Math.tan(camera.yfov / 2.0) * canvas.width / canvas.height);

    hdrTexture = device.createTexture({
        format: hdrFormat,
        size: [canvas.width, canvas.height, 1],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    hdrTextureView = hdrTexture.createView({});

    composeBindGroup = device.createBindGroup({
        layout: composeBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: hdrTextureView,
            },
            {
                binding: 1,
                resource: blueNoiseTextureView,
            },
        ],
    });

    console.log(`Resized to ${canvas.width}x${canvas.height}`);
}

export async function init()
{
    initCanvas();
    await initWebGPU();
    initBuffers();
    await initTextures();
    initBindGroups();
    await initShaderModules();
    initPipelines();
    resize();
    redraw();
}

function redraw()
{
    if (framesInFlight > 3) {
        requestAnimationFrame(redraw);
        return;
    }

    const now = window.performance.now() / 1000.0;

    const dt = now - lastFrameTimestamp;
    lastFrameTimestamp = now;

    const lastFrameViewProjectionMatrix = cameraProjectionMatrix(camera).mult(cameraViewMatrix(camera)).transpose();

    const pointerLocked = (document.pointerLockElement == canvas);

    if (pointerLocked) {
        const cameraRotationSpeed = 0.004;
        camera.xangle -= mouseDelta[0] * cameraRotationSpeed;
        camera.yangle += mouseDelta[1] * cameraRotationSpeed;

        const cameraSpeed = 64.0;
        let cameraMovement = [0.0, 0.0, 0.0];
        if (keydown.has('a')) {
            cameraMovement[0] -= 1.0;
        }
        if (keydown.has('d')) {
            cameraMovement[0] += 1.0;
        }
        if (keydown.has('s')) {
            cameraMovement[1] -= 1.0;
        }
        if (keydown.has('w')) {
            cameraMovement[1] += 1.0;
        }

        let cameraRight = [Math.cos(camera.xangle), Math.sin(camera.xangle), 0.0];
        let cameraForward = [-Math.sin(camera.xangle) * Math.cos(camera.yangle), Math.cos(camera.xangle) * Math.cos(camera.yangle), -Math.sin(camera.yangle)];
        let cameraUp = [0.0, 0.0, 1.0];

        camera.position[0] += (cameraRight[0] * cameraMovement[0] + cameraForward[0] * cameraMovement[1] + cameraUp[0] * cameraMovement[2]) * dt * cameraSpeed;
        camera.position[1] += (cameraRight[1] * cameraMovement[0] + cameraForward[1] * cameraMovement[1] + cameraUp[1] * cameraMovement[2]) * dt * cameraSpeed;
        camera.position[2] += (cameraRight[2] * cameraMovement[0] + cameraForward[2] * cameraMovement[1] + cameraUp[2] * cameraMovement[2]) * dt * cameraSpeed;
    }

    mouseDelta = [0, 0];

    const renderUniforms = new ArrayBuffer(renderUniformsBufferSize);
    {
        const renderUniformsFloat = new Float32Array(renderUniforms);
        const renderUniformsUint = new Uint32Array(renderUniforms);

        const viewProjectionMatrix = cameraProjectionMatrix(camera).mult(cameraViewMatrix(camera)).transpose();
        const viewProjectionInverseMatrix = viewProjectionMatrix.inverse();
        for (var i = 0; i < 16; i += 1)
            renderUniformsFloat[i] = viewProjectionMatrix.values[i];
        for (var i = 0; i < 16; i += 1)
            renderUniformsFloat[i + 16] = viewProjectionInverseMatrix.values[i];
        for (var i = 0; i < 16; i += 1)
            renderUniformsFloat[i + 32] = lastFrameViewProjectionMatrix.values[i];
        for (var i = 0; i < 3; i += 1)
            renderUniformsFloat[i + 48] = camera.position[i];

        renderUniformsUint[51] = frameID;
    }

    device.queue.writeBuffer(renderUniformsBuffer, 0, renderUniforms);
 
    const encoder = device.createCommandEncoder({});

    const mainPass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: hdrTextureView,
                clearValue: [0.0, 0.0, 0.0, 1.0],
                loadOp: 'load',
                storeOp: 'store',
            },
        ],
    });
    mainPass.setBindGroup(0, voxelsBindGroup);
    mainPass.setBindGroup(1, renderUniformsBindGroup);
    mainPass.setPipeline(renderDirectRaytracePipeline);
    mainPass.draw(3);
    mainPass.end();
 
    const composeRenderPass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: context.getCurrentTexture().createView(),
                clearValue: [0.0, 0.0, 0.0, 1.0],
                loadOp: 'clear',
                storeOp: 'store',
            },
        ],
    });
    composeRenderPass.setBindGroup(0, composeBindGroup);
    composeRenderPass.setPipeline(composePipeline);
    composeRenderPass.draw(3);
    composeRenderPass.end();
 
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    ++framesInFlight;
    device.queue.onSubmittedWorkDone().then(() => { --framesInFlight; });

    ++frameID;
    requestAnimationFrame(redraw);
}
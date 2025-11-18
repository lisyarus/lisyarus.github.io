import { Matrix4 } from './math.js';

// WebGPU base stuff

var canvas;
var device;
var context;
var surfaceFormat;
var timestampQuerySupported;

// Constants

const hdrFormat = 'rgba16float';
const renderUniformsBufferSize = 224;

const diffuseProbeSize = 64;
const diffuseProbesTableSize = 1048576;

const renderMode = 'probes';
const integrateProbesIterations = 1;

// Buffers

var voxelTypesBuffer;

var diffuseProbesCountBuffer;
var diffuseProbesCountMapBuffer;
var diffuseProbesBuffer;
var diffuseProbesFreeBuffer;
var diffuseProbesRecycleCountBuffer;
var diffuseProbesRecycleBuffer;
var diffuseProbesRecycleWorkgroupCountBuffer;

var renderUniformsBuffer;

var performanceResolveBuffer;
var performanceMapBuffer;

// Query sets

var performanceQuerySet;

// Textures

// TODO: replace with sparse wide (4x4x4) octree
var voxelsTexture;
var voxelsTextureView;
var voxelProbeIndexBuffer;

var blueNoiseTexture;
var blueNoiseTextureView;

var hdrTexture;
var hdrTextureView;

// Bind groups

var voxelsBindGroupLayout;
var voxelsBindGroup;

var probesBindGroupLayout;
var probesBindGroup;

var probesRecyclePrepareBindGroupLayout;
var probesRecyclePrepareBindGroup;

var renderUniformsBindGroupLayout;
var renderUniformsBindGroup;

var composeBindGroupLayout;
var composeBindGroup;

// Shader modules

var renderDirectRaytraceShaderModule;
var renderProbesShaderModule;
var diffuseProbesRecycleShaderModule;
var diffuseProbesIntegrateShaderModule;
var composeShaderModule;

// Pipelines

var renderDirectRaytracePipeline;
var renderProbesPipeline;
var diffuseProbesRecyclePreparePipeline;
var diffuseProbesRecyclePipeline;
var diffuseProbesIntegratePipeline;
var composePipeline;

// Frame management

var frameID = 0;
var framesInFlight = 0;

var debugInfo = {};

var waitingForDiffuseProbesCount = false;
var waitingForPerformanceQuery = false;

// Event state

var lastFrameTimestamp = window.performance.now() / 1000.0;
var keydown = new Set();
var trackedKeys = new Set(['a', 'd', 's', 'w']);
var mouse = null;
var mouseDelta = [0, 0];

// Camera

// var camera = {
//     position: [128, -200, 64],
//     xangle: 0,
//     yangle: 0,
//     xfov: Math.PI / 2,
//     yfov: Math.PI / 2,
// };

var camera = {
    position: [32, 4, 48],
    xangle: - Math.PI * 0.2,
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

async function loadShaderCode(path, included)
{
    const response = await fetch("shaders/" + path);
    if (!response.ok) {
        throw new Error("Failed to load shader " + path);
    }
    var shaderCode = await response.text();

    while (true) {
        const index = shaderCode.indexOf("%include ");
        if (index == -1)
            break;

        const end = shaderCode.indexOf("\n", index + 9);
        if (end == -1) {
            break;
        }

        const includePath = shaderCode.substring(index + 9, end);

        if (included.has(includePath)) {
            shaderCode = shaderCode.substring(0, index) + shaderCode.substring(end);
        } else {
            included.add(includePath);
            const includedCode = await loadShaderCode(includePath, included);
            shaderCode = shaderCode.substring(0, index) + includedCode + shaderCode.substring(end);
        }
    }

    return shaderCode;
}

async function loadShaderModule(path)
{
    const included = new Set();
    const shaderCode = await loadShaderCode(path, included);
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

    timestampQuerySupported = adapter.features.has('timestamp-query');
    console.log("Timestamp query supported:", timestampQuerySupported);

    var requiredFeatures = [];

    if (timestampQuerySupported) {
        requiredFeatures.push('timestamp-query');
    }

    device = await adapter?.requestDevice({
        requiredLimits: {
            // maxBufferSize: diffuseProbeSize * diffuseProbesTableSize,
            // maxStorageBufferBindingSize: diffuseProbeSize * diffuseProbesTableSize,
        },
        requiredFeatures: requiredFeatures,
    });

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
    // A is 0 mode: 0 for diffuse, 1 for emissive
    voxelTypes[0] = 0x00000000; // zero is always empty space, the value is meaningless
    voxelTypes[1] = 0x00c0c0c0; // light-grey diffuse
    voxelTypes[2] = 0x012060ff; // orange emissive

    device.queue.writeBuffer(voxelTypesBuffer, 0, voxelTypes);
}

function initBuffers()
{
    initVoxelTypes();

    diffuseProbesCountBuffer = device.createBuffer({
        label: "diffuseProbesCount",
        size: 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
    });

    diffuseProbesCountMapBuffer = device.createBuffer({
        label: "diffuseProbesCountMapped",
        size: 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    diffuseProbesBuffer = device.createBuffer({
        label: "diffuseProbes",
        size: diffuseProbeSize * diffuseProbesTableSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });

    diffuseProbesFreeBuffer = device.createBuffer({
        label: "diffuseProbesFree",
        size: 4 * diffuseProbesTableSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });

    diffuseProbesRecycleCountBuffer = device.createBuffer({
        label: "diffuseProbesRecycleCount",
        size: 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });

    diffuseProbesRecycleBuffer = device.createBuffer({
        label: "diffuseProbesRecycle",
        size: 4 * diffuseProbesTableSize,
        usage: GPUBufferUsage.STORAGE,
    });

    diffuseProbesRecycleWorkgroupCountBuffer = device.createBuffer({
        label: "diffuseProbesRecycleWorkgroupCount",
        size: 12,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
    });

    const diffuseProbesCountInit = new Uint32Array(1);
    diffuseProbesCountInit.fill(0);
    device.queue.writeBuffer(diffuseProbesCountBuffer, 0, diffuseProbesCountInit);

    const diffuseProbesInit = new Uint32Array(diffuseProbeSize * diffuseProbesTableSize / 4);
    diffuseProbesInit.fill(0xffffffff);
    device.queue.writeBuffer(diffuseProbesBuffer, 0, diffuseProbesInit);

    const diffuseProbesFreeInit = new Uint32Array(diffuseProbesTableSize);
    for (var i = 0; i < diffuseProbesTableSize; i += 1) {
        diffuseProbesFreeInit[i] = i;
    }
    device.queue.writeBuffer(diffuseProbesFreeBuffer, 0, diffuseProbesFreeInit);

    renderUniformsBuffer = device.createBuffer({
        label: "renderUniforms",
        size: renderUniformsBufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    if (timestampQuerySupported) {
        performanceResolveBuffer = device.createBuffer({
            label: "performanceResolve",
            size: 48,
            usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.QUERY_RESOLVE,
        });

        performanceMapBuffer = device.createBuffer({
            label: "performanceMap",
            size: 48,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
    }
}

function initQuerySets()
{
    if (timestampQuerySupported) {
        performanceQuerySet = device.createQuerySet({
            label: "performance",
            count: 6,
            type: "timestamp",
        });
    }
}

function initTestMap()
{
    voxelsTexture = device.createTexture({
        label: "voxels",
        dimension: '3d',
        format: 'r8uint',
        size: [256, 256, 256],
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    })

    voxelsTextureView = voxelsTexture.createView({});

    voxelProbeIndexBuffer = device.createBuffer({
        label: "voxelsProbeIndex",
        size: 256 * 256 * 256 * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    })

    const testMap = new Uint8Array(256 * 256 * 256);

    testMap.fill(0);

    for (var i = 0; i < testMap.length; i += 1) {
        const x = ((i >>  0) & 255);
        const y = ((i >>  8) & 255);
        const z = ((i >> 16) & 255);

        const dx = x - 128;
        const dy = y - 128;
        const dz = z - 64;
        const d = Math.max(Math.abs(dx), Math.abs(dy));

        testMap[i] = 0;

        if (z == 0) {
            testMap[i] = 1;
        }

        if (dx >= -4 && dx <= 3 && dy >= -4 && dy <= 3 && z <= 31 + 48) {
            testMap[i] = 2;
        }

        if (dx >= -4-32 && dx <= 3-32 && dy >= -8 && dy <= 7 && z <= 31 + 48) {
            testMap[i] = 1;
        }

        if (dx >= -4+32 && dx <= 3+32 && dy >= -8 && dy <= 7 && z <= 31 + 48) {
            testMap[i] = 1;
        }

        if ((x == 0 || x == 255 || y == 0 || y == 255) && z <= 31 + 64) {
            testMap[i] = 1;
        }

        // if ((d >= 63 && d <= 65) && ((Math.floor(x/2) % 4) == 0) && ((Math.floor(y/2) % 4) == 0) && z <= 31 + 64) {
        //     testMap[i] = 1;
        // }

        if (d == 64 && Math.abs(dx) == 64 && z <= 31 + 64) {
            testMap[i] = 1;
        }

        if (d >= 63 && z == 31 + 64) {
            testMap[i] = 1;
        }

        if ((x == 0 || x == 255) && Math.abs(dy) < 16 && Math.abs(dz) < 16) {
            testMap[i] = 0;
        }

        // testMap[i] = 0;
        // if (x > 0 && x < 255 && y > 0 && y < 255 && z > 0 && z < 255) {
        //     testMap[i] = 1;
        // }
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

    const voxelProbeIndexInit = new Uint32Array(256 * 256 * 256);
    voxelProbeIndexInit.fill(0xffffffff);
    device.queue.writeBuffer(voxelProbeIndexBuffer, 0, voxelProbeIndexInit);

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
                visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'read-only-storage',
                },
            },
            { // Voxels texture
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                texture: {
                    sampleType: 'uint',
                    viewDimension: '3d',
                },
            },
            { // Voxels probe index texture
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'storage',
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
            {
                binding: 2,
                resource: voxelProbeIndexBuffer,
            },
        ],
    });

    probesBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { // Diffuse probes count
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'storage',
                },
            },
            { // Diffuse probes table
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'storage',
                },
            },
            { // Diffuse probes free list
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'storage',
                },
            },
            { // Diffuse probes recycle count
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'storage',
                },
            },
            { // Diffuse probes recycle list
                binding: 4,
                visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'storage',
                },
            },
        ],
    });

    probesBindGroup = device.createBindGroup({
        layout: probesBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: diffuseProbesCountBuffer,
            },
            {
                binding: 1,
                resource: diffuseProbesBuffer,
            },
            {
                binding: 2,
                resource: diffuseProbesFreeBuffer,
            },
            {
                binding: 3,
                resource: diffuseProbesRecycleCountBuffer,
            },
            {
                binding: 4,
                resource: diffuseProbesRecycleBuffer,
            },
        ],
    });

    probesRecyclePrepareBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { // Probes recycle workgroup count
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'storage',
                },
            },
        ],
    });

    probesRecyclePrepareBindGroup = device.createBindGroup({
        layout: probesRecyclePrepareBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: diffuseProbesRecycleWorkgroupCountBuffer,
            },
        ],
    });

    renderUniformsBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
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
    renderDirectRaytraceShaderModule = await loadShaderModule("render-direct-raytrace.wgsl");
    renderProbesShaderModule = await loadShaderModule("render-probes.wgsl");
    diffuseProbesRecycleShaderModule = await loadShaderModule("diffuse-probes-recycle.wgsl");
    diffuseProbesIntegrateShaderModule = await loadShaderModule("diffuse-probes-integrate.wgsl");
	composeShaderModule = await loadShaderModule("compose.wgsl");
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

    renderProbesPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [
                voxelsBindGroupLayout,
                probesBindGroupLayout,
                renderUniformsBindGroupLayout,
            ],
        }),
        vertex: {
            module: renderProbesShaderModule,
            entryPoint: 'vertexMain',
        },
        primitive: {
            topology: 'triangle-list',
        },
        fragment: {
            module: renderProbesShaderModule,
            entryPoint: 'fragmentMain',
            targets: [
                {
                    format: hdrFormat,
                },
            ],
        }
    });

    diffuseProbesRecyclePreparePipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [
                probesBindGroupLayout,
                probesRecyclePrepareBindGroupLayout,
            ],
        }),
        compute: {
            module: diffuseProbesRecycleShaderModule,
            entryPoint: 'recyclePrepare',
        },
    });

    diffuseProbesRecyclePipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [
                probesBindGroupLayout,
            ],
        }),
        compute: {
            module: diffuseProbesRecycleShaderModule,
            entryPoint: 'recycleMain',
        },
    });

    diffuseProbesIntegratePipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [
                voxelsBindGroupLayout,
                probesBindGroupLayout,
                renderUniformsBindGroupLayout,
            ],
        }),
        compute: {
            module: diffuseProbesIntegrateShaderModule,
            entryPoint: 'integrateMain',
        },
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
    initQuerySets();
    await initTextures();
    initBindGroups();
    await initShaderModules();
    initPipelines();
    resize();

    console.log("Initialized");

    redraw();
}

function formatExecutionTime(x) {
    var result = (Number(x) / 1000000).toFixed(2);
    while (result.length < 5) {
        result = " " + result;
    }
    return result + " ms";
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

        const cameraSpeed = 256.0;
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

        // const skyColor = [0.01, 0.02, 0.04, 1.0];
        // const skyColor = [0.1, 0.2, 0.3, 1.0];
        const skyColor = [0.4, 0.7, 1.0, 1.0];
        // const skyColor = [1.0, 1.0, 1.0, 1.0];
        for (var i = 0; i < 4; i += 1)
            renderUniformsFloat[i + 52] = skyColor[i];
    }

    device.queue.writeBuffer(renderUniformsBuffer, 0, renderUniforms);

    device.queue.writeBuffer(diffuseProbesRecycleCountBuffer, 0, (new Uint32Array(1)).fill(0));
 
    const encoder = device.createCommandEncoder({});

    if (renderMode == 'direct-raytrace') {
        const mainPass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: hdrTextureView,
                    clearValue: [0.0, 0.0, 0.0, 1.0],
                    loadOp: 'load',
                    storeOp: 'store',
                },
            ],
            ...(timestampQuerySupported) && { timestampWrites: {
                querySet: performanceQuerySet,
                beginningOfPassWriteIndex: 2,
                endOfPassWriteIndex: 3,
            }},
        });
        mainPass.setBindGroup(0, voxelsBindGroup);
        mainPass.setBindGroup(1, renderUniformsBindGroup);
        mainPass.setPipeline(renderDirectRaytracePipeline);
        mainPass.draw(3);
        mainPass.end();
    }

    if (renderMode == 'probes') {
        for (var i = 0; i < integrateProbesIterations; i += 1) {
            const integrateProbesPass = encoder.beginComputePass({
                ...(timestampQuerySupported) && { timestampWrites: {
                    querySet: performanceQuerySet,
                    beginningOfPassWriteIndex: 0,
                    endOfPassWriteIndex: 1,
                }},
            });
            integrateProbesPass.setBindGroup(0, voxelsBindGroup);
            integrateProbesPass.setBindGroup(1, probesBindGroup);
            integrateProbesPass.setBindGroup(2, renderUniformsBindGroup);
            integrateProbesPass.setPipeline(diffuseProbesIntegratePipeline);
            integrateProbesPass.dispatchWorkgroups(diffuseProbesTableSize / 64);
            integrateProbesPass.end();
        }

        const mainPass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: hdrTextureView,
                    clearValue: [0.0, 0.0, 0.0, 1.0],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
            ...(timestampQuerySupported) && { timestampWrites: {
                querySet: performanceQuerySet,
                beginningOfPassWriteIndex: 2,
                endOfPassWriteIndex: 3,
            }},
        });
        mainPass.setBindGroup(0, voxelsBindGroup);
        mainPass.setBindGroup(1, probesBindGroup);
        mainPass.setBindGroup(2, renderUniformsBindGroup);
        mainPass.setPipeline(renderProbesPipeline);
        mainPass.draw(3);
        mainPass.end();

        const recycleProbesPass = encoder.beginComputePass({});
        recycleProbesPass.setBindGroup(0, probesBindGroup);
        recycleProbesPass.setBindGroup(1, probesRecyclePrepareBindGroup);
        recycleProbesPass.setPipeline(diffuseProbesRecyclePreparePipeline);
        recycleProbesPass.dispatchWorkgroups(1);
        recycleProbesPass.setPipeline(diffuseProbesRecyclePipeline);
        recycleProbesPass.dispatchWorkgroupsIndirect(diffuseProbesRecycleWorkgroupCountBuffer, 0);
        recycleProbesPass.end();
    }
 
    const composeRenderPass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: context.getCurrentTexture().createView(),
                clearValue: [0.0, 0.0, 0.0, 1.0],
                loadOp: 'clear',
                storeOp: 'store',
            },
        ],
        ...(timestampQuerySupported) && { timestampWrites: {
            querySet: performanceQuerySet,
            beginningOfPassWriteIndex: 4,
            endOfPassWriteIndex: 5,
        }},
    });
    composeRenderPass.setBindGroup(0, composeBindGroup);
    composeRenderPass.setPipeline(composePipeline);
    composeRenderPass.draw(3);
    composeRenderPass.end();

    var needMapDiffuseProbesCount = false;
    var needMapPerformanceQuery = false;

    if (!waitingForDiffuseProbesCount) {
        waitingForDiffuseProbesCount = true;
        encoder.copyBufferToBuffer(diffuseProbesCountBuffer, diffuseProbesCountMapBuffer);
        needMapDiffuseProbesCount = true;
    }

    if (!waitingForPerformanceQuery && timestampQuerySupported) {
        waitingForPerformanceQuery = true;
        encoder.resolveQuerySet(performanceQuerySet, 0, 6, performanceResolveBuffer, 0);
        encoder.copyBufferToBuffer(performanceResolveBuffer, performanceMapBuffer);
        needMapPerformanceQuery = true;
    }
 
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    if (needMapDiffuseProbesCount) {
        diffuseProbesCountMapBuffer.mapAsync(GPUMapMode.READ).then(
            () => {
                let count = new Uint32Array(diffuseProbesCountMapBuffer.getMappedRange());
                debugInfo.diffuseProbes = count[0];
                diffuseProbesCountMapBuffer.unmap();
                waitingForDiffuseProbesCount = false;
            },
            (error) => {
                debugInfo.diffuseProbes = error;
                waitingForDiffuseProbesCount = false;
            }
        );
    }

    if (needMapPerformanceQuery) {
        performanceMapBuffer.mapAsync(GPUMapMode.READ).then(
            () => {
                let count = new BigUint64Array(performanceMapBuffer.getMappedRange());
                debugInfo.integrateTime = formatExecutionTime(count[1] - count[0]);
                debugInfo.renderTime = formatExecutionTime(count[3] - count[2]);
                debugInfo.composeTime = formatExecutionTime(count[5] - count[4]);
                performanceMapBuffer.unmap();
                waitingForPerformanceQuery = false;
            },
            (error) => {
                debugInfo.frameTime = error;
                waitingForPerformanceQuery = false;
            }
        );
    }

    var debugText = "";
    debugText += "Diffuse probes: " + debugInfo.diffuseProbes + "\n";
    debugText += "Integrate: " + debugInfo.integrateTime + "\n";
    debugText += "Render:    " + debugInfo.renderTime + "\n";
    debugText += "Compose:   " + debugInfo.composeTime + "\n";
    document.getElementById("debugInfo").innerText = debugText;

    ++framesInFlight;
    device.queue.onSubmittedWorkDone().then(() => { --framesInFlight; });

    ++frameID;
    requestAnimationFrame(redraw);
}
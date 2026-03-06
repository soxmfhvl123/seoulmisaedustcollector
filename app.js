import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

// --- UI Elements ---
const tempEl = document.getElementById('tempValue');
const windEl = document.getElementById('windValue');
const conditionEl = document.getElementById('conditionText');
const iconEl = document.getElementById('conditionIcon');

// --- Ethereal Rendering Setup ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
// No floor, pure dark void for glowing effect
scene.background = new THREE.Color(0x020306);
scene.fog = new THREE.FogExp2(0x020306, 0.012);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 20); // Zoomed in closer to Z=20

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); // Enabled antialias for wireframe mode
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.localClippingEnabled = true; // Required for GPU slicing the left tree
// Additive blending works best in raw linear or basic sRGB, let's keep SRGB
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI; // Full rotation around
controls.minDistance = 0.1; // Allow going inside
controls.maxDistance = 100;
controls.enablePan = true; // Enabled panning as requested
controls.target.set(0, 0, 0); // Target center of tree


// --- Post Processing (Glow / Bloom) ---
const renderScene = new RenderPass(scene, camera);

// Tighter, dimmer bloom to prevent the points from looking blown out and highly emissive
const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.6,  // Strength (reduced from 1.0 to cut emission glow in half)
    0.1,  // Radius (tighter)
    0.2   // Threshold (higher threshold so only the brightest stack of points glow)
);

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);


// --- Particle Texture Generation ---
function createGlowingDot() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Soft radial gradient for ethereal blur without sharp edges
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
}
const dotTexture = createGlowingDot();


// --- Loading FBX & Converting to Point Cloud ---
const aqiPalettes = {
    'GOOD': { // 0~15 μg/m³
        base: new THREE.Color('#0544ff'),
        leaves: [new THREE.Color('#4a00e0'), new THREE.Color('#00ccff'), new THREE.Color('#0088ff'), new THREE.Color('#eeffff')]
    },
    'MODERATE': { // 16~35 μg/m³
        base: new THREE.Color('#006622'),
        leaves: [new THREE.Color('#00e676'), new THREE.Color('#69f0ae'), new THREE.Color('#b9f6ca'), new THREE.Color('#00c853')]
    },
    'BAD': { // 36~75 μg/m³
        base: new THREE.Color('#cc6600'),
        leaves: [new THREE.Color('#ffaa00'), new THREE.Color('#ffd54f'), new THREE.Color('#fff9c4'), new THREE.Color('#ff8f00')]
    },
    'VERY_BAD': { // 76+ μg/m³
        base: new THREE.Color('#880011'),
        leaves: [new THREE.Color('#ff0055'), new THREE.Color('#ff5252'), new THREE.Color('#ffbbee'), new THREE.Color('#d50000')]
    }
};

let treeGeo; // Declare globally for AQI updates
let treePointsGenerated = 0;
let currentPM25 = 0; // Default Good
let currentRenderMode = 'points';
let solidTreeObject;
let matWireframe;
let baseCutPlane, activeCutPlane;
let currentWeatherType = 'CLEAR';

function applyTreeColors() {
    if (!treeGeo) return; // Wait until loaded

    let level = 'GOOD';
    if (currentPM25 >= 16 && currentPM25 <= 35) level = 'MODERATE';
    else if (currentPM25 >= 36 && currentPM25 <= 75) level = 'BAD';
    else if (currentPM25 >= 76) level = 'VERY_BAD';

    const pal = aqiPalettes[level];
    const positions = treeGeo.attributes.position.array;
    const colors = treeGeo.attributes.color.array;

    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < treePointsGenerated; i++) {
        const y = positions[i * 3 + 1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const heightRange = Math.max(0.1, maxY - minY);

    for (let i = 0; i < treePointsGenerated; i++) {
        const y = positions[i * 3 + 1];
        let heightFactor = (y - minY) / heightRange;
        heightFactor = Math.pow(heightFactor, 1.5);

        let c = pal.base.clone();
        if (heightFactor > 0.15) {
            const leafC = pal.leaves[Math.floor(Math.random() * pal.leaves.length)].clone();
            c.lerp(leafC, (heightFactor - 0.15) * 1.5);

            if (Math.random() > 0.85) {
                c.r += 0.2; c.g += 0.2; c.b += 0.2;
            } else if (Math.random() > 0.5) {
                c.r += 0.05; c.g += 0.05; c.b += 0.05;
            } else {
                c.r -= 0.1; c.g -= 0.1; c.b -= 0.1;
            }
        } else {
            if (Math.random() > 0.9) {
                c.r += 0.2; c.g += 0.2; c.b += 0.2;
            }
        }

        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
    }

    treeGeo.attributes.color.needsUpdate = true;

    // Update alternative Solid/Mesh materials
    if (matWireframe) matWireframe.color.copy(pal.base);
}

let treeMat; // Declare shader material broadly for animation loop
const loader = new FBXLoader();
loader.load('fbx.FBX', (object) => {

    // Normalize scale and center the FBX automatically
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Target height is 25 units
    const maxDim = size.y;
    const targetScale = 25.0 / (maxDim === 0 ? 1 : maxDim);

    object.scale.set(targetScale, targetScale, targetScale);
    object.position.x = -center.x * targetScale;
    object.position.y = -center.y * targetScale; // Base at 0
    object.position.z = -center.z * targetScale;
    object.updateMatrixWorld(true);

    solidTreeObject = new THREE.Group();
    solidTreeObject.add(object);
    scene.add(solidTreeObject);
    solidTreeObject.visible = false; // Hidden by default

    // We want 500k to 1M points scattered across the mesh
    const targetPointCount = 800000;
    const positions = new Float32Array(targetPointCount * 3);
    const colors = new Float32Array(targetPointCount * 3);

    // The FBX may have multiple parts
    const meshes = [];
    object.traverse((child) => {
        if (child.isMesh) meshes.push(child);
    });

    // Create a combined sampler or sample from each mesh
    // We will distribute the 800k points evenly across the meshes
    let pointsGenerated = 0;
    const pointsPerMesh = Math.floor(targetPointCount / Math.max(1, meshes.length));

    const tempPosition = new THREE.Vector3();
    const tempNormal = new THREE.Vector3();

    meshes.forEach((mesh) => {
        // Need to ensure Transform is applied for accurately placed surface samples
        mesh.updateMatrixWorld(true);

        const sampler = new MeshSurfaceSampler(mesh)
            .setWeightAttribute('uv')
            .build();

        for (let i = 0; i < pointsPerMesh; i++) {
            sampler.sample(tempPosition, tempNormal);
            // Convert to world space to respect FBX scaling/transforms
            tempPosition.applyMatrix4(mesh.matrixWorld);

            // MAGIC FIX: Drop points that belong to the left tree (X < 0)
            // since the pair of trees was auto-centered at 0
            if (tempPosition.x < 0) continue;

            // Apply slight offset along normal for "fuzz" volume
            if (Math.random() > 0.6) {
                tempPosition.add(tempNormal.multiplyScalar((Math.random() - 0.5) * 0.4));
            }

            positions[pointsGenerated * 3] = tempPosition.x;
            positions[pointsGenerated * 3 + 1] = tempPosition.y;
            positions[pointsGenerated * 3 + 2] = tempPosition.z;

            // Colors will be generated dynamically by applyTreeColors later
            colors[pointsGenerated * 3] = 1;
            colors[pointsGenerated * 3 + 1] = 1;
            colors[pointsGenerated * 3 + 2] = 1;

            pointsGenerated++;
        }
    });

    // NOW re-center the remaining right tree to exactly 0,0,0
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < pointsGenerated; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }
    const offsetX = (minX + maxX) / 2;
    const offsetY = (minY + maxY) / 2;
    const offsetZ = (minZ + maxZ) / 2;

    for (let i = 0; i < pointsGenerated; i++) {
        positions[i * 3] -= offsetX;
        positions[i * 3 + 1] -= offsetY;
        positions[i * 3 + 2] -= offsetZ;
    }

    // Align the solid meshes with the point cloud center by shifting the underlying child
    const innerModel = solidTreeObject.children[0];
    innerModel.position.x -= offsetX;
    innerModel.position.y -= offsetY;
    innerModel.position.z -= offsetZ;

    // MAGIC FIX 2: Since the FBX contains two trees, cull the left one visually using a GPU clipping plane
    // We create a base plane in local coordinates (X = -offsetX separates them perfectly through the gap) and update it every frame
    // In the group's local space, the normal of the separation plane is (1,0,0) and constant is offsetX 
    baseCutPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), offsetX);
    activeCutPlane = new THREE.Plane();
    activeCutPlane.copy(baseCutPlane);

    // Setup alternative rendering materials
    matWireframe = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.15, // reduced opacity to look better
        blending: THREE.AdditiveBlending,
        clippingPlanes: [activeCutPlane]
    });

    treePointsGenerated = pointsGenerated;
    treeGeo = new THREE.BufferGeometry();
    treeGeo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, pointsGenerated * 3), 3));
    treeGeo.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, pointsGenerated * 3), 3));

    // Apply dynamic AQI colors immediately after geo is built
    applyTreeColors();

    treeMat = new THREE.PointsMaterial({
        size: 0.35, // Reduced particle size from 0.45 
        map: dotTexture,
        vertexColors: true,
        transparent: true,
        opacity: 0.45, // Halved emission
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    treeMat.onBeforeCompile = (shader) => {
        shader.uniforms.time = { value: 0 };
        shader.vertexShader = `
            uniform float time;
            ${shader.vertexShader}
        `.replace(
            `#include <begin_vertex>`,
            `
            #include <begin_vertex>
            transformed.x += sin(position.y * 0.5 + time) * 0.2;
            transformed.z += cos(position.x * 0.5 + time) * 0.2;
            transformed.y += sin(position.z * 0.5 + time * 1.5) * 0.05;
            `
        );
        treeMat.userData.shader = shader;
    };

    // Replace old mesh
    const treeMesh = new THREE.Points(treeGeo, treeMat);
    treeMesh.name = "ParticleTree"; // Rename for toggle logic
    scene.add(treeMesh);

}, undefined, (e) => {
    console.error("Failed to load FBX:", e);
});




// --- Weather Particle Systems ---
const rainCount = 15000;
const rainGeo = new THREE.BufferGeometry();
const rainPositions = new Float32Array(rainCount * 3);
for (let i = 0; i < rainCount; i++) {
    rainPositions[i * 3] = (Math.random() - 0.5) * 100;
    rainPositions[i * 3 + 1] = Math.random() * 60;
    rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 100;
}
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
const rainMat = new THREE.PointsMaterial({
    color: 0x44aaff,
    size: 0.05,
    map: dotTexture,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
const rainSystem = new THREE.Points(rainGeo, rainMat);
rainSystem.visible = false;
scene.add(rainSystem);

const snowCount = 20000;
const snowGeo = new THREE.BufferGeometry();
const snowPositions = new Float32Array(snowCount * 3);
for (let i = 0; i < snowCount; i++) {
    snowPositions[i * 3] = (Math.random() - 0.5) * 100;
    snowPositions[i * 3 + 1] = Math.random() * 60;
    snowPositions[i * 3 + 2] = (Math.random() - 0.5) * 100;
}
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
const snowMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.25,
    map: dotTexture,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
const snowSystem = new THREE.Points(snowGeo, snowMat);
snowSystem.visible = false;
scene.add(snowSystem);


// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const delta = (now - (animate.lastTime || now)) / 1000;
    animate.lastTime = now;
    const elapsedTime = now / 1000;

    controls.update();

    if (treeMat && treeMat.userData.shader) {
        treeMat.userData.shader.uniforms.time.value = elapsedTime;
    }

    // Slowly rotate the loaded trees to the right continuously
    const pointsMesh = scene.getObjectByName("ParticleTree");
    if (pointsMesh) pointsMesh.rotation.y += 0.05 * delta;
    if (solidTreeObject) {
        solidTreeObject.rotation.y += 0.05 * delta;
        solidTreeObject.updateMatrixWorld(true);
        if (activeCutPlane && baseCutPlane) {
            // Because Plane application transforms the math equation itself,
            // copying the base plane and applying the group's global matrix keeps it exactly attached
            activeCutPlane.copy(baseCutPlane).applyMatrix4(solidTreeObject.matrixWorld);
        }
    }

    if (rainSystem.visible) {
        const positions = rainSystem.geometry.attributes.position.array;
        for (let i = 0; i < rainCount; i++) {
            positions[i * 3 + 1] -= 40 * delta;
            if (positions[i * 3 + 1] < 0) {
                positions[i * 3 + 1] = 60;
            }
        }
        rainSystem.geometry.attributes.position.needsUpdate = true;
    }

    if (snowSystem.visible) {
        const positions = snowSystem.geometry.attributes.position.array;
        for (let i = 0; i < snowCount; i++) {
            positions[i * 3 + 1] -= 3 * delta;
            positions[i * 3] += Math.sin(elapsedTime + i) * 1.5 * delta;
            if (positions[i * 3 + 1] < 0) {
                positions[i * 3 + 1] = 60;
            }
        }
        snowSystem.geometry.attributes.position.needsUpdate = true;
    }

    // Render using post-processing composer for the bloom effects
    composer.render();
}
animate();


// --- Responsive ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});


// --- Live Weather (Seoul) ---
function getWeatherType(code) {
    if (code === 0) return { type: 'CLEAR', text: 'Clear Sky', icon: '✨' };
    if ([1, 2, 3].includes(code)) return { type: 'CLOUDY', text: 'Partly Cloudy', icon: '🌌' };
    if ([45, 48].includes(code)) return { type: 'FOG', text: 'Foggy', icon: '🌫️' };
    if ([51, 53, 55, 56, 57].includes(code)) return { type: 'RAIN', text: 'Drizzle', icon: '🌧️' };
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { type: 'RAIN', text: 'Heavy Rain', icon: '🌧️' };
    if ([71, 73, 75, 77, 85, 86].includes(code)) return { type: 'SNOW', text: 'Snow Fall', icon: '❄️' };
    if ([95, 96, 99].includes(code)) return { type: 'THUNDER', text: 'Thunderstorm', icon: '⛈️' };
    return { type: 'CLEAR', text: 'Unknown', icon: '🌍' };
}

async function fetchSeoulWeather() {
    try {
        const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m,wind_speed_10m,weather_code&timezone=Asia%2FSeoul';
        const aqiUrl = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=37.5665&longitude=126.9780&current=pm10,pm2_5&timezone=Asia%2FSeoul';

        const [weatherRes, aqiRes] = await Promise.all([
            fetch(weatherUrl),
            fetch(aqiUrl)
        ]);

        const data = await weatherRes.json();
        const aqiData = await aqiRes.json();

        const current = data.current;
        tempEl.innerHTML = `${Math.round(current.temperature_2m)}&deg;`;
        windEl.innerHTML = `${current.wind_speed_10m} m/s`;

        if (aqiData && aqiData.current) {
            document.getElementById('pm10Value').innerHTML = `${aqiData.current.pm10} μg/m³`;
            document.getElementById('pm25Value').innerHTML = `${aqiData.current.pm2_5} μg/m³`;

            // Trigger dynamic tree color update whenever new PM2.5 data arrives
            currentPM25 = aqiData.current.pm2_5;
            applyTreeColors();
        }

        const weatherInfo = getWeatherType(current.weather_code);
        conditionEl.innerHTML = weatherInfo.text;
        iconEl.innerHTML = weatherInfo.icon;

        applyWeatherToScene(weatherInfo.type);
    } catch (error) {
        console.error("API Fetch Error:", error);
        applyWeatherToScene('CLEAR');
    }
}

function applyWeatherToScene(type) {
    currentWeatherType = type;
    rainSystem.visible = false;
    snowSystem.visible = false;

    // Apply baseline opacity to the material
    if (treeMat) {
        if (type === 'CLEAR') treeMat.opacity = 0.5;
        else if (type === 'CLOUDY' || type === 'FOG') treeMat.opacity = 0.3;
        else treeMat.opacity = 0.5;
    }

    if (type === 'RAIN' || type === 'THUNDER') rainSystem.visible = true;
    if (type === 'SNOW') snowSystem.visible = true;

    // Only update bloom automatically if we are in points mode
    if (currentRenderMode === 'points') {
        if (type === 'CLEAR') bloomPass.strength = 0.7;
        else if (type === 'CLOUDY' || type === 'FOG') bloomPass.strength = 0.4;
        else if (type === 'RAIN' || type === 'THUNDER') bloomPass.strength = 0.5;
        else if (type === 'SNOW') bloomPass.strength = 2.5;
    }
}

// UI Menu Toggle Logic
document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('menuDropdown').classList.toggle('active');
});

document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
        document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('selected'));
        e.target.classList.add('selected');
        const mode = e.target.dataset.mode;
        setRenderMode(mode);
        document.getElementById('menuDropdown').classList.remove('active');
    });
});

function setRenderMode(mode) {
    currentRenderMode = mode;
    const pointsMesh = scene.getObjectByName("ParticleTree");
    if (!pointsMesh || !solidTreeObject) return;

    if (mode === 'points') {
        pointsMesh.visible = true;
        solidTreeObject.visible = false;
        applyWeatherToScene(currentWeatherType); // Restore bloom
    } else {
        pointsMesh.visible = false;
        solidTreeObject.visible = true;

        solidTreeObject.traverse((c) => {
            if (c.isMesh) {
                if (mode === 'wireframe') c.material = matWireframe;
            }
        });

        if (mode === 'wireframe') bloomPass.strength = 0.8;
    }
}

// Real-time Clock Update
function updateClock() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    document.getElementById('currentTime').innerText = `${hours}:${minutes}:${seconds}`;
}

fetchSeoulWeather();
setInterval(fetchSeoulWeather, 5 * 60 * 1000);

updateClock();
setInterval(updateClock, 1000);

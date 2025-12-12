import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

// --- Game Constants (High Speed) ---
const LANE_WIDTH = 6;       
const LANES = [-LANE_WIDTH, 0, LANE_WIDTH]; 
const PLAYER_RUN_HEIGHT = 1.0; 
const JUMP_HEIGHT = 5.0;
const JUMP_DURATION = 0.4; 
const SLIDE_HEIGHT = 0.3; 
const COLLISION_SLIDE_HEIGHT = 0.8; 
const RUN_SPEED_BASE = 30; // High Speed
const RUN_SPEED_INCREASE = 1.0; 
const OBSTACLE_SPAWN_Z = -300; 
const OBSTACLE_CULL_Z = 10;    
const PHASE_DURATION_SCORE = 600; 

// --- Game State Variables ---
let scene, camera, renderer, composer;
let clock = new THREE.Clock();
let gameLoopId;
let isPaused = false;
let isGameOver = false;
let currentLane = 1; 
let isJumping = false;
let jumpStartTime = 0;
let isSliding = false;
let slideStartTime = 0;
let isPunching = false;
let punchStartTime = 0;
let score = 0;
let currentSpeed = RUN_SPEED_BASE;
let obstacles = [];
let debrisParticles = []; 
let floatingParticles; 

let timeSinceLastObstacle = 0; 

// --- Collision Box ---
const playerCollisionBox = new THREE.Box3();
const playerCollisionSize = new THREE.Vector3(LANE_WIDTH * 0.8, PLAYER_RUN_HEIGHT, 1);

// --- Progression Management (UNCHANGED CORE LOGIC) ---
const PROGRESSION_STAGES = [
    { distance: 0, type: 'warmup', interval: 40 }, 
    { distance: PHASE_DURATION_SCORE * 1, type: 'jump_only', interval: 30 }, 
    { distance: PHASE_DURATION_SCORE * 2, type: 'slide_only', interval: 30 }, 
    { distance: PHASE_DURATION_SCORE * 3, type: 'dodge_only', interval: 25 }, 
    { distance: PHASE_DURATION_SCORE * 4, type: 'punch_only', interval: 30 },
    { distance: PHASE_DURATION_SCORE * 5, type: 'full_combo', interval: 20 } 
];

class ProgressionManager {
    constructor() {
        this.currentStageIndex = 0;
        this.currentStage = PROGRESSION_STAGES[0];
    }

    update(score) {
        if (this.currentStageIndex < PROGRESSION_STAGES.length - 1 && 
            score >= PROGRESSION_STAGES[this.currentStageIndex + 1].distance) {
            
            this.currentStageIndex++;
            this.currentStage = PROGRESSION_STAGES[this.currentStageIndex];
        }
    }

    getStage() {
        return this.currentStage;
    }
}

let progressionManager = new ProgressionManager();


// --- Initialization Functions ---
function initThreeJS() {
    scene = new THREE.Scene();
    // Cold Blue Sky Fog
    scene.fog = new THREE.Fog(0x87ceeb, 20, 180); 

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(LANES[currentLane], PLAYER_RUN_HEIGHT, 0);
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2; 
    document.body.appendChild(renderer.domElement);
    
    // Post-processing (Bloom - increased intensity for glow/lights)
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 2.0, 0.5, 0.9);
    bloomPass.threshold = 0.2;
    bloomPass.strength = 2.0; 
    bloomPass.radius = 0.5;
    
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

// --- Environment & Assets (Christmas Stylized Theme) ---
function createEnvironment() {
    const ROAD_LENGTH = 150; 
    const ROAD_WIDTH = LANE_WIDTH * 3 + 2;
    
    // Road Material: Icy White/Blue Look (alternating lanes)
    const roadMaterialWhite = new THREE.MeshLambertMaterial({ color: 0xeeeeee }); 
    const roadMaterialBlue = new THREE.MeshLambertMaterial({ color: 0xaaeeff }); 
    
    // Shoulder Material: Brown Earth Walls
    const shoulderMaterial = new THREE.MeshLambertMaterial({ color: 0x964b00 }); 

    for (let i = 0; i < 3; i++) {
        const chunk = new THREE.Group();
        chunk.position.z = -i * ROAD_LENGTH;
        
        // Road Surface (Alternating light/dark lanes)
        for (let l = 0; l < LANES.length; l++) {
            const laneGeo = new THREE.PlaneGeometry(LANE_WIDTH, ROAD_LENGTH);
            const laneMat = (l % 2 === 0) ? roadMaterialWhite : roadMaterialBlue;
            const laneMesh = new THREE.Mesh(laneGeo, laneMat);
            laneMesh.rotation.x = -Math.PI / 2;
            laneMesh.position.set(LANES[l], 0.01, 0);
            chunk.add(laneMesh);
        }
        
        // Side Walls (Brown Banks with stripes from image reference)
        const wallGeo = new THREE.BoxGeometry(1, 10, ROAD_LENGTH);
        const wallMeshL = new THREE.Mesh(wallGeo, shoulderMaterial);
        const wallMeshR = new THREE.Mesh(wallGeo, shoulderMaterial);
        wallMeshL.position.set(-ROAD_WIDTH / 2, 5, 0);
        wallMeshR.position.set(ROAD_WIDTH / 2, 5, 0);
        chunk.add(wallMeshL);
        chunk.add(wallMeshR);
        
        // --- Stylized Christmas Tree Assets ---
        const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6e2c00 });
        const foliageMat = new THREE.MeshLambertMaterial({ color: 0x38761d });
        
        for(let j = 0; j < 6; j++) {
            const zPos = (j * 50) - (ROAD_LENGTH * 0.5);
            
            // Trunk
            const trunkGeo = new THREE.CylinderGeometry(0.5, 0.5, 3, 8);
            const trunkL = new THREE.Mesh(trunkGeo, trunkMat);
            trunkL.position.set(-ROAD_WIDTH/2 - 2.5, 1.5, zPos);
            
            // Foliage (Stacked Cones for Tree Shape)
            const foliageGeo1 = new THREE.ConeGeometry(2, 3, 12);
            const foliageGeo2 = new THREE.ConeGeometry(3, 4, 12);
            const foliageGeo3 = new THREE.ConeGeometry(4, 5, 12);
            
            const foliageL1 = new THREE.Mesh(foliageGeo1, foliageMat);
            foliageL1.position.set(-ROAD_WIDTH/2 - 2.5, 3 + 1.5, zPos);
            const foliageL2 = new THREE.Mesh(foliageGeo2, foliageMat);
            foliageL2.position.set(-ROAD_WIDTH/2 - 2.5, 3 + 4, zPos);
            
            // Add a star at the top (Simple Glowing Light)
            const starMat = new THREE.MeshBasicMaterial({ color: 0xffff00, emissive: 0xffff00, emissiveIntensity: 5 });
            const starGeo = new THREE.DodecahedronGeometry(0.5);
            const starL = new THREE.Mesh(starGeo, starMat);
            starL.position.set(-ROAD_WIDTH/2 - 2.5, 8.5, zPos);

            chunk.add(trunkL, foliageL1, foliageL2, starL);
            
            // Duplicate for Right Side
            const trunkR = trunkL.clone();
            trunkR.position.x = ROAD_WIDTH/2 + 2.5;
            const foliageR1 = foliageL1.clone();
            foliageR1.position.x = ROAD_WIDTH/2 + 2.5;
            const foliageR2 = foliageL2.clone();
            foliageR2.position.x = ROAD_WIDTH/2 + 2.5;
            const starR = starL.clone();
            starR.position.x = ROAD_WIDTH/2 + 2.5;
            
            chunk.add(trunkR, foliageR1, foliageR2, starR);
        }

        scene.add(chunk);
    }

    scene.children.filter(c => c instanceof THREE.Group).forEach(c => {
        c.userData.type = 'RoadChunk';
    });

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    scene.add(new THREE.PointLight(0xffffff, 100).position.set(0, 10, 0));

    createFloatingParticles();
}

function createFloatingParticles() {
    // Snow Particles
    const particleCount = 1000;
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    
    for (let i = 0; i < particleCount; i++) {
        positions.push(
            (Math.random() - 0.5) * 150,
            Math.random() * 30 + 5,      
            (Math.random() - 0.5) * 300 - 150
        );
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color: 0xffffff, // White Snow
        size: 0.3,
        transparent: true,
        opacity: 0.7,
        sizeAttenuation: true,
        depthWrite: false
    });

    floatingParticles = new THREE.Points(geometry, material);
    scene.add(floatingParticles);
}

// --- Obstacle Management (Updated to Christmas Objects) ---

function createObstacle(lane, type) {
    let geometry, material, height, isBreakable = false;
    
    switch (type) {
        case 'jump': // Low Spiked Fence / Candy Cane Log (forces jump)
            geometry = new THREE.CylinderGeometry(0.5, 0.5, LANE_WIDTH * 0.8, 16);
            // Red/White Stripe Look for Candy Cane
            const canvas = document.createElement('canvas');
            canvas.width = 16; canvas.height = 16;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 8, 16);
            ctx.fillStyle = '#ffffff'; ctx.fillRect(8, 0, 8, 16);
            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.repeat.set(10, 1);
            
            material = new THREE.MeshBasicMaterial({ 
                map: texture, 
                color: 0xffffff, 
                emissive: 0xffffff, 
                emissiveIntensity: 0.5
            });
            
            height = 0.5;
            break;
            
        case 'slide': // Hanging Lights/Wreath (forces slide)
            geometry = new THREE.TorusGeometry(1, 0.2, 16, 50); // Wreath shape
            material = new THREE.MeshBasicMaterial({ 
                color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 2
            });
            height = PLAYER_RUN_HEIGHT + 2.0;
            break;
            
        case 'wall': // Giant Gift Box (forces dodge L/R)
            geometry = new THREE.BoxGeometry(LANE_WIDTH * 0.8, 2, 2); 
            material = new THREE.MeshLambertMaterial({ color: 0xdd2222 }); // Red box
            height = 1.0;
            break;
            
        case 'breakable': // Ice Wall / Gingerbread Wall (must be punched)
            geometry = new THREE.BoxGeometry(LANE_WIDTH * 0.8, 2.5, 1);
            material = new THREE.MeshBasicMaterial({ 
                color: 0xffcc99, emissive: 0xffcc99, emissiveIntensity: 3 
            });
            height = 1.25;
            isBreakable = true;
            break;
    }
    
    const mesh = new THREE.Mesh(geometry, material);
    
    if (type === 'jump') {
        mesh.rotation.z = Math.PI / 2; // Candy Cane Log lies across the lane
    }
    
    mesh.position.set(LANES[lane], height, OBSTACLE_SPAWN_Z);
    
    mesh.userData = { 
        type: 'Obstacle', 
        obstacleType: type,
        isBreakable: isBreakable,
        collided: false 
    }; 
    
    obstacles.push(mesh);
    scene.add(mesh);
}

// --- Game Logic, Player Actions, Collision, and Animation Loop (UNCHANGED CORE LOGIC) ---

function initGame() {
    clock.start();
    startGameLoop();
}

function resetGame() {
    isGameOver = false;
    isPaused = false;
    currentLane = 1;
    score = 0;
    currentSpeed = RUN_SPEED_BASE;
    
    progressionManager = new ProgressionManager(); 
    timeSinceLastObstacle = 0;
    
    camera.position.set(LANES[currentLane], PLAYER_RUN_HEIGHT, 0);
    
    obstacles.forEach(o => scene.remove(o));
    obstacles = [];
    
    debrisParticles.forEach(p => scene.remove(p));
    debrisParticles = [];

    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('score-counter').innerText = 'SCORE: 0';
    
    clock.start();
    startGameLoop();
}

function startGameLoop() {
    if (gameLoopId) cancelAnimationFrame(gameLoopId);
    animate();
}

function gameOver() {
    isGameOver = true;
    cancelAnimationFrame(gameLoopId);
    document.getElementById('final-score').innerText = `Final Score: ${Math.floor(score)}`;
    document.getElementById('game-over-screen').classList.remove('hidden');
}

function moveLane(direction) {
    if (isJumping || isGameOver) return; 
    currentLane = Math.max(0, Math.min(2, currentLane + direction));
}

function jump() {
    if (isJumping || isSliding || isGameOver) return;
    isJumping = true;
    jumpStartTime = clock.getElapsedTime();
}

function slide() {
    if (isJumping || isSliding || isGameOver) return;
    isSliding = true;
    slideStartTime = clock.getElapsedTime();
    setTimeout(() => { isSliding = false; }, 1000); 
}

function punch() {
    if (isPunching || isGameOver) return;
    isPunching = true;
    punchStartTime = clock.getElapsedTime();
    setTimeout(() => { isPunching = false; }, 300);
}

function getObstacleTypeForStage(stageType) {
    const allTypes = ['jump', 'slide', 'wall', 'breakable'];
    switch (stageType) {
        case 'warmup': return null;
        case 'jump_only': return ['jump'];
        case 'slide_only': return ['slide'];
        case 'dodge_only': return ['wall']; 
        case 'punch_only': return ['breakable'];
        case 'full_combo': return [allTypes[Math.floor(Math.random() * allTypes.length)]];
        default: return null;
    }
}

function generateObstacles(delta) {
    const currentStage = progressionManager.getStage();
    const allowedTypes = getObstacleTypeForStage(currentStage.type);
    if (!allowedTypes) return; 

    const spawnIntervalTime = currentStage.interval / currentSpeed; 
    timeSinceLastObstacle += delta;

    if (timeSinceLastObstacle < spawnIntervalTime) return;
    
    timeSinceLastObstacle = 0; 

    let blockedLanes = [];
    
    let numObstacles = (currentStage.type === 'full_combo' || currentStage.type === 'dodge_only') ? 
        (Math.random() < 0.6 ? 1 : 2) : 1;

    const laneOptions = [0, 1, 2];
    
    if (numObstacles === 2) {
        const laneToKeepOpen = laneOptions[Math.floor(Math.random() * 3)];
        blockedLanes = laneOptions.filter(l => l !== laneToKeepOpen);
    } else {
        blockedLanes = [laneOptions[Math.floor(Math.random() * 3)]];
    }
    
    const typeToSpawn = allowedTypes[Math.floor(Math.random() * allowedTypes.length)]; 

    blockedLanes.forEach(lane => {
        createObstacle(lane, typeToSpawn);
    });
}

function checkCollisions() {
    let playerY = isSliding ? SLIDE_HEIGHT : PLAYER_RUN_HEIGHT;
    let playerH = isSliding ? COLLISION_SLIDE_HEIGHT : PLAYER_RUN_HEIGHT;

    playerCollisionBox.setFromCenterAndSize(
        new THREE.Vector3(camera.position.x, playerY, camera.position.z),
        new THREE.Vector3(playerCollisionSize.x, playerH, playerCollisionSize.z)
    );

    obstacles.forEach(obstacle => {
        if (obstacle.userData.collided) return;
        
        const obstacleBox = new THREE.Box3().setFromObject(obstacle);
        
        if (playerCollisionBox.intersectsBox(obstacleBox)) {
            
            if (obstacle.userData.isBreakable && isPunching) {
                shatterWall(obstacle);
            } else if (obstacle.userData.obstacleType === 'jump' && isJumping && camera.position.y > obstacle.position.y + 0.5) {
                return; 
            } else if (obstacle.userData.obstacleType === 'slide' && isSliding && camera.position.y < obstacle.position.y - 0.5) {
                return; 
            } else {
                gameOver();
            }
            obstacle.userData.collided = true;
        }
    });
}

function shatterWall(wall) {
    scene.remove(wall);
    wall.userData.collided = true;

    const initialY = camera.position.y;
    camera.position.y += 0.5;
    setTimeout(() => { camera.position.y = initialY; }, 100);

    const particleCount = 50;
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const velocities = [];

    for (let i = 0; i < particleCount; i++) {
        positions.push(wall.position.x, wall.position.y, wall.position.z);
        velocities.push(
            (Math.random() - 0.5) * 5, 
            Math.random() * 5 + 2,     
            (Math.random() - 0.5) * 5  
        );
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.Float32BufferAttribute(velocities, 3));
    
    const material = new THREE.PointsMaterial({
        color: wall.material.color.getHex(), size: 0.2, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    });

    const particles = new THREE.Points(geometry, material);
    particles.userData.ttl = 1.0; 
    debrisParticles.push(particles);
    scene.add(particles);
}

function updateDebris(delta) {
    for (let i = debrisParticles.length - 1; i >= 0; i--) {
        const particles = debrisParticles[i];
        particles.userData.ttl -= delta;

        if (particles.userData.ttl <= 0) {
            scene.remove(particles);
            debrisParticles.splice(i, 1);
            continue;
        }

        const positions = particles.geometry.attributes.position.array;
        const velocities = particles.geometry.attributes.velocity.array;
        particles.material.opacity = particles.userData.ttl;

        for (let j = 0; j < positions.length / 3; j++) {
            positions[j * 3 + 0] += velocities[j * 3 + 0] * delta;
            positions[j * 3 + 1] += velocities[j * 3 + 1] * delta - 9.8 * delta * delta;
            positions[j * 3 + 2] += velocities[j * 3 + 2] * delta;
        }
        particles.geometry.attributes.position.needsUpdate = true;
    }
}

function animate() {
    gameLoopId = requestAnimationFrame(animate);

    if (isPaused || isGameOver) return;

    const delta = clock.getDelta();
    const elapsed = clock.getElapsedTime();
    
    currentSpeed = RUN_SPEED_BASE + Math.floor(elapsed / 10) * RUN_SPEED_INCREASE;
    
    if (isJumping) {
        const timeInJump = elapsed - jumpStartTime;
        const progress = timeInJump / JUMP_DURATION;
        
        if (progress < 1) {
            const jumpY = JUMP_HEIGHT * 4 * (progress - progress * progress);
            camera.position.y = PLAYER_RUN_HEIGHT + jumpY;
        } else {
            isJumping = false;
            camera.position.y = PLAYER_RUN_HEIGHT;
        }
    }

    if (isSliding) {
        camera.position.y = SLIDE_HEIGHT;
    } else if (!isJumping) {
        camera.position.y = PLAYER_RUN_HEIGHT;
    }
    
    const targetX = LANES[currentLane];
    camera.position.x += (targetX - camera.position.x) * 0.1;

    const distance = currentSpeed * delta;
    
    scene.children.filter(c => c.userData.type === 'RoadChunk').forEach(chunk => {
        chunk.position.z += distance;
        if (chunk.position.z >= 50) { 
            let minZ = 0;
            scene.children.filter(c => c.userData.type === 'RoadChunk').forEach(other => {
                minZ = Math.min(minZ, other.position.z);
            });
            chunk.position.z = minZ - 150; 
        }
    });

    obstacles.forEach(obstacle => { obstacle.position.z += distance; });

    for (let i = obstacles.length - 1; i >= 0; i--) {
        if (obstacles[i].position.z > OBSTACLE_CULL_Z) {
            scene.remove(obstacles[i]);
            obstacles.splice(i, 1);
        }
    }
    
    debrisParticles.forEach(p => { p.position.z += distance; });

    updateDebris(delta);
    
    if (floatingParticles) {
        const positions = floatingParticles.geometry.attributes.position.array;
        for (let i = 2; i < positions.length; i += 3) {
            positions[i] += distance * 0.5;
            if (positions[i] > 10) positions[i] = -300; 
        }
        floatingParticles.geometry.attributes.position.needsUpdate = true;
        floatingParticles.rotation.y += 0.0005;
    }

    checkCollisions();

    progressionManager.update(score);
    generateObstacles(delta);

    score += distance * 0.1; 
    document.getElementById('score-counter').innerText = `SCORE: ${Math.floor(score)}`;

    composer.render();
}

// --- Event Handlers (Unchanged) ---
document.addEventListener('keydown', (e) => {
    if (isGameOver || isPaused) return;
    switch (e.key) {
        case 'ArrowLeft': case 'a': moveLane(-1); break;
        case 'ArrowRight': case 'd': moveLane(1); break;
        case 'ArrowUp': case 'w': case ' ': jump(); break;
        case 'ArrowDown': case 's': slide(); break;
        case 'p': case 'Enter': punch(); break;
    }
});

document.getElementById('jump-button').addEventListener('click', jump);
document.getElementById('slide-button').addEventListener('click', slide);
document.getElementById('left-button').addEventListener('click', () => moveLane(-1));
document.getElementById('right-button').addEventListener('click', () => moveLane(1));
document.getElementById('punch-button').addEventListener('click', punch);
document.getElementById('restart-button').addEventListener('click', resetGame);

document.getElementById('pause-button').addEventListener('click', () => {
    isPaused = !isPaused;
    const icon = document.getElementById('pause-button').querySelector('i');
    const gameOverScreen = document.getElementById('game-over-screen');
    const restartButton = document.getElementById('restart-button');

    if (isPaused) {
        icon.classList.remove('fa-pause');
        icon.classList.add('fa-play');
        gameOverScreen.classList.remove('hidden');
        gameOverScreen.classList.add('bg-opacity-50');
        gameOverScreen.querySelector('h1').innerText = 'PAUSED';
        document.getElementById('final-score').innerText = 'Press RESUME or ESC';
        restartButton.innerText = 'RESUME';
        
        restartButton.onclick = () => {
            isPaused = false;
            gameOverScreen.classList.add('hidden');
            restartButton.onclick = resetGame; 
            icon.classList.remove('fa-play');
            icon.classList.add('fa-pause');
        };
        
    } else {
        icon.classList.remove('fa-play');
        icon.classList.add('fa-pause');
        gameOverScreen.classList.add('hidden');
        restartButton.onclick = resetGame; 
    }
});

document.addEventListener('keyup', (e) => {
     if (e.key === 'Escape') {
        document.getElementById('pause-button').click();
    }
});

// --- Kickoff (INSTANT START) ---
initThreeJS();
createEnvironment(); 
document.getElementById('game-over-screen').classList.add('hidden');
initGame();

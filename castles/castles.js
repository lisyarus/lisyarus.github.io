const isMobile = (navigator.userAgentData && navigator.userAgentData.mobile) || 'ontouchstart' in window || navigator.maxTouchPoints > 0;

const Terrain = Object.freeze({
    Grassland: 'grassland',
    Forest: 'forest',
    Beach: 'beach',
    Coast: 'coast',
    Sea: 'sea',
    Mountain: 'mountain',
    Hill: 'hill',
});

const DIAGONAL_COST = 1.5;

const MovementCost = {
    'grassland': 1.0,
    'forest': 2.0,
    'beach': 1.0,
    'hill': 2.0,
};

const TerrainIsWater = {
    'coast': true,
    'sea': true,
};

const VillageProbability = {
    'grassland': 1 / 4,
    'beach': 1 / 2,
    'forest': 1 / 16,
    'hill': 1 / 8,
};

const Resource = Object.freeze({
    Wheat: 'wheat',
    Fish: 'fish',
});

class Tile {
    constructor(terrain) {
        this.terrain = terrain;
    }
}

class Village {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
}

class Improvement {
    constructor(resource) {
        this.resource = resource;
    }
}

class PerlinNoise {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.gradients = [];

        for (let x = 0; x <= width; ++x) {
            this.gradients[x] = [];
            for (let y = 0; y <= height; ++y) {
                let angle = Math.random() * Math.PI * 2;
                this.gradients[x].push([Math.cos(angle), Math.sin(angle)]);
            }
        }
    }

    at(x, y) {
        let ix = Math.max(0, Math.min(this.width - 1, Math.floor(x)));
        let iy = Math.max(0, Math.min(this.height - 1, Math.floor(y)));

        let tx = x - ix;
        let ty = y - iy;

        function smooth(t) {
            return t * t * (3 - 2 * t);
        };

        function lerp(a, b, t) {
            return a + (b - a) * t;
        };

        let g00 = this.gradients[ix + 0][iy + 0];
        let g10 = this.gradients[ix + 1][iy + 0];
        let g01 = this.gradients[ix + 0][iy + 1];
        let g11 = this.gradients[ix + 1][iy + 1];

        let d00 = g00[0] * (tx - 0) + g00[1] * (ty - 0);
        let d10 = g10[0] * (tx - 1) + g10[1] * (ty - 0);
        let d01 = g01[0] * (tx - 0) + g01[1] * (ty - 1);
        let d11 = g11[0] * (tx - 1) + g11[1] * (ty - 1);

        return lerp(
            lerp(d00, d10, smooth(tx)),
            lerp(d01, d11, smooth(tx)),
            smooth(ty)
        );
    }
}

class PriorityQueue {
    constructor() {
        this.elements = [];
    }

    empty() {
        return this.elements.length == 0;
    }

    length() {
        return this.elements.length;
    }

    pop() {
        return this.elements.shift();
    }

    push(value, priority) {
        let element = {
            priority: priority,
            value: value
        };

        for (let i = 0; i < this.elements.length; ++i) {
            if (this.elements[i].priority > priority) {
                this.elements.splice(i, 0, element);
                return;
            }
        }

        this.elements.push(element);
    }
}

class GameState {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.tiles = [];
        this.villages = [];
        this.roads = [];

        let start = performance.now();
        this.generateTerrain();
        this.generateVillages();
        this.generateRoads();
        let end = performance.now();
        console.log(`Generated ${width}x${height} map in ${Math.round(end - start)}ms`);
    }

    generateTerrain() {
        let landNoise = new PerlinNoise(2, 2);
        let forestNoise = new PerlinNoise(4, 4);
        let hillNoise = new PerlinNoise(4, 4);
        let mountainNoise = new PerlinNoise(2, 2);
        let mountainRidgeNoise = new PerlinNoise(4, 4);

        const sampleNoise = (x, y, noise) => {
            return noise.at((x + 0.5) / this.width * noise.width, (y + 0.5) / this.height * noise.height);
        };

        for (let x = 0; x < this.width; ++x) {
            this.tiles.push([]);
            for (let y = 0; y < this.height; ++y) {
                let land = sampleNoise(x, y, landNoise);
                let forest = sampleNoise(x, y, forestNoise);
                let hill = sampleNoise(x, y, hillNoise);
                let mountain = sampleNoise(x, y, mountainNoise);
                let mountainRidge = Math.abs(sampleNoise(x, y, mountainRidgeNoise));

                this.tiles[x].push(new Tile(land < -0.1 ? Terrain.Sea : (mountain < -0.1 && mountainRidge < 0.05) ? Terrain.Mountain : forest < -0.2 ? Terrain.Forest : hill < -0.2 ? Terrain.Hill : Terrain.Grassland));
            }
        }

        for (let x = 0; x < this.width; ++x) {
            for (let y = 0; y < this.height; ++y) {
                let hasLandNeighbour = false;
                let hasWaterNeighbour = false;
                for (let tx = Math.max(0, x - 1); tx < Math.min(this.width, x + 2); ++tx)
                    for (let ty = Math.max(0, y - 1); ty < Math.min(this.height, y + 2); ++ty)
                    {
                        let terrain = this.tiles[tx][ty].terrain;
                        if (TerrainIsWater[terrain])
                            hasWaterNeighbour = true;
                        else
                            hasLandNeighbour = true;
                    }

                if (this.tiles[x][y].terrain == Terrain.Sea && hasLandNeighbour)
                    this.tiles[x][y].terrain = Terrain.Coast;

                if (TerrainIsWater[this.tiles[x][y].terrain] == null && hasWaterNeighbour)
                    this.tiles[x][y].terrain = Terrain.Beach;
            }
        }
    }

    generateVillages() {
        for (let x = 1; x < this.width - 1; ++x) {
            for (let y = 1; y < this.height - 1; ++y) {
                let probability = VillageProbability[this.tiles[x][y].terrain];
                if (probability == null)
                    continue;

                if (Math.random() > probability)
                    continue;

                const VILLAGE_SPACING = 2;

                let canPlaceVillage = true;
                for (let tx = Math.max(0, x - VILLAGE_SPACING); tx < Math.min(this.width, x + VILLAGE_SPACING + 1); ++tx)
                    for (let ty = Math.max(0, y - VILLAGE_SPACING); ty < Math.min(this.height, y + VILLAGE_SPACING + 1); ++ty)
                        canPlaceVillage &= !this.tiles[tx][ty].village;

                if (canPlaceVillage) {
                    let village = new Village(x, y);
                    this.tiles[x][y].village = village;
                    this.villages.push(village);

                    let neighboursByTerrain = {};
                    for (let tx = Math.max(0, x - 1); tx <= Math.min(this.width - 1, x + 1); ++tx) {
                        for (let ty = Math.max(0, y - 1); ty <= Math.min(this.height - 1, y + 1); ++ty) {
                            if (x == tx && y == ty) continue;

                            let terrain = this.tiles[tx][ty].terrain;
                            if (!neighboursByTerrain[terrain])
                                neighboursByTerrain[terrain] = [];
                            neighboursByTerrain[terrain].push([tx, ty]);
                        }
                    }

                    let grasslandTiles = neighboursByTerrain[Terrain.Grassland];
                    let coastTiles = neighboursByTerrain[Terrain.Coast];

                    if (coastTiles && coastTiles.length > 0) {
                        let tile = coastTiles[Math.min(coastTiles.length - 1, Math.floor(Math.random() * coastTiles.length))];
                        this.tiles[tile[0]][tile[1]].improvement = new Improvement(Resource.Fish);
                    } else if (grasslandTiles && grasslandTiles.length > 0) {
                        let tile = grasslandTiles[Math.min(grasslandTiles.length - 1, Math.floor(Math.random() * grasslandTiles.length))];
                        this.tiles[tile[0]][tile[1]].improvement = new Improvement(Resource.Wheat);
                    }
                }
            }
        }
    }

    neighbours(x, y, callback) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(this.width - 1, x + 1); ++nx) {
            for (let ny = Math.max(0, y - 1); ny <= Math.min(this.height - 1, y + 1); ++ny) {
                if (nx == x && ny == y) continue;

                const dx = nx - x;
                const dy = ny - y;

                const side = dx * dx + dy * dy - 1;

                const MOVE_TABLE = [1, DIAGONAL_COST];

                const terrain1 = this.tiles[x][y].terrain;
                const terrain2 = this.tiles[nx][ny].terrain;

                const cost1 = MovementCost[terrain1];
                const cost2 = MovementCost[terrain2];

                if (!cost1 || !cost2) continue;

                const moveCost = MOVE_TABLE[side] * (cost1 + cost2) / 2;

                callback(nx, ny, moveCost);
            }
        }
    }

    generateRoadsV1() {
        for (let i = 0; i < this.villages.length; ++i) {
            for (let j = i + 1; j < this.villages.length; ++j) {
                let cx = (this.villages[i].x + this.villages[j].x) / 2;
                let cy = (this.villages[i].y + this.villages[j].y) / 2;
                let dx = (this.villages[i].x - this.villages[j].x) / 2;
                let dy = (this.villages[i].y - this.villages[j].y) / 2;
                let r2 = dx * dx + dy * dy;

                let good = true;
                for (let k = 0; k < this.villages.length; ++k) {
                    if (k == i || k == j) continue;

                    let dx = this.villages[k].x - cx;
                    let dy = this.villages[k].y - cy;

                    if (dx * dx + dy * dy <= r2) {
                        good = false;
                        break;
                    }
                }

                if (good) {
                    let x0 = this.villages[i].x;
                    let y0 = this.villages[i].y;
                    let x1 = this.villages[j].x;
                    let y1 = this.villages[j].y;

                    let road = [[x0, y0]];

                    let dx = x1 - x0;
                    let dy = y1 - y0;

                    let x = x0 + 0.5;
                    let y = y0 + 0.5;
                    let cx = x0;
                    let cy = y0;

                    let it = 0;

                    while (cx != x1 || cy != y1) {
                        let tx = (cx + ((dx > 0) ? 1 : 0) - x) / dx;
                        let ty = (cy + ((dy > 0) ? 1 : 0) - y) / dy;

                        if ((tx < ty || dy == 0) && dx != 0) {
                            cx += (dx > 0) ? 1 : -1;
                            x += dx * tx;
                            y += dy * tx;
                        } else {
                            cy += (dy > 0) ? 1 : -1;
                            x += dx * ty;
                            y += dy * ty;
                        }

                        road.push([cx, cy]);

                        ++it;
                        if (it > 100) break;
                    }

                    if (it > 100) {
                        console.log("ERROR path from", x0, y0, "to", x1, y1);
                        continue;
                    }

                    for (let i = 0; i + 2 < road.length; ++i) {
                        let p0 = road[i];
                        let p1 = road[i + 2];

                        let dx = p1[0] - p0[0];
                        let dy = p1[1] - p0[1];

                        if (Math.abs(dx) == 1 && Math.abs(dy) == 1) {
                            road.splice(i + 1, 1);
                        }
                    }

                    let passable = true;
                    for (let i = 0; i < road.length; ++i) {
                        let terrain = this.tiles[road[i][0]][road[i][1]].terrain;
                        if (MovementCost[terrain] == null) {
                            passable = false;
                            break;
                        }
                    }
                    if (!passable)
                        continue;

                    for (let i = 0; i + 1 < road.length; ++i) {
                        let segment = [road[i], road[i + 1]];
                        let alreadyExists = false;
                        for (let other of this.roads) {
                            if (segment[0][0] == other[0][0] && segment[0][1] == other[0][1] && segment[1][0] == other[1][0] && segment[1][1] == other[1][1]) {
                                alreadyExists = true;
                                break;
                            }
                            if (segment[0][0] == other[1][0] && segment[0][1] == other[1][1] && segment[1][0] == other[0][0] && segment[1][1] == other[0][1]) {
                                alreadyExists = true;
                                break;
                            }
                        }
                        if (!alreadyExists)
                            this.roads.push([road[i], road[i + 1]]);
                    }
                }
            }
        }
    }

    generateRoadsV2() {
        let voronoiMap = new Array(this.width);
        for (let x = 0; x < this.width; ++x) {
            voronoiMap[x] = new Array(this.height);
            for (let y = 0; y < this.height; ++y) {
                voronoiMap[x][y] = {
                    visited: false,
                    village: null,
                    distance: 1/0,
                };
            }
        }

        let shouldConnect = new Map();
        for (let village of this.villages) {
            shouldConnect.set(village, new Map());
        }

        let queue = new PriorityQueue();
        for (let village of this.villages) {
            queue.push([village.x, village.y, village], 0);
        }

        while (!queue.empty()) {
            let next = queue.pop();
            let tile = next.value;
            let distance = next.priority;

            let data = voronoiMap[tile[0]][tile[1]];
            if (data.visited) continue;

            data.visited = true;
            data.village = tile[2];

            this.neighbours(tile[0], tile[1], (nx, ny, moveCost) => {
                let ndata = voronoiMap[nx][ny];

                const ndistance = distance + moveCost;

                if (ndata.visited) {
                    if (data.village != ndata.village) {
                        shouldConnect.get(data.village).set(ndata.village, true);
                        shouldConnect.get(ndata.village).set(data.village, true);
                    }
                    return;
                }

                if (ndata.distance <= ndistance)
                    return;

                ndata.parent = [tile[0], tile[1]];
                ndata.distance = ndistance;
                queue.push([nx, ny, tile[2]], ndistance);
            });
        }

        let roadMeets = [];

        let connected = new Map();
        for (let village of this.villages) {
            connected.set(village, new Map());
        }

        for (let village1 of this.villages) {
            for (let village2 of this.villages) {
                if (village1 == village2) continue;

                if (!shouldConnect.get(village1).get(village2))
                    continue;

                if (connected.get(village1).get(village2))
                    continue;

                if (connected.get(village2).get(village1))
                    continue;

                connected.get(village1).set(village2, true);
                connected.get(village2).set(village1, true);

                let tileData = new Array(this.width);
                for (let x = 0; x < this.width; ++x) {
                    tileData[x] = new Array(this.height);
                    for (let y = 0; y < this.height; ++y) {
                        tileData[x][y] = {
                            visited: false,
                            parent: null,
                            distance: 1/0,
                        };
                    }
                }

                let queue = new PriorityQueue();
                queue.push([village1.x, village1.y], 0);

                while (!queue.empty()) {
                    let next = queue.pop();
                    let tile = next.value;
                    let distance = next.priority;

                    let data = tileData[tile[0]][tile[1]];

                    if (tile[0] == village2.x && tile[1] == village2.y) {
                        while (true) {
                            let p = data.parent;
                            if (!p) break;

                            this.roads.push([[tile[0], tile[1]], [p[0], p[1]]]);
                            tile = p;
                            data = tileData[tile[0]][tile[1]];
                        }

                        break;
                    }

                    data.visited = true;

                    this.neighbours(tile[0], tile[1], (nx, ny, moveCost) => {
                        let ndata = tileData[nx][ny];

                        const ndistance = distance + moveCost;

                        if (ndata.visited) {
                            return;
                        }

                        if (ndata.distance <= ndistance)
                            return;

                        ndata.parent = [tile[0], tile[1]];
                        ndata.distance = ndistance;
                        queue.push([nx, ny], ndistance);
                    });
                }
            }
        }

        for (let village of this.villages) {
            village.color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        }

        for (let x = 0; x < this.width; ++x) {
            for (let y = 0; y < this.height; ++y) {
                if (!voronoiMap[x][y].village) continue;
                this.tiles[x][y].color = voronoiMap[x][y].village.color;
                this.tiles[x][y].distance = voronoiMap[x][y].distance;
            }
        }
    }

    generateRoads() {
        for (let i = 0; i < this.villages.length; ++i) {
            for (let j = i + 1; j < this.villages.length; ++j) {
                let cx = (this.villages[i].x + this.villages[j].x) / 2;
                let cy = (this.villages[i].y + this.villages[j].y) / 2;
                let dx = (this.villages[i].x - this.villages[j].x) / 2;
                let dy = (this.villages[i].y - this.villages[j].y) / 2;
                let r2 = dx * dx + dy * dy;

                let good = true;
                for (let k = 0; k < this.villages.length; ++k) {
                    if (k == i || k == j) continue;

                    let dx = this.villages[k].x - cx;
                    let dy = this.villages[k].y - cy;

                    if (dx * dx + dy * dy <= r2) {
                        good = false;
                        break;
                    }
                }

                if (!good)
                    continue;

                let x0 = this.villages[i].x;
                let y0 = this.villages[i].y;
                let x1 = this.villages[j].x;
                let y1 = this.villages[j].y;

                let tileData = new Array(this.width);
                for (let x = 0; x < this.width; ++x) {
                    tileData[x] = new Array(this.height);
                    for (let y = 0; y < this.height; ++y) {
                        tileData[x][y] = {
                            visited: false,
                            parent: null,
                            distance: 1/0,
                        };
                    }
                }

                let queue = new PriorityQueue();
                queue.push([x0, y0], 0);

                while (!queue.empty()) {
                    let next = queue.pop();
                    let tile = next.value;
                    let distance = next.priority;

                    let data = tileData[tile[0]][tile[1]];

                    if (tile[0] == x1 && tile[1] == y1) {
                        while (true) {
                            let p = data.parent;
                            if (!p) break;

                            this.roads.push([[tile[0], tile[1]], [p[0], p[1]]]);
                            tile = p;
                            data = tileData[tile[0]][tile[1]];
                        }

                        break;
                    }

                    data.visited = true;

                    this.neighbours(tile[0], tile[1], (nx, ny, moveCost) => {
                        let ndata = tileData[nx][ny];

                        const ndistance = distance + moveCost;

                        if (ndata.visited) {
                            return;
                        }

                        if (ndata.distance <= ndistance)
                            return;

                        ndata.parent = [tile[0], tile[1]];
                        ndata.distance = ndistance;
                        queue.push([nx, ny], ndistance);
                    });
                }

                // for (let i = 0; i + 1 < road.length; ++i) {
                //     let segment = [road[i], road[i + 1]];
                //     let alreadyExists = false;
                //     for (let other of this.roads) {
                //         if (segment[0][0] == other[0][0] && segment[0][1] == other[0][1] && segment[1][0] == other[1][0] && segment[1][1] == other[1][1]) {
                //             alreadyExists = true;
                //             break;
                //         }
                //         if (segment[0][0] == other[1][0] && segment[0][1] == other[1][1] && segment[1][0] == other[0][0] && segment[1][1] == other[0][1]) {
                //             alreadyExists = true;
                //             break;
                //         }
                //     }
                //     if (!alreadyExists)
                //         this.roads.push([road[i], road[i + 1]]);
                // }
            }
        }
    }
}

const TILE_WIDTH = 32;
const TILE_HEIGHT = 16;

class DisplayState {
    constructor(state) {
        this.state = state;
        this.gridOrigin = null;
        this.selectedTile = null;
        this.mouse = [0, 0];
    }

    setMouse(x, y) {
        this.mouse = [x, y];

        if (!this.gridOrigin)
            return;

        let rx = x - this.gridOrigin[0];
        let ry = y - this.gridOrigin[1];
        this.relativeMouse = [rx, ry];

        const gridSpace = [
            Math.floor(rx / TILE_WIDTH + ry / TILE_HEIGHT),
            Math.floor(rx / TILE_WIDTH - ry / TILE_HEIGHT),
        ];

        if (0 <= gridSpace[0] && gridSpace[0] < this.state.width && 0 <= gridSpace[1] && gridSpace[1] < this.state.height) {
            this.selectedTile = gridSpace;
        } else {
            this.selectedTile = null;
        }
    }
}

class Assets {
    constructor() {
        this.timeStarted = performance.now();
        this.imagesRequested = 0;
        this.imagesLoaded = 0;

        this.tileOutline = this.loadImage('tile_outline.png');
        this.tileOutlineSelected = this.loadImage('tile_outline_selected.png');
        this.tileSkirt = this.loadImage('tile_skirt.png');
        this.tileGrassland = this.loadImage('tile_grassland.png');
        this.tileForest = this.loadImage('tile_forest.png');
        this.tileBeach = this.loadImage('tile_beach.png');
        this.tileCoast = this.loadImage('tile_coast.png');
        this.tileSea = this.loadImage('tile_sea.png');
        this.tileMountain = this.loadImage('tile_mountain.png');
        this.tileHill = this.loadImage('tile_hill.png');
        this.tileVillage = this.loadImage('tile_village.png');
        this.tileWheat = this.loadImage('tile_wheat.png');
        this.tileFishing = this.loadImage('tile_fishing.png');
        this.tileFlax = this.loadImage('tile_flax.png');
        this.tileVineyard = this.loadImage('tile_vineyard.png');

        this.road = {};
        this.road[0] = this.loadImage('road_se.png');
        this.road[1] = this.loadImage('road_e.png');
        this.road[2] = this.loadImage('road_ne.png');
        this.road[3] = this.loadImage('road_n.png');
        this.road[4] = this.loadImage('road_nw.png');
        this.road[5] = this.loadImage('road_w.png');
        this.road[6] = this.loadImage('road_sw.png');
        this.road[7] = this.loadImage('road_s.png');

        this.tileBaseImage = {
            'grassland': this.tileGrassland,
            'forest': this.tileGrassland,
            'beach': this.tileBeach,
            'coast': this.tileCoast,
            'sea': this.tileSea,
        };

        this.tileOverlayImage = {
            'forest': this.tileForest,
            'mountain': this.tileMountain,
            'hill': this.tileHill,
        };

        this.improvementImage = {
            'wheat': this.tileWheat,
            'fish': this.tileFishing,
        };
    }

    loadImage(url) {
        ++this.imagesRequested;
        const image = new Image();
        image.src = url;
        image.onload = () => {
            ++this.imagesLoaded;
            if (this.imagesLoaded >= this.imagesRequested) {
                let loadingTime = performance.now() - this.timeStarted;
                console.log(`Loaded ${this.imagesLoaded} images in ${Math.round(loadingTime)}ms`);
            }
        };
        return image;
    }

    roadImage(dx, dy) {
        if (dx == -1) {
            if (dy == -1) {
                return this.road[5];
            } else if (dy == 0) {
                return this.road[4];
            } else if (dy == 1) {
                return this.road[3];
            }
        } else if (dx == 0) {
            if (dy == -1) {
                return this.road[6];
            } else if (dy == 1) {
                return this.road[2];
            }
        } else if (dx == 1) {
            if (dy == -1) {
                return this.road[7];
            } else if (dy == 0) {
                return this.road[0];
            } else if (dy == 1) {
                return this.road[1];
            }
        }
    }
}

class Renderer {
    constructor(canvas, zoom) {
        this.canvas = canvas;
        this.zoom = zoom;
        this.dpr = window.devicePixelRatio || 1;
        this.scale = this.zoom * this.dpr;

        this.assets = new Assets();

        this.resize();
    }

    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width * this.dpr;
        this.canvas.height = this.height * this.dpr;
    }

    render(state, displayState) {
        const ctx = canvas.getContext('2d');
        ctx.reset();
        ctx.imageSmoothingEnabled = (this.zoom < 1);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(this.scale, this.scale);

        const viewportWidth = this.width / this.zoom;
        const viewportHeight = this.height / this.zoom;

        const viewportCenterX = Math.round(viewportWidth / 2);
        const viewportCenterY = Math.round(viewportHeight / 2);

        const gridWidth = (state.width + state.height) * TILE_WIDTH / 2 + 2;
        const gridHeight = (state.width + state.height) * TILE_HEIGHT / 2 + 1;

        const gridLeft = viewportCenterX - Math.round(gridWidth / 2);
        const gridCenterY = viewportCenterY;

        displayState.gridOrigin = [gridLeft, gridCenterY];

        const tileCenter = (x, y) => {
            const tileCenterX = gridLeft + (x + y + 1) * TILE_WIDTH / 2;
            const tileCenterY = gridCenterY + (x - y) * TILE_HEIGHT / 2;
            return [tileCenterX, tileCenterY];
        };

        const drawTileImage = (x, y, image) => {
            const center = tileCenter(x, y);
            ctx.drawImage(image, Math.floor(center[0] - image.width / 2), Math.floor(center[1] - image.height / 2));
        };

        for (let x = 0; x < state.width; ++x) {
            for (let y = state.height - 1; y >= 0; --y) {
                if (y == 0 || (x + 1 == state.width))
                    drawTileImage(x, y, this.assets.tileSkirt);

                const image = this.assets.tileBaseImage[state.tiles[x][y].terrain];
                if (image)
                    drawTileImage(x, y, image);
            }
        }

        for (let x = 0; x < state.width; ++x) {
            for (let y = state.height - 1; y >= 0; --y) {
                drawTileImage(x, y, this.assets.tileOutline);
            }
        }

        for (let x = 0; x < state.width; ++x) {
            for (let y = state.height - 1; y >= 0; --y) {
                let tile = state.tiles[x][y];
                const image = this.assets.tileOverlayImage[tile.terrain];
                if (image)
                    drawTileImage(x, y, image);

                if (tile.improvement) {
                    drawTileImage(x, y, this.assets.improvementImage[tile.improvement.resource]);
                }
            }
        }

        for (let road of state.roads) {
            let dx = road[1][0] - road[0][0];
            let dy = road[1][1] - road[0][1];
            drawTileImage(road[0][0], road[0][1], this.assets.roadImage( dx,  dy));
            drawTileImage(road[1][0], road[1][1], this.assets.roadImage(-dx, -dy));
        }

        for (let village of state.villages) {
            drawTileImage(village.x, village.y, this.assets.tileVillage);
        }

        // for (let x = 0; x < state.width; ++x) {
        //     for (let y = state.height - 1; y >= 0; --y) {
        //         if (!state.tiles[x][y].color) continue;
        //         let p = tileCenter(x, y);

        //         // ctx.strokeStyle = state.tiles[x][y].color;
        //         // ctx.beginPath();
        //         // ctx.arc(p[0], p[1], 8, 0, Math.PI * 2);
        //         // ctx.stroke();

        //         ctx.font = 'bold 10px Arial';
        //         ctx.textAlign = 'center';
        //         ctx.textBaseline = 'middle';
        //         ctx.fillStyle = state.tiles[x][y].color;
        //         // ctx.fillText(`${state.tiles[x][y].distance}`, p[0], p[1]);
        //     }
        // }
        
        if (displayState.selectedTile)
            drawTileImage(displayState.selectedTile[0], displayState.selectedTile[1], this.assets.tileOutlineSelected);
    }
}

class CastlesApp {
    constructor(canvas) {
        this.state = new GameState(25, 25);
        this.displayState = new DisplayState(this.state);
        this.renderer = new Renderer(canvas, isMobile ? 1 : 2);
    }

    resize() {
        this.renderer.resize();
    }

    mousemove(event) {
        this.displayState.setMouse(event.clientX / this.renderer.zoom, event.clientY / this.renderer.zoom);
    }

    mouseclick(event) {

    }

    update(dt) {

    }

    redraw() {
        this.renderer.render(this.state, this.displayState);
    }
}

var app = null;

var lastUpdateTime = performance.now();

function onFrame() {
    if (!app) return;

    const now = performance.now();
    const dt = (now - lastUpdateTime) / 1000;
    lastUpdateTime = now;

    app.update(dt);
    app.redraw();

    window.requestAnimationFrame(onFrame);
}

function init() {
    let canvas = document.getElementById('canvas');
    app = new CastlesApp(canvas);

    window.addEventListener('resize', event => app.resize());
    window.addEventListener('mousemove', event => app.mousemove(event));
    window.addEventListener('click', event => app.mouseclick(event));

    app.redraw();
    onFrame();
}
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import MVT from 'ol/format/MVT';
import { Projection } from 'ol/proj';
import TileQueue from 'ol/TileQueue';
import { getTilePriority as tilePriorityFunction } from 'ol/TileQueue';
import { renderDeclutterItems } from 'ol/render';
import styleFunction from 'ol-mapbox-style/dist/stylefunction';
import { inView } from 'ol/layer/Layer';
import stringify from 'json-stringify-safe';
import TileGrid from 'ol/tilegrid/TileGrid';
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4';
import { get as getProjection, getTransform } from 'ol/proj';


proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs");
proj4.defs("EPSG:3067", "+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
register(proj4);


/** @type {any} */
const worker = self;

let frameState, pixelRatio, rendererTransform;
const canvas = new OffscreenCanvas(1, 1);
// OffscreenCanvas does not have a style, so we mock it
canvas.style = {};
const context = canvas.getContext('2d');

let epsg = 'EPSG:3067', maxZoom=14,extent =
  [-548576, 6291456, 1548576, 8388608],
  projection = getProjection(epsg),
  resolutions = [8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1, 0.5],
  tileGrid = new TileGrid({
    extent: extent,
    resolutions: resolutions,
    tileSize: [256, 256]
  });

projection.setExtent(extent);


const sources = {
  taustakartta: new VectorTileSource({
    projection: projection,
    tileGrid: tileGrid,
    minZoom: 1,
    maxZoom: maxZoom,
    format: new MVT(),
    url: 'https://beta-karttakuva.maanmittauslaitos.fi/vt/backgroundmap/wmts/1.0.0/taustakartta/default/v20/ETRS-TM35FIN/{z}/{y}/{x}.pbf'
  })
};
const layers = [];

// Font replacement so we do not need to load web fonts in the worker
function getFont(font) {
  return 'sans-serif';
  /*return font[0]
    .replace('Noto Sans', 'sans-serif')
    .replace('Roboto', 'sans-serif');*/
}


function loadStyles() {
  const styleUrl = 'https://raw.githubusercontent.com/nls-jajuko/beta-karttakuva.maanmittauslaitos.fi/master/vectortiles/hobby/hobby-3067.json';

  fetch(styleUrl).then(data => data.json()).then(styleJson => {


    const buckets = [];
    let currentSource;
    styleJson.layers.forEach(layer => {
      if (!layer.source) {
        return;
      }
      if (currentSource !== layer.source) {
        currentSource = layer.source;
        buckets.push({
          source: layer.source,
          layers: []
        });
      }
      buckets[buckets.length - 1].layers.push(layer.id);
    });


    const spriteUrl = styleJson.sprite + (pixelRatio > 1 ? '@2x' : '') + '.json';
    const spriteImageUrl = styleJson.sprite + (pixelRatio > 1 ? '@2x' : '') + '.png';
    fetch(spriteUrl).then(data => data.json()).then(spriteJson => {
      buckets.forEach(bucket => {
        const source = sources[bucket.source];
        if (!source) {
          return;
        }
        const layer = new VectorTileLayer({
          declutter: true,
          source,
          tileGrid: tileGrid,
          projection: projection,
          minZoom: 1,
          maxZoom: maxZoom
        });
        layer.getRenderer().useContainer = function (target, transform) {
          this.containerReused = this.getLayer() !== layers[0];
          this.canvas = canvas;
          this.context = context;
          this.container = {
            firstElementChild: canvas
          };
          rendererTransform = transform;
        };
        styleFunction(layer, styleJson, bucket.layers, resolutions, spriteJson, spriteImageUrl, getFont);
        layers.push(layer);
      });
      worker.postMessage({ action: 'requestRender' });
    });
  });
}

// Minimal map-like functionality for rendering

const tileQueue = new TileQueue(
  (tile, tileSourceKey, tileCenter, tileResolution) => tilePriorityFunction(frameState, tile, tileSourceKey, tileCenter, tileResolution),
  () => worker.postMessage({ action: 'requestRender' }));

const maxTotalLoading = 8;
const maxNewLoads = 2;

worker.addEventListener('message', event => {
  if (event.data.action !== 'render') {
    return;
  }
  frameState = event.data.frameState;
  if (!pixelRatio) {
    pixelRatio = frameState.pixelRatio;
    loadStyles();
  }
  frameState.tileQueue = tileQueue;
  frameState.viewState.projection.__proto__ = Projection.prototype;
  layers.forEach(layer => {
    if (inView(layer.getLayerState(), frameState.viewState)) {
      const renderer = layer.getRenderer();
      renderer.renderFrame(frameState, canvas);
    }
  });
  renderDeclutterItems(frameState, null);
  if (tileQueue.getTilesLoading() < maxTotalLoading) {
    tileQueue.reprioritize();
    tileQueue.loadMoreTiles(maxTotalLoading, maxNewLoads);
  }
  const imageData = canvas.transferToImageBitmap();
  worker.postMessage({
    action: 'rendered',
    imageData: imageData,
    transform: rendererTransform,
    frameState: JSON.parse(stringify(frameState))
  }, [imageData]);
});


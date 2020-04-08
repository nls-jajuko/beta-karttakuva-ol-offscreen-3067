import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import Layer from 'ol/layer/Layer';
import { fromLonLat, Projection } from 'ol/proj';
import { compose, create } from 'ol/transform';
import { createTransformString } from 'ol/render/canvas';
import { createXYZ } from 'ol/tilegrid';
import { FullScreen } from 'ol/control';
import stringify from 'json-stringify-safe';
import Source from 'ol/source/Source';
import proj4 from 'proj4';
import { get as getProjection, getTransform } from 'ol/proj';
import { register } from 'ol/proj/proj4';

proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs");
proj4.defs("EPSG:3067", "+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
register(proj4);


var worker = new Worker('./worker-nls.js');

var container, transformContainer, canvas, rendering, workerFrameState, mainThreadFrameState;

// Transform the container to account for the differnece between the (newer)
// main thread frameState and the (older) worker frameState
function updateContainerTransform() {
  if (workerFrameState) {
    var viewState = mainThreadFrameState.viewState;
    var renderedViewState = workerFrameState.viewState;
    var center = viewState.center;
    var resolution = viewState.resolution;
    var rotation = viewState.rotation;
    var renderedCenter = renderedViewState.center;
    var renderedResolution = renderedViewState.resolution;
    var renderedRotation = renderedViewState.rotation;
    var transform = create();
    // Skip the extra transform for rotated views, because it will not work
    // correctly in that case
    if (!rotation) {
      compose(transform,
        (renderedCenter[0] - center[0]) / resolution,
        (center[1] - renderedCenter[1]) / resolution,
        renderedResolution / resolution, renderedResolution / resolution,
        rotation - renderedRotation,
        0, 0);
    }
    transformContainer.style.transform = createTransformString(transform);
  }
}

var epsg = 'EPSG:3067',
  center = [384920, 6671856],
  projection = getProjection('EPSG:3067'),
  resolutions = [8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1, 0.5];



var map = new Map({
  layers: [
    new Layer({
      render: function (frameState) {
        if (!container) {
          container = document.createElement('div');
          container.style.position = 'absolute';
          container.style.width = '100%';
          container.style.height = '100%';
          transformContainer = document.createElement('div');
          transformContainer.style.position = 'absolute';
          transformContainer.style.width = '100%';
          transformContainer.style.height = '100%';
          container.appendChild(transformContainer);
          canvas = document.createElement('canvas');
          canvas.style.position = 'absolute';
          canvas.style.left = '0';
          canvas.style.transformOrigin = 'top left';
          transformContainer.appendChild(canvas);
        }
        mainThreadFrameState = frameState;
        updateContainerTransform();
        if (!rendering) {
          rendering = true;
          worker.postMessage({
            action: 'render',
            frameState: JSON.parse(stringify(frameState))
          });
        } else {
          frameState.animate = true;
        }
        return container;
      },
      source: new Source({
        attributions: [
          '<a href="https://maanmittauslaitos.fi" target="_blank">© Maanmittauslaitos</a>'
        ]
      })
    })
  ],
  target: 'map',
  view: new View({
    projection: projection,
    resolutions: resolutions,
    center: center,
    zoom: 10
  })
});
map.addControl(new FullScreen());

// Worker messaging and actions
worker.addEventListener('message', function (message) {
  if (message.data.action === 'loadImage') {
    // Image loader for ol-mapbox-style
    var image = new Image();
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', function () {
      createImageBitmap(image, 0, 0, image.width, image.height).then(function (imageBitmap) {
        worker.postMessage({
          action: 'imageLoaded',
          image: imageBitmap,
          src: message.data.src
        }, [imageBitmap]);
      });
    });
    image.src = event.data.src;
  } else if (message.data.action === 'requestRender') {
    // Worker requested a new render frame
    map.render();
  } else if (canvas && message.data.action === 'rendered') {
    // Worker provies a new render frame
    requestAnimationFrame(function () {
      var imageData = message.data.imageData;
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      canvas.getContext('2d').drawImage(imageData, 0, 0);
      canvas.style.transform = message.data.transform;
      workerFrameState = message.data.frameState;
      updateContainerTransform();
    });
    rendering = false;
  }
});


'use strict'; // eslint-disable-line strict

const os = require('os');
const path = require('path');
const mkdirp = require('mkdirp');
const childProcess = require('child_process');
const RawSource = require('webpack-sources').RawSource;
const cache = require('./cache');
const tmpFile = require('./tmp-file');

function createWorkers(count) {
  const workers = [];
  while (workers.length < count) {
    const worker = childProcess.fork(path.join(__dirname, './worker.js'));
    worker.setMaxListeners(100);
    workers.push(worker);
  }
  return workers;
}

/**
 * Determines how many workers to create.
 * Should be available cpus minus 1.
 */
function workerCount() {
  return Math.max(1, os.cpus().length - 1);
}

/**
 * Minify an asset.  This attempts to read from the cache first, but if a cached version isn't found
 * it sends a request to the worker to minify.  It may make more sense for the worker to handle
 * the cache, but sending the full source over ipc is expensive. Reading from disk is much faster.
 */
const usedCacheKeys = [];
function minify(batch, worker, options) {
  worker.send({
    'minify',
    batch,
    options,
  });

  worker.on('message', msg => {
    const minifiedBatch = msg.minifiedBatch;
    resolve(minifiedBatch);
  });
}

function processAssets(compilation, options) {
  const assetHash = compilation.assets;
  const workers = createWorkers(workerCount());
  if (options.cacheDir) {
    mkdirp.sync(options.cacheDir);
  }

  const assets = Object.keys(assetHash).filter(assetName => /\.js$/.test(assetName));

  const batches = [];
  for (var i = 0; i < workers.length; i++) {
    batches.push([]);
  }

  for (var assetName of assets) {
    const tmpFileName = tmpFile.create(assetHash[assetName].source());
    batches.push({
      assetName,
      tmpFileName,
    });
  }

  const promises = batches.map((batch, index) => {
    const worker = workers[index % workers.length];
    return minify(batch, worker, options).then(contents => {
      for (var c of contents) {
        const minifiedCode = tmpFile.read(c.tmpFileName);
        assetHash[c.assetName] = new RawSource(minifiedCode);
        usedCacheKeys.push(c.cacheKey);
      }
    }).catch((e) => {
      compilation.errors.push(new Error(`minifying ${assetName}\n${e}`));
    });
  });

  return Promise.all(promises).then(() => {
    // build is done, clean up the cache
    cache.pruneCache(usedCacheKeys, cache.getCacheKeysFromDisk(options.cacheDir), options.cacheDir);
    workers.forEach(worker => worker.kill()); // workers are done, kill them.
  });
}

module.exports = {
  createWorkers,
  minify,
  processAssets,
  workerCount,
};

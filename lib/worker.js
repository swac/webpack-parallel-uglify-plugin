const uglify = require('uglify-js');
const cache = require('./cache');
const tmpFile = require('./tmp-file');

function minify(source, uglifyOptions) {
  const opts = Object.assign({}, uglifyOptions, { fromString: true });
  return uglify.minify(source, opts).code;
}

function messageHandler(msg) {
  if (msg.type === 'minify') {
    const minifiedBatch = [];
    const batch = msg.batch;
    try {
      for (var entry in batch) {
        const assetName = msg.assetName;
        const assetContents = tmpFile.read(tmpFileName);
        const cacheKey = cache.createCacheKey(assetContents, msg.options);
        const cachedContent = cache.retrieveFromCache(cacheKey, msg.options.cacheDir);
        const newContent = cachedContent || minify(assetContents, msg.options.uglifyJS);
        if (!cachedContent) {
          cache.saveToCache(cacheKey, newContent, msg.options.cacheDir);
        }
        tmpFile.update(tmpFileName, newContent);
        minifiedBatch.push({
          assetName,
          cacheKey,
          tmpFileName,
        });
      }
      process.send({
        type: 'success',
        minifiedBatch,
      });
    } catch (e) {
      process.send({
        type: 'error',
        errorMessage: e.message,
        assetName,
      });
    }
  }
}

process.on('message', messageHandler);

module.exports = messageHandler;
